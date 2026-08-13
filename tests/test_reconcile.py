"""L'orchestratore: diff, guardia sulla griglia, idempotenza."""
from datetime import datetime, timezone

import boto3
import numpy as np
import pytest
from moto import mock_aws
from netCDF4 import Dataset

from ingest import config, frames, grid, manifest, reconcile
from ingest.source import parse_filename
from ingest.storage import ObjectStore
from tests.conftest import synthetic_coords, synthetic_sea_mask, write_wave_file

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


def test_il_secondo_giro_non_scrive_nulla(store, tmp_path, monkeypatch, wave_file):
    """Idempotenza: rilanciare non deve produrre scritture."""
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

    assert reconcile.process_file(store, None, reconcile.PlannedWork(f, "x"), tmp_path) is None


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

    # Se la scorciatoia scattasse, process_file tornerebbe None senza scaricare.
    with pytest.raises(Scaricato):
        reconcile.process_file(store, None, reconcile.PlannedWork(f, "x"), tmp_path)


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
