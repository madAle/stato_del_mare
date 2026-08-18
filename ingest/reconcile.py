"""Orchestratore.

Non fa "scarica i file di oggi": confronta la finestra sorgente di 8 giorni
con il contenuto del bucket e colma la differenza. E' la proprieta' che rende
il sistema robusto: se il job non gira per tre giorni, il run successivo
recupera da solo, e rilanciarlo dieci volte non produce nulla di diverso dal
lanciarlo una volta.
"""

import gzip
import hashlib
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from netCDF4 import Dataset

from . import catalog, config, encode, frames, grid, manifest, profiles, source, stations

log = logging.getLogger(__name__)

INDEX_KEY = "static/regrid_index.npz"
GRID_KEY = "grid.json"
BATHYMETRY_KEY = "static/bathymetry.bin"
STATIONS_KEY = "stations/stations.json"

# 10 cm: il fondale adriatico arriva a 1.246 m, quindi serve un fondoscala
# di almeno quell'ordine (32767 * 0,1 = 3.276 m).
BATHYMETRY_SCALE = 0.1

# Il gruppo da cui si deducono griglia e maschera di mare: e' il piu' piccolo
# e c'e' sempre.
GRUPPO_DI_RIFERIMENTO = "his_HPDwave"
VARIABILE_DI_RIFERIMENTO = "Hwave"


# Definita in grid.py, dove la sollevano anche le guardie sulle forme.
# Riesportata qui perche' e' l'orchestratore a decidere che non va inghiottita,
# ed e' da qui che la CLI la importa.
GridMismatch = grid.GridMismatch


@dataclass(frozen=True)
class PlannedWork:
    source: source.SourceFile
    reason: str
    # Vero quando il gruppo e' stato chiesto in rilavorazione: process_file
    # scavalca la deduplica invece di saltare il file. E' una decisione del
    # piano e non di process_file, cosi' il motivo stampato dal dry run e il
    # comportamento vero nascono dallo stesso confronto e non possono
    # divergere.
    rilavora: bool = False


@dataclass(frozen=True)
class EsitoFile:
    """Cosa un file ha prodotto, e se era gia' in archivio.

    Il manifest torna anche quando il file viene deduplicato: e' cio' che
    permette agli indici di ripararsi da soli dopo un run ucciso a meta'.
    Il flag tiene separata la contabilita', cosi' un file saltato non viene
    spacciato per lavorato.
    """

    manifesto: "manifest.RunManifest"
    deduplicato: bool


@dataclass(frozen=True)
class SorgenteLocale:
    """Un file sorgente gia' scaricato e scompattato, con la sua impronta.

    Serve a non scaricare due volte il file del gruppo di riferimento: il
    ramo che costruisce l'indice lo ha gia' sul disco, e `process_file` lo
    riceve invece di ripartire dalla rete.

    Chi lo costruisce resta proprietario del percorso e lo cancella. La
    regola vale in un verso solo, ed e' quella che tiene il conto della
    cancellazione a uno: `process_file` cancella solo cio' che ha scaricato
    lui, e non deve indovinare a chi appartiene il file che ha ricevuto.
    """

    percorso: Path
    sha256: str


def decompress_to_nc(gz_path: Path) -> Path:
    """Scompatta un .nc.gz accanto a se stesso e cancella il compresso."""
    destinazione = gz_path.with_suffix("")
    with gzip.open(gz_path, "rb") as ingresso, open(destinazione, "wb") as uscita:
        shutil.copyfileobj(ingresso, uscita, length=1 << 22)
    gz_path.unlink(missing_ok=True)
    return destinazione


def gruppi_di_interesse() -> set[str]:
    """I gruppi sorgente che questo ingestore lavora, campi e profili."""
    gruppi = set(config.FIELD_GROUPS)
    gruppi.update(nome for nome, _ in config.PROFILE_GROUPS)
    return gruppi


