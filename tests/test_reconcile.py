"""L'orchestratore: diff, guardia sulla griglia, idempotenza."""
import logging
from datetime import datetime, timezone

import boto3
import numpy as np
import pytest
from moto import mock_aws
from netCDF4 import Dataset

from ingest import config, encode, frames, grid, manifest, profiles, reconcile, stations
from ingest.source import parse_filename
from ingest.storage import ObjectStore
from tests.conftest import (
    NS,
    NT,
    synthetic_coords,
    synthetic_sea_mask,
    write_2dcur_file,
    write_profile_file,
    write_wave_file,
)

BUCKET = "prova"


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(BUCKET, None, "chiave", "segreto", region="us-east-1")


def _file_sorgente(nome="20260813_adriac_1km_his_HPDwave_an.nc.gz"):
    return parse_filename(nome)


def test_il_piano_ignora_i_gruppi_non_configurati(store):
    file = [
        _file_sorgente(),
        _file_sorgente("20260813_adriac_1km_avg_2dcur_an.nc.gz"),
    ]
    pianificato = reconcile.plan(store, file, window_days=8)
    gruppi = {p.source.group for p in pianificato}
    assert "his_HPDwave" in gruppi
    assert "avg_2dcur" not in gruppi


def test_il_piano_include_i_file_gia_ingeriti(store, monkeypatch):
    """L'impronta si verifica dopo lo scaricamento, non in pianificazione.

    `plan()` non conosce lo sha256 del sorgente senza scaricarlo, quindi
    pianifica comunque e la deduplica avviene in `process_file`. Il nome di
    questo test diceva il contrario e mentiva.
    """
    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    istante = datetime(2026, 8, 13, tzinfo=timezone.utc)
    esistente = manifest.RunManifest(
        source_url=f.url,
        source_sha256="impronta",
        source_bytes=1,
        source_last_modified="x",
        reference_time=istante,
        kind="an",
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=istante,
        frames=[],
    )
    store.put_json(manifest.manifest_key("20260813", "an", "his_HPDwave"), esistente.to_dict())
    # Il piano si basa sul manifest: senza scaricare non conosce l'impronta,
    # quindi pianifica comunque e la deduplica avviene in process_file.
    pianificato = reconcile.plan(store, [f], window_days=8)
    assert len(pianificato) == 1
    assert pianificato[0].reason == "manifest presente, impronta da verificare"