def plan(
    store,
    files,
    window_days: int = config.WINDOW_DAYS,
    only: str | None = None,
    rilavora: set[str] | None = None,
):
    """Elenca il lavoro da fare, senza scaricare nulla.

    `rilavora` e' l'insieme dei gruppi sorgente da riprocessare anche se il
    manifest dice che sono gia' stati ingeriti.
    """
    rilavora = rilavora or frozenset()
    limite = (datetime.now(timezone.utc) - timedelta(days=window_days)).strftime("%Y%m%d")
    interessanti = gruppi_di_interesse()

    lavoro: list[PlannedWork] = []
    for f in files:
        if f.date < limite:
            continue
        if f.group not in interessanti:
            continue
        # I profili si estraggono solo dall'analisi.
        if f.group in {nome for nome, _ in config.PROFILE_GROUPS} and f.kind != "an":
            continue
        if only and only not in {c.id for c in config.fields_for(f.group)}:
            continue

        esistente = store.get_json(manifest.manifest_key(f.date, f.kind, f.group))
        da_rilavorare = f.group in rilavora
        # I tre motivi vanno tenuti distinti: il dry run e' il modo di
        # guardare il piano prima di spendere banda, e dire "mai ingerito" di
        # un file che sta in archivio da giorni sarebbe falso.
        if not esistente:
            motivo = "mai ingerito"
        elif da_rilavorare:
            motivo = "rilavorazione richiesta"
        else:
            motivo = "manifest presente, impronta da verificare"
        lavoro.append(PlannedWork(source=f, reason=motivo, rilavora=da_rilavorare))
    return lavoro


def ordina_per_indice(lavoro: list[PlannedWork]) -> list[PlannedWork]:
    """Mette per primo il file di riferimento piu' recente del piano.

    L'indice di ricampionamento si costruisce solo dal gruppo di riferimento,
    e finche' non esiste ogni altro file viene rimandato senza che nessuna
    seconda passata lo recuperi. Apache ordina per nome e dopo `his_` il byte
    '2' precede 'H', quindi senza questo riordino `his_2dcur` arriva sempre
    prima di `his_HPDwave`. A regime e' innocuo; morde al primo run su bucket
    vuoto e al run di recupero dopo un'interruzione, cioe' esattamente quando
    la data piu' vecchia sta per uscire dalla finestra di 8 giorni.

    Fra piu' file di riferimento si sceglie il piu' recente: il ramo che
    costruisce l'indice scarica il file per conto suo, e il piu' vecchio a
    regime e' gia' in archivio, quindi verrebbe riscaricato a ogni run senza
    che nessun altro passo ne abbia bisogno.
    """
    riferimento = [w for w in lavoro if w.source.group == GRUPPO_DI_RIFERIMENTO]
    if not riferimento:
        return list(lavoro)
    primo = max(riferimento, key=lambda w: (w.source.date, w.source.name))
    return [primo] + [w for w in lavoro if w is not primo]


def ensure_index(store, ds, workdir: Path, cache_path: Path | None = None):
    """Costruisce l'indice di ricampionamento o lo rilegge dalla cache.

    Se l'impronta delle coordinate del file non coincide con quella
    dell'indice salvato, solleva GridMismatch e il job si ferma senza
    scrivere. E' l'unico guasto di questo sistema che non si annuncia da
    solo: produrrebbe frame plausibili con i valori nel posto sbagliato,
    indistinguibili da quelli buoni una volta in archivio.
    """
    cache_path = cache_path or (workdir / "regrid_index.npz")
    lon, lat = frames.read_grid_coords(ds)
    impronta = grid.coordinate_fingerprint(lon, lat)

    # L'indice vive sull'object store, non solo sul disco locale. I runner di
    # GitHub Actions sono effimeri: un indice che stesse solo in workdir
    # verrebbe ricostruito a ogni run dal file corrente, coinciderebbe sempre
    # con se stesso, e la guardia non scatterebbe mai. Il disco locale resta
    # solo come ottimizzazione dentro un singolo run.
    if not cache_path.exists():
        remoto = store.get_binary(INDEX_KEY)
        if remoto is not None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(remoto)

    if cache_path.exists():
        indice = grid.load_index(cache_path)
        if indice.fingerprint != impronta:
            raise GridMismatch(
                "le coordinate sorgente sono cambiate: "
                f"attesa {indice.fingerprint[:12]}, trovata {impronta[:12]}. "
                "L'indice in cache produrrebbe valori nel posto sbagliato. "
                "Verificare il dominio ADRIAC e rigenerare l'indice a mano."
            )
        # Anche qui, non solo nel ramo di costruzione: quel ramo passa una
        # volta sola nella vita del bucket, quindi un grid.json perso non
        # tornerebbe mai piu' e il client resterebbe senza modo di
        # posizionare la texture. La scrittura e' idempotente.
        _pubblica_griglia(store, indice.grid)
        return indice

    mare = frames.read_sea_mask(ds, VARIABILE_DI_RIFERIMENTO)
    g = grid.build_grid(lon, lat)
    indice = grid.build_regrid_index(lon, lat, mare, g)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    grid.save_index(indice, cache_path)
    store.put_binary(INDEX_KEY, cache_path.read_bytes())
    _pubblica_griglia(store, g)
    log.info("indice costruito: %d x %d celle", g.width, g.height)
    return indice


def _pubblica_griglia(store, g: grid.MercatorGrid) -> None:
    descrittore = grid.grid_to_dict(g)
    if not grid.grid_dict_is_valid(descrittore):
        raise ValueError(f"descrittore di griglia non valido: {descrittore}")
    store.put_json(GRID_KEY, descrittore)