def test_la_guardia_sulla_griglia_ferma_il_job(store, tmp_path, wave_file):
    """Se le coordinate sorgente cambiano, l'indice in cache produrrebbe
    frame plausibili con i valori nel posto sbagliato."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    indice = grid.build_regrid_index(lon, lat, mare, g)
    percorso = tmp_path / "regrid_index.npz"
    # Impronta falsificata: simula un cambio di griglia a monte.
    grid.save_index(
        grid.RegridIndex(indice.indices, indice.sea_mask, "impronta-vecchia", g), percorso
    )
    with Dataset(str(wave_file)) as ds:
        with pytest.raises(reconcile.GridMismatch):
            reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)


def test_la_guardia_sulla_griglia_ferma_reconcile(store, tmp_path, monkeypatch, wave_file):
    """GridMismatch deve uscire da reconcile(), non essere contata come errore.

    reconcile() cattura Exception per non far cadere l'intero run su un file
    storto. Se quella clausola inghiottisse anche GridMismatch, il run
    proseguirebbe scrivendo frame con i valori nel posto sbagliato, che e'
    esattamente il danno che la guardia esiste per impedire. Verificare
    ensure_index in isolamento non basta: la clausola larga sta qui.
    """
    f = _file_sorgente()
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    def esplode(*args, **kwargs):
        raise reconcile.GridMismatch("le coordinate sorgente sono cambiate")

    monkeypatch.setattr(reconcile, "ensure_index", esplode)

    with pytest.raises(reconcile.GridMismatch):
        reconcile.reconcile(store, tmp_path, window_days=8)

    # Il punto della guardia: non deve essere stato scritto niente.
    assert store.get_json("catalog.json") is None


def test_un_cambio_di_unita_ferma_reconcile(store, tmp_path, monkeypatch):
    """UnitMismatch deve uscire da reconcile(), non essere contata come errore.

    Contata come errore diventerebbe uscita 1, cioe' "ritentabile, il run
    successivo recupera": il cron ritenterebbe per sempre un cambio di unita'
    alla sorgente, che non si risolve da solo.
    """
    f = _file_sorgente()

    def scarica_con_unita_sbagliate(url, dest, session=None):
        percorso = write_wave_file(dest.with_suffix(".nc"))
        with Dataset(str(percorso), "a") as ds:
            ds.variables["Hwave"].units = "centimeter"
        return "impronta"

    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(reconcile.source, "download", scarica_con_unita_sbagliate)
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    with pytest.raises(frames.UnitMismatch):
        reconcile.reconcile(store, tmp_path, window_days=8)

    assert store.get_json("catalog.json") is None


def test_l_indice_sopravvive_a_una_workdir_nuova(store, tmp_path, monkeypatch, wave_file):
    """L'indice deve tornare dal bucket, non dal disco locale.

    E' la differenza fra una guardia che funziona e una decorativa: sui runner
    effimeri la workdir sparisce a ogni run, quindi un indice solo locale
    verrebbe ricostruito ogni volta dal file corrente e non rileverebbe mai un
    cambio di dominio.

    Con lo stesso file sorgente in entrambe le workdir, confrontare solo
    l'impronta non basta a distinguere "riletto dal bucket" da "ricostruito
    da capo": coinciderebbero comunque. Si conta invece quante volte
    build_regrid_index viene chiamata: una sola, mai due, altrimenti la
    seconda chiamata ha ricostruito invece di rileggere.
    """
    costruzioni = []
    originale = grid.build_regrid_index

    def conta_costruzioni(*args, **kwargs):
        costruzioni.append(1)
        return originale(*args, **kwargs)

    monkeypatch.setattr(grid, "build_regrid_index", conta_costruzioni)

    prima = tmp_path / "run1"
    prima.mkdir()
    with Dataset(str(wave_file)) as ds:
        reconcile.ensure_index(store, ds, prima)

    # Workdir nuova e vuota, come al run successivo su un runner effimero.
    seconda = tmp_path / "run2"
    seconda.mkdir()
    with Dataset(str(wave_file)) as ds:
        indice = reconcile.ensure_index(store, ds, seconda)

    assert (seconda / "regrid_index.npz").exists()
    with Dataset(str(wave_file)) as ds:
        assert indice.fingerprint == grid.coordinate_fingerprint(*frames.read_grid_coords(ds))
    assert len(costruzioni) == 1


def test_la_guardia_scatta_anche_sull_indice_ripreso_dal_bucket(store, tmp_path, wave_file):
    """La configurazione di produzione: workdir fredda, indice dal bucket, dominio cambiato.

    Il test sulla guardia con la cache locale non passa mai dal ramo che
    scarica l'indice dall'object store, perche' `cache_path` esiste gia'. In
    produzione quel ramo e' l'unica strada, visto che la workdir e' effimera.
    Che i due rami convergano e' un ragionamento letto nel codice: qui viene
    verificato.
    """
    prima = tmp_path / "run1"
    prima.mkdir()
    with Dataset(str(wave_file)) as ds:
        reconcile.ensure_index(store, ds, prima)

    # Stesso file, coordinate spostate: e' il dominio riconfigurato a monte.
    altro = write_wave_file(tmp_path / "altro.nc")
    with Dataset(str(altro), "a") as ds:
        ds.variables["lon_rho"][:] = ds.variables["lon_rho"][:] + 0.5

    seconda = tmp_path / "run2"
    seconda.mkdir()
    with Dataset(str(altro)) as ds:
        with pytest.raises(reconcile.GridMismatch):
            reconcile.ensure_index(store, ds, seconda)


def test_grid_json_si_riscrive_a_ogni_run(store, tmp_path, wave_file):
    """`grid.json` non deve vivere solo nel ramo che costruisce l'indice.

    Quel ramo passa una volta sola nella vita del bucket. Se poi il file
    sparisce (una put_json fallita dopo una put_binary riuscita, una
    cancellazione accidentale) non torna piu': l'indice e' in cache e il ramo
    di costruzione e' irraggiungibile. Il client non puo' posizionare la
    texture e la pagina resta rotta con un catalogo sintatticamente valido.
    """
    percorso = tmp_path / "regrid_index.npz"
    with Dataset(str(wave_file)) as ds:
        reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)

    atteso = store.get_json(reconcile.GRID_KEY)
    assert atteso and atteso["width"] > 0 and atteso["height"] > 0

    store.client.delete_object(Bucket=BUCKET, Key=reconcile.GRID_KEY)
    assert store.get_json(reconcile.GRID_KEY) is None

    # Secondo run: l'indice arriva dalla cache, il ramo di costruzione non
    # viene mai percorso.
    with Dataset(str(wave_file)) as ds:
        reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)

    assert store.get_json(reconcile.GRID_KEY) == atteso


def test_senza_descrittore_di_griglia_il_catalogo_non_si_scrive(
    store, tmp_path, monkeypatch
):
    """Meglio nessun catalogo che un catalogo con `"grid": {}`.

    Se nel piano non c'e' nessun file del gruppo di riferimento, l'indice non
    si costruisce e `grid.json` non esiste. Scrivere comunque il catalogo
    pubblicherebbe un descrittore vuoto: il client non saprebbe dove mettere
    la texture, e la pagina sarebbe rotta con un file sintatticamente valido.
    """
    cur = _file_sorgente("20260813_adriac_1km_his_2dcur_an.nc.gz")
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [cur])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source, "download", lambda url, dest, session=None: _scrivi_sintetico(url, dest)
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    esito = reconcile.reconcile(store, tmp_path, window_days=8)

    assert esito["deferred"] == 1
    assert store.get_json(reconcile.GRID_KEY) is None
    assert store.get_json("catalog.json") is None
    # E il run non deve poter riportare successo.
    assert esito["errors"] + esito["deferred"] > 0


def test_l_indice_si_costruisce_al_primo_giro_e_si_riusa(store, tmp_path, wave_file):
    percorso = tmp_path / "regrid_index.npz"
    with Dataset(str(wave_file)) as ds:
        primo = reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)
        assert percorso.exists()
        secondo = reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)
    assert np.array_equal(primo.indices, secondo.indices)


def test_il_catalogo_si_scrive_dopo_i_frame(store, tmp_path, monkeypatch, wave_file):
    """Ordine di scrittura: frame, manifest, indici, catalogo."""
    ordine = []
    put_frame_originale = store.put_frame
    put_json_originale = store.put_json

    def traccia_frame(key, blob):
        ordine.append(("frame", key))
        return put_frame_originale(key, blob)

    def traccia_json(key, obj):
        ordine.append(("json", key))
        return put_json_originale(key, obj)

    monkeypatch.setattr(store, "put_frame", traccia_frame)
    monkeypatch.setattr(store, "put_json", traccia_json)

    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))
    monkeypatch.setattr(
        reconcile.stations, "fetch_stations", lambda session=None: []
    )
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [f]
    )

    reconcile.reconcile(store, tmp_path, window_days=8, only="hwave")

    chiavi = [k for _, k in ordine]
    assert "catalog.json" in chiavi
    assert chiavi.index("catalog.json") == len(chiavi) - 1
    assert any(k.startswith("frames/") for k in chiavi)


def test_il_secondo_giro_non_rilavora_nulla(store, tmp_path, monkeypatch, wave_file):
    """Idempotenza: rilanciare non deve rilavorare nessun file.

    Qualche scrittura il secondo giro la fa, ed e' voluta: gli indici mensili
    e il catalogo vengono riscritti identici, perche' `merge_index` e'
    idempotente ed e' cosi' che un run ucciso prima della fase indici si
    ripara al giro dopo. Cio' che non deve succedere e' riscaricare o
    riquantizzare: quello lo dicono i contatori.
    """
    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))
    monkeypatch.setattr(
        reconcile.stations, "fetch_stations", lambda session=None: []
    )
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [f]
    )

    primo = reconcile.reconcile(store, tmp_path, window_days=8)
    assert primo["processed"] >= 1

    secondo = reconcile.reconcile(store, tmp_path, window_days=8)
    assert secondo["processed"] == 0
    assert secondo["skipped"] >= 1


def test_un_file_invariato_non_viene_riscaricato(store, tmp_path, monkeypatch):
    """Il secondo run non deve ripagare 1,9 GB per riconfermare cio' che sa.

    La deduplica autorevole e' sullo sha256, che impone di scaricare. Il
    controllo su dimensione e data di modifica esiste per non arrivarci.
    """
    f = _file_sorgente()
    testa = {"bytes": 42, "last_modified": "Thu, 13 Aug 2026 10:34:00 GMT"}
    monkeypatch.setattr(reconcile.source, "head", lambda url, session=None: testa)

    istante = datetime(2026, 8, 13, tzinfo=timezone.utc)
    gia_visto = manifest.RunManifest(
        source_url=f.url,
        source_sha256="qualunque",
        source_bytes=testa["bytes"],
        source_last_modified=testa["last_modified"],
        reference_time=istante,
        kind=f.kind,
        group=f.group,
        grid_ref="grid.json",
        ingested_at=istante,
        frames=[],
    )
    store.put_json(manifest.manifest_key(f.date, f.kind, f.group), gia_visto.to_dict())

    def non_chiamare(*a, **k):
        raise AssertionError("non deve scaricare un file invariato")

    monkeypatch.setattr(reconcile.source, "download", non_chiamare)

    esito = reconcile.process_file(store, None, reconcile.PlannedWork(f, "x"), tmp_path)
    # Il file e' saltato, ma il manifest torna comunque: e' cio' che permette
    # agli indici di ripararsi dopo un run ucciso prima della fase indici.
    assert esito.deduplicato is True
    assert esito.manifesto.source_sha256 == "qualunque"


def test_un_cambio_di_schema_forza_il_rilavoro_anche_a_sorgente_invariata(
    store, tmp_path, monkeypatch
):
    """La scorciatoia non deve scavalcare il controllo di versione dello schema.

    Se il formato d'archivio cambia, i file vanno rilavorati anche quando alla
    sorgente non si sono mossi: le loro intestazioni HTTP non cambieranno mai,
    quindi senza questo controllo resterebbero congelati nel vecchio schema
    per sempre.
    """

    class Scaricato(Exception):
        pass

    f = _file_sorgente()
    testa = {"bytes": 42, "last_modified": "Thu, 13 Aug 2026 10:34:00 GMT"}
    monkeypatch.setattr(reconcile.source, "head", lambda url, session=None: testa)

    istante = datetime(2026, 8, 13, tzinfo=timezone.utc)
    vecchio = manifest.RunManifest(
        source_url=f.url,
        source_sha256="qualunque",
        source_bytes=testa["bytes"],
        source_last_modified=testa["last_modified"],
        reference_time=istante,
        kind=f.kind,
        group=f.group,
        grid_ref="grid.json",
        ingested_at=istante,
        frames=[],
    ).to_dict()
    # Archivio scritto con uno schema precedente, sorgente identica.
    vecchio["schema_version"] = config.SCHEMA_VERSION - 1
    store.put_json(manifest.manifest_key(f.date, f.kind, f.group), vecchio)

    def deve_scaricare(*a, **k):
        raise Scaricato

    monkeypatch.setattr(reconcile.source, "download", deve_scaricare)

    # Se la scorciatoia scattasse, process_file tornerebbe senza scaricare.
    with pytest.raises(Scaricato):
        reconcile.process_file(store, None, reconcile.PlannedWork(f, "x"), tmp_path)


def _scrivi_sintetico(url, dest):
    """Sceglie la fixture giusta in base al gruppo che compare nell'URL."""
    if "2dcur" in url:
        write_2dcur_file(dest.with_suffix(".nc"))
    else:
        write_wave_file(dest.with_suffix(".nc"))
    return "impronta-" + url.rsplit("/", 1)[-1]


def test_il_gruppo_di_riferimento_si_lavora_per_primo(store, tmp_path, monkeypatch):
    """L'ordine del listing ARPAE non deve decidere cosa viene perso.

    L'indice di ricampionamento si costruisce solo dal gruppo di riferimento,
    e finche' non esiste ogni altro file viene rimandato senza che nessuna
    seconda passata lo recuperi. Apache ordina per nome, e dopo `his_` il byte
    '2' precede 'H': his_2dcur arriva sempre prima di his_HPDwave. A regime e'
    innocuo, ma al primo run su bucket vuoto (e al run di recupero, quando la
    data piu' vecchia sta per uscire dalla finestra di 8 giorni) costa un
    giorno di ubar e vbar perso per sempre.
    """
    cur = _file_sorgente("20260813_adriac_1km_his_2dcur_an.nc.gz")
    hpd = _file_sorgente("20260813_adriac_1km_his_HPDwave_an.nc.gz")
    # L'ordine e' quello che restituisce l'indice Apache.
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [cur, hpd]
    )
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source, "download", lambda url, dest, session=None: _scrivi_sintetico(url, dest)
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    esito = reconcile.reconcile(store, tmp_path, window_days=8)

    assert store.list_keys("frames/ubar/"), "his_2dcur e' stato rimandato e mai ripreso"
    assert esito["processed"] == 2
    assert esito["deferred"] == 0
    # La somma deve tornare: senza il contatore dei rimandati due file
    # sparivano dal conteggio e il run poteva riportare successo.
    assert (
        esito["processed"] + esito["skipped"] + esito["deferred"] + esito["errors"]
        == esito["planned"]
    )