def process_file(
    store,
    index,
    work: PlannedWork,
    workdir: Path,
    session=None,
    locale: SorgenteLocale | None = None,
) -> EsitoFile:
    """Scarica, lavora e pubblica un file sorgente.

    Restituisce sempre un manifest: quello appena scritto, oppure quello gia'
    in archivio se il file era invariato. Restituire None sulla deduplica
    lasciava i frame di un run morto prima della fase indici assenti da
    `index/` per sempre, perche' ogni run successivo saltava il file e non
    scriveva mai la voce di indice.

    Con `locale` il file e' gia' sul disco e non si scarica: e' il caso del
    gruppo di riferimento, che il ramo dell'indice ha appena preso. La
    cancellazione resta di chi lo ha creato, quindi qui non lo si tocca.
    """
    f = work.source
    scaricato = workdir / f.name
    # Solo cio' che questa funzione ha scompattato: il file ricevuto da fuori
    # non entra qui, altrimenti verrebbe cancellato due volte da due
    # proprietari diversi e nessuno dei due saprebbe di essere il secondo.
    percorso_nc = None
    # Il finally copre anche lo scaricamento e la scompattazione, non solo la
    # lavorazione: i file di previsione 3D arrivano a quasi 2 GB contro i 14 GB
    # del runner, e un download interrotto a meta' lascerebbe un residuo che
    # nessuno rimuove. Qualche fallimento di rete in un run di recupero
    # basterebbe a saturare il disco e far cadere anche i file sani.
    try:
        testa = source.head(f.url, session=session)
        chiave_manifest = manifest.manifest_key(f.date, f.kind, f.group)
        esistente = store.get_json(chiave_manifest)

        # Scorciatoia prima di scaricare. L'impronta autorevole resta lo
        # sha256, ma calcolarla impone di scaricare il file: senza questo
        # controllo il secondo run giornaliero riscaricherebbe 1,9 GB solo per
        # ricalcolare impronte identiche a quelle gia' registrate. Dimensione e
        # data di modifica bastano a dire che il sorgente non si e' mosso.
        sorgente = (esistente or {}).get("source", {})
        if (
            esistente
            # Il primo dei due livelli di deduplica che la rilavorazione
            # scavalca. Non e' una scorciatoia di comodo: quando una
            # correzione cambia cio' che il file produce, il sorgente non si
            # muove e nessuna intestazione HTTP lo racconta, quindi senza
            # questo scavalco il prodotto vecchio resterebbe li' per sempre.
            and not work.rilavora
            # La versione di schema va confrontata qui e non solo dentro
            # already_ingested, che questa scorciatoia scavalca: se il formato
            # d'archivio cambia, i file vanno rilavorati anche quando alla
            # sorgente non si sono mossi, altrimenti resterebbero congelati nel
            # vecchio schema per sempre (le loro intestazioni HTTP non
            # cambieranno mai).
            and esistente.get("schema_version") == config.SCHEMA_VERSION
            and sorgente.get("last_modified") == testa["last_modified"]
            and sorgente.get("bytes") == testa["bytes"]
        ):
            log.info("invariato alla sorgente, salto senza scaricare: %s", f.name)
            return EsitoFile(manifest.RunManifest.from_dict(esistente), True)

        impronta = (
            locale.sha256
            if locale is not None
            else source.download(f.url, scaricato, session=session)
        )
        # Il secondo livello: l'impronta coincide per forza, visto che il file
        # e' lo stesso. Scavalcare solo il primo lascerebbe --rilavora a
        # riscaricare senza mai rifare niente.
        if not work.rilavora and manifest.already_ingested(esistente, impronta):
            log.info("gia' in archivio, salto: %s", f.name)
            return EsitoFile(manifest.RunManifest.from_dict(esistente), True)

        if locale is not None:
            sorgente_nc = locale.percorso
        else:
            percorso_nc = decompress_to_nc(scaricato)
            sorgente_nc = percorso_nc
        with Dataset(str(sorgente_nc)) as ds:
            corrente = manifest.RunManifest(
                source_url=f.url,
                source_sha256=impronta,
                source_bytes=testa["bytes"],
                source_last_modified=testa["last_modified"],
                reference_time=datetime.strptime(f.date, "%Y%m%d").replace(
                    tzinfo=timezone.utc
                ),
                kind=f.kind,
                group=f.group,
                grid_ref=GRID_KEY,
                ingested_at=datetime.now(timezone.utc),
                frames=[],
            )

            if f.group in config.FIELD_GROUPS:
                for record, blob in frames.extract_frames(ds, f.group, f.kind, f.date, index):
                    store.put_frame(record.path, blob)
                    corrente.frames.append(record)

            gruppi_profilo = dict(config.PROFILE_GROUPS)
            if f.group in gruppi_profilo:
                corrente.columns.extend(
                    _pubblica_profili(store, ds, index, f, gruppi_profilo[f.group])
                )

            # La batimetria sta solo nei file 3D, non in quelli d'onda.
            # E' statica: si pubblica la prima volta che se ne incontra una.
            if "h" in ds.variables and not store.exists(BATHYMETRY_KEY):
                _pubblica_batimetria(store, ds, index)

        store.put_json(chiave_manifest, corrente.to_dict())
        return EsitoFile(corrente, False)
    finally:
        scaricato.unlink(missing_ok=True)
        if percorso_nc is not None:
            percorso_nc.unlink(missing_ok=True)


def _pubblica_batimetria(store, ds, index):
    """Pubblica la profondita' del fondale ricampionata come gli altri campi.

    Serve al client per disegnare le isobate e, piu' avanti, il fondale nella
    vista a colonna d'acqua. E' un campo statico: si scrive una volta sola.

    La scala e' 10 cm e non 1 cm: il fondale adriatico arriva a 1.246 m, e
    con scala 0,01 il fondoscala sarebbe 327 m, quindi tutto il bacino
    meridionale verrebbe tosato.
    """
    profondita = np.asarray(frames.read_variable(ds, "h")[:], dtype=np.float64)
    mascherata = np.where(index.sea_mask, profondita, np.nan)
    ricampionata = grid.apply_index(mascherata, index)
    quantizzata, stats = encode.quantize(ricampionata, BATHYMETRY_SCALE)
    if stats["clipped_count"]:
        raise ValueError(
            f"batimetria tosata su {stats['clipped_count']} celle: "
            f"massimo {stats['max']} m contro un fondoscala di "
            f"{32767 * BATHYMETRY_SCALE} m"
        )
    store.put_frame(BATHYMETRY_KEY, encode.compress(quantizzata))
    log.info("batimetria pubblicata, da %.1f a %.1f m", stats["min"], stats["max"])