def test_l_indice_si_costruisce_dal_file_di_riferimento_piu_recente(
    store, tmp_path, monkeypatch
):
    """Fra due file del gruppo di riferimento si sceglie il piu' recente.

    Il ramo che costruisce l'indice scarica il file per conto suo. Farlo dal
    piu' vecchio significa riscaricare a ogni run un file che a regime e' gia'
    in archivio e che nessun altro passo richiede.
    """
    vecchio = _file_sorgente("20260812_adriac_1km_his_HPDwave_an.nc.gz")
    nuovo = _file_sorgente("20260813_adriac_1km_his_HPDwave_an.nc.gz")
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [vecchio, nuovo]
    )
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )

    scaricati = []

    def traccia(url, dest, session=None):
        scaricati.append(url)
        return _scrivi_sintetico(url, dest)

    monkeypatch.setattr(reconcile.source, "download", traccia)
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    reconcile.reconcile(store, tmp_path, window_days=8)

    assert scaricati, "nessuno scaricamento: il test non sta osservando niente"
    assert "20260813" in scaricati[0]


def _sorgente_sintetica(monkeypatch, f):
    """Sostituisce rete e scompattazione con il file d'onda sintetico."""
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))


def test_gli_indici_si_riparano_dopo_un_run_morto_prima_della_fase_indici(
    store, tmp_path, monkeypatch, wave_file
):
    """Frame scritti, manifest scritto, run ucciso: il run dopo deve ripararsi.

    E' il caso quasi certo del primo deploy: 8 giorni da ingerire contro un
    limite di 90 minuti sul runner. Se `prodotti` raccogliesse solo i file
    appena lavorati, il run successivo deduplicherebbe sul manifest, non
    contribuirebbe a `rebuild_indices`, e quei frame resterebbero sul bucket
    ma assenti da `index/` per sempre: il client non saprebbe mai che
    esistono. E' irreversibile, non passeggero.
    """
    f = _file_sorgente()
    _sorgente_sintetica(monkeypatch, f)

    def runner_ucciso(*a, **k):
        raise RuntimeError("il runner e' stato ucciso prima della fase indici")

    monkeypatch.setattr(reconcile.catalog, "rebuild_indices", runner_ucciso)
    with pytest.raises(RuntimeError):
        reconcile.reconcile(store, tmp_path, window_days=8, only="hwave")

    # Lo stato che il run morto lascia sul bucket.
    assert store.list_keys("frames/hwave/"), "il run 1 doveva scrivere i frame"
    assert store.get_json(manifest.manifest_key(f.date, f.kind, f.group)) is not None
    assert store.list_keys("index/") == []

    monkeypatch.undo()
    _sorgente_sintetica(monkeypatch, f)

    esito = reconcile.reconcile(store, tmp_path, window_days=8, only="hwave")
    # Il file e' comunque saltato: la deduplica resta, e la contabilita' non
    # deve spacciarlo per lavorato.
    assert esito["processed"] == 0
    assert esito["skipped"] == 1
    assert esito["errors"] == 0

    atteso = {"2026-08-12T01:00:00Z": "20260813", "2026-08-12T02:00:00Z": "20260813"}
    assert store.get_json("index/hwave/an/2026-08.json") == {"hours": atteso}

    # E l'indice deve puntare a frame che esistono davvero: un indice
    # rigenerato con voci inventate sarebbe peggio dell'assenza.
    for istante, riferimento in atteso.items():
        valido = datetime.strptime(istante, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
        assert store.exists(frames.frame_key("hwave", "an", riferimento, valido))


def test_una_boa_in_manutenzione_non_sparisce_dall_anagrafica(store, monkeypatch, caplog):
    """`realtime.jsonl` e' un'istantanea scorrevole, non un elenco completo.

    Una stazione in manutenzione ne esce. Ricostruendo l'anagrafica da zero
    sparirebbe, e `_pubblica_profili` smetterebbe di estrarne la colonna per
    tutto il tempo dell'assenza: dentro una finestra di 8 giorni quel dato e'
    perso per sempre. L'anagrafica e' anche l'unico posto in cui e' scritto a
    chi appartiene un file colonna storico.
    """
    ferma = stations.Station("boa-ferma", "Ferma", "boa", 12.5, 44.5, ("B22070",))
    attiva = stations.Station("boa-attiva", "Attiva", "boa", 12.6, 44.6, ("B22070",))
    store.put_json(reconcile.STATIONS_KEY, stations.stations_to_dict([ferma, attiva]))

    nuova = stations.Station("boa-nuova", "Nuova", "boa", 12.7, 44.7, ("B22070",))
    monkeypatch.setattr(
        reconcile.stations, "fetch_stations", lambda session=None: [attiva, nuova]
    )

    with caplog.at_level(logging.INFO):
        reconcile._aggiorna_anagrafica(store)

    finale = {s["id"] for s in store.get_json(reconcile.STATIONS_KEY)["stations"]}
    assert finale == {"boa-ferma", "boa-attiva", "boa-nuova"}

    # Comparse e sparizioni vanno registrate: senza, nessuno si accorge che
    # una boa e' ferma da due settimane.
    testo = caplog.text
    assert "boa-nuova" in testo
    assert "boa-ferma" in testo
    assert "boa-attiva" not in testo


def _indice_sintetico():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    return grid.build_regrid_index(lon, lat, mare, g)


def _anagrafica_di_prova(store):
    """Una sola stazione, esattamente sul centro della cella (1,1)."""
    lon, lat = synthetic_coords()
    store.put_json(
        reconcile.STATIONS_KEY,
        {
            "stations": [
                {
                    "id": "boa-prova",
                    "name": "Prova",
                    "network": "boa",
                    "lon": float(lon[1, 1]),
                    "lat": float(lat[1, 1]),
                    "variables": [],
                }
            ]
        },
    )


def test_i_gruppi_di_profilo_non_si_sovrascrivono(store, tmp_path, monkeypatch):
    """Tre gruppi di profilo, tre oggetti colonna distinti.

    `_pubblica_profili` viene chiamata una volta per gruppo. Con una chiave
    senza segmento di gruppo le tre scritture finivano sullo stesso oggetto,
    marcato per giunta `immutable`, e sopravviveva solo l'ultima secondo
    l'ordine di listing ARPAE: salinita' e le due componenti di corrente
    (1,19 GB al giorno di scaricamento) venivano buttate.
    """
    _anagrafica_di_prova(store)
    indice = _indice_sintetico()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    manifesti = {}
    for gruppo, variabili in config.PROFILE_GROUPS:
        corto = gruppo.removeprefix("his_")
        f = _file_sorgente(f"20260813_adriac_1km_his_{corto}_an.nc.gz")
        assert f.group == gruppo
        monkeypatch.setattr(
            reconcile.source,
            "download",
            lambda url, dest, session=None, v=variabili, g=gruppo: (
                write_profile_file(dest.with_suffix(".nc"), var_names=v),
                f"impronta-{g}",
            )[1],
        )
        manifesti[gruppo] = reconcile.process_file(
            store, indice, reconcile.PlannedWork(f, "mai ingerito"), tmp_path
        ).manifesto

    chiavi = store.list_keys("stations/boa-prova/columns/")
    assert len(chiavi) == 3, f"i tre gruppi si sono sovrascritti: {chiavi}"

    for gruppo, variabili in config.PROFILE_GROUPS:
        corrente = manifesti[gruppo]
        # Il contratto d'archivio: senza queste voci l'oggetto colonna e' un
        # blob di int16 indistinto, illeggibile senza il codice che l'ha
        # scritto. Nessun indice e nessun catalogo lo nomina.
        assert len(corrente.columns) == 1
        colonna = corrente.columns[0]
        assert colonna.path in chiavi
        assert gruppo in colonna.path
        assert colonna.station_id == "boa-prova"
        assert colonna.variables == tuple(variabili)
        assert colonna.shape == (NT, len(variabili), NS)
        assert colonna.scale == profiles.PROFILE_SCALE

        # E il contratto deve dire il vero: l'oggetto si rilegge con la forma
        # dichiarata e le variabili sono nell'ordine dichiarato.
        letto = encode.decompress(store.get_binary(colonna.path))
        assert letto.size == NT * len(variabili) * NS
        valori = encode.dequantize(
            letto.reshape(colonna.shape), profiles.PROFILE_SCALE
        )
        # Nel file sintetico la variabile in posizione k parte da k * 100.
        for k in range(len(variabili)):
            assert np.allclose(valori[0, k, 0], k * 100.0 + 0.05, atol=0.01)


def test_il_dry_run_non_scrive_e_non_scarica(store, tmp_path, monkeypatch):
    """Il dry run stampa il piano: non deve toccare la rete ne' il bucket."""
    f = _file_sorgente()
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])

    def non_chiamare(*args, **kwargs):
        raise AssertionError("il dry run non deve scaricare")

    monkeypatch.setattr(reconcile.source, "download", non_chiamare)
    monkeypatch.setattr(reconcile.stations, "fetch_stations", non_chiamare)

    esito = reconcile.reconcile(store, tmp_path, window_days=8, dry_run=True)
    assert esito["planned"] >= 1
    assert esito["processed"] == 0
    assert store.get_json("catalog.json") is None