def _pubblica_profili(store, ds, index, f, var_names) -> list[manifest.ColumnRecord]:
    """Pubblica una colonna per stazione e restituisce i record da registrare.

    I record servono al manifest: le colonne non compaiono in nessun indice e
    in nessun catalogo, quindi il manifest del gruppo e' l'unico posto in cui
    resta scritto cosa contiene quel blob di int16.
    """
    anagrafica = store.get_json(STATIONS_KEY)
    if not anagrafica:
        log.warning("anagrafica stazioni assente, salto i profili di %s", f.name)
        return []
    elenco = stations.stations_from_dict(anagrafica)
    lon, lat = frames.read_grid_coords(ds)
    celle = profiles.nearest_sea_cells(elenco, lon, lat, index.sea_mask)
    colonne = profiles.extract_columns(ds, var_names, celle, profiles.PROFILE_SCALE)
    registrate: list[manifest.ColumnRecord] = []
    for identificativo, valori in colonne.items():
        chiave = profiles.column_key(identificativo, f.group, f.date)
        blob = encode.compress(valori.ravel())
        store.put_frame(chiave, blob)
        registrate.append(
            manifest.ColumnRecord(
                station_id=identificativo,
                path=chiave,
                group=f.group,
                variables=tuple(var_names),
                shape=tuple(int(n) for n in valori.shape),
                scale=profiles.PROFILE_SCALE,
                sha256=hashlib.sha256(blob).hexdigest(),
            )
        )
    return registrate


def _prendi_riferimento(work: PlannedWork, workdir: Path, session=None) -> SorgenteLocale:
    """Porta sul disco il file da cui si costruisce l'indice.

    Restituisce anche lo sha256, che altrimenti andrebbe ricalcolato
    riscaricando: e' l'impronta che `process_file` confronta con quella gia'
    in archivio, e sui file di riferimento il download costa circa 23 MB.
    """
    scaricato = workdir / work.source.name
    try:
        impronta = source.download(work.source.url, scaricato, session=session)
        return SorgenteLocale(percorso=decompress_to_nc(scaricato), sha256=impronta)
    finally:
        # decompress_to_nc cancella il compresso quando riesce, ma un download
        # interrotto a meta' no, e quel residuo non lo rimuoverebbe nessuno.
        scaricato.unlink(missing_ok=True)


def reconcile(
    store,
    workdir: Path,
    window_days: int = config.WINDOW_DAYS,
    only: str | None = None,
    dry_run: bool = False,
    rilavora: set[str] | None = None,
    session=None,
) -> dict:
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    file = source.list_source_files(session=session)
    lavoro = ordina_per_indice(
        plan(store, file, window_days=window_days, only=only, rilavora=rilavora)
    )
    esito = {
        "planned": len(lavoro),
        "processed": 0,
        "skipped": 0,
        # I rimandati vanno contati: senza, un run che rimanda tutto perche'
        # l'indice non e' mai stato costruito riporterebbe successo con dei
        # file spariti dal conteggio.
        "deferred": 0,
        "errors": 0,
    }

    if dry_run:
        for w in lavoro:
            log.info("da lavorare: %s (%s)", w.source.name, w.reason)
        return esito

    _aggiorna_anagrafica(store, session)

    indice = None
    prodotti = []
    for w in lavoro:
        riferimento = None
        try:
            if indice is None and w.source.group == GRUPPO_DI_RIFERIMENTO:
                riferimento = _prendi_riferimento(w, workdir, session=session)
                with Dataset(str(riferimento.percorso)) as ds:
                    indice = ensure_index(store, ds, workdir)

            if indice is None:
                log.warning("indice non disponibile, rimando: %s", w.source.name)
                esito["deferred"] += 1
                continue

            # Il file e' gia' qui: process_file lo legge invece di riscaricare
            # gli stessi 23 MB, che era il costo fisso di ogni run in cui
            # questo ramo passa.
            lavorato = process_file(
                store, indice, w, workdir, session=session, locale=riferimento
            )
            # Anche un file deduplicato entra in `prodotti`: merge_index e'
            # idempotente, quindi rimetterlo costa una PUT per file di indice
            # toccato e ripara gli indici di un run precedente morto prima
            # della fase indici.
            prodotti.append(lavorato.manifesto)
            if lavorato.deduplicato:
                esito["skipped"] += 1
            else:
                esito["processed"] += 1
        except (GridMismatch, frames.UnitMismatch, frames.VariableMissing):
            # Nessuna delle tre si risolve da sola, e inghiottirle qui
            # significherebbe uscita 1, cioe' "riprova domani" per sempre
            # mentre l'archivio si riempie di valori sbagliati (o non si
            # riempie affatto, nel caso di una variabile rinominata).
            raise
        except Exception:
            log.exception("errore su %s", w.source.name)
            esito["errors"] += 1
        finally:
            # Chi lo ha creato lo cancella, e lo fa qui perche' questo e'
            # l'unico punto attraversato da ogni uscita del giro: successo,
            # errore inghiottito, guasto rilanciato. Lasciarlo a process_file
            # non basterebbe, perche' la scorciatoia sulla deduplica ritorna
            # prima e il ramo `deferred` non lo chiama affatto.
            if riferimento is not None:
                riferimento.percorso.unlink(missing_ok=True)

    if prodotti:
        catalog.rebuild_indices(store, prodotti)

    descrittore = store.get_json(GRID_KEY)
    if not grid.grid_dict_is_valid(descrittore):
        # Fermarsi e' meglio che sbagliare: un catalogo con un descrittore
        # vuoto e' sintatticamente valido e inservibile, il client non sa
        # dove mettere la texture e la pagina e' rotta senza che niente lo
        # segnali. Il catalogo precedente, se c'e', resta buono.
        log.error(
            "descrittore di griglia assente o non valido (%s): il catalogo non "
            "viene scritto. Serve un run in cui l'indice venga costruito o "
            "riletto.",
            GRID_KEY,
        )
        esito["errors"] += 1
        return esito

    catalog.write_catalog(store, catalog.build_catalog(store, descrittore))
    return esito


def _aggiorna_anagrafica(store, session=None):
    try:
        elenco = stations.fetch_stations(session=session)
    except stations.StationCollision:
        # Come GridMismatch: non e' un guasto passeggero da registrare e
        # scavalcare. Due nomi diversi sullo stesso identificativo vogliono
        # una decisione umana, non un run che prosegue.
        raise
    except Exception:
        log.exception("anagrafica stazioni non aggiornata")
        return
    if not elenco:
        return

    precedenti = stations.stations_from_dict(store.get_json(STATIONS_KEY))
    noti = {s.id for s in precedenti}
    presenti = {s.id for s in elenco}
    for identificativo in sorted(presenti - noti):
        log.info("stazione comparsa nell'anagrafica: %s", identificativo)
    for identificativo in sorted(noti - presenti):
        # Non e' un errore, ma nemmeno un non evento: una boa ferma per
        # settimane e' un buco nell'archivio che qualcuno deve poter notare.
        log.info(
            "stazione assente dal flusso in tempo reale, conservata: %s", identificativo
        )

    store.put_json(
        STATIONS_KEY,
        stations.stations_to_dict(stations.merge_stations(precedenti, elenco)),
    )
