"""Orchestratore.

Non fa "scarica i file di oggi": confronta la finestra sorgente di 8 giorni
con il contenuto del bucket e colma la differenza. E' la proprieta' che rende
il sistema robusto: se il job non gira per tre giorni, il run successivo
recupera da solo, e rilanciarlo dieci volte non produce nulla di diverso dal
lanciarlo una volta.
"""

import gzip
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


class GridMismatch(Exception):
    """Le coordinate sorgente non corrispondono a quelle dell'indice in cache."""


@dataclass(frozen=True)
class PlannedWork:
    source: source.SourceFile
    reason: str


def decompress_to_nc(gz_path: Path) -> Path:
    """Scompatta un .nc.gz accanto a se stesso e cancella il compresso."""
    destinazione = gz_path.with_suffix("")
    with gzip.open(gz_path, "rb") as ingresso, open(destinazione, "wb") as uscita:
        shutil.copyfileobj(ingresso, uscita, length=1 << 22)
    gz_path.unlink(missing_ok=True)
    return destinazione


def _gruppi_di_interesse() -> set[str]:
    gruppi = set(config.FIELD_GROUPS)
    gruppi.update(nome for nome, _ in config.PROFILE_GROUPS)
    return gruppi


def plan(store, files, window_days: int = config.WINDOW_DAYS, only: str | None = None):
    """Elenca il lavoro da fare, senza scaricare nulla."""
    limite = (datetime.now(timezone.utc) - timedelta(days=window_days)).strftime("%Y%m%d")
    interessanti = _gruppi_di_interesse()

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
        motivo = (
            "manifest presente, impronta da verificare" if esistente else "mai ingerito"
        )
        lavoro.append(PlannedWork(source=f, reason=motivo))
    return lavoro


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

    if cache_path.exists():
        indice = grid.load_index(cache_path)
        if indice.fingerprint != impronta:
            raise GridMismatch(
                "le coordinate sorgente sono cambiate: "
                f"attesa {indice.fingerprint[:12]}, trovata {impronta[:12]}. "
                "L'indice in cache produrrebbe valori nel posto sbagliato. "
                "Verificare il dominio ADRIAC e rigenerare l'indice a mano."
            )
        return indice

    mare = frames.read_sea_mask(ds, VARIABILE_DI_RIFERIMENTO)
    g = grid.build_grid(lon, lat)
    indice = grid.build_regrid_index(lon, lat, mare, g)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    grid.save_index(indice, cache_path)
    store.put_json(GRID_KEY, grid.grid_to_dict(g))
    log.info("indice costruito: %d x %d celle", g.width, g.height)
    return indice


def process_file(store, index, work: PlannedWork, workdir: Path, session=None):
    """Scarica, lavora e pubblica un file sorgente. Restituisce il manifest,
    oppure None se il file era gia' in archivio con la stessa impronta."""
    f = work.source
    testa = source.head(f.url, session=session)
    scaricato = workdir / f.name
    impronta = source.download(f.url, scaricato, session=session)

    chiave_manifest = manifest.manifest_key(f.date, f.kind, f.group)
    if manifest.already_ingested(store.get_json(chiave_manifest), impronta):
        scaricato.unlink(missing_ok=True)
        log.info("gia' in archivio, salto: %s", f.name)
        return None

    percorso_nc = decompress_to_nc(scaricato)
    try:
        with Dataset(str(percorso_nc)) as ds:
            istanti = frames.read_times(ds)
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
                _pubblica_profili(store, ds, index, f, gruppi_profilo[f.group], istanti)

            # La batimetria sta solo nei file 3D, non in quelli d'onda.
            # E' statica: si pubblica la prima volta che se ne incontra una.
            if "h" in ds.variables and not store.exists(BATHYMETRY_KEY):
                _pubblica_batimetria(store, ds, index)

        store.put_json(chiave_manifest, corrente.to_dict())
        return corrente
    finally:
        percorso_nc.unlink(missing_ok=True)


def _pubblica_batimetria(store, ds, index):
    """Pubblica la profondita' del fondale ricampionata come gli altri campi.

    Serve al client per disegnare le isobate e, piu' avanti, il fondale nella
    vista a colonna d'acqua. E' un campo statico: si scrive una volta sola.

    La scala e' 10 cm e non 1 cm: il fondale adriatico arriva a 1.246 m, e
    con scala 0,01 il fondoscala sarebbe 327 m, quindi tutto il bacino
    meridionale verrebbe tosato.
    """
    profondita = np.asarray(ds.variables["h"][:], dtype=np.float64)
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


def _pubblica_profili(store, ds, index, f, var_names, istanti):
    anagrafica = store.get_json(STATIONS_KEY)
    if not anagrafica:
        log.warning("anagrafica stazioni assente, salto i profili di %s", f.name)
        return
    elenco = [
        stations.Station(
            id=s["id"],
            name=s["name"],
            network=s["network"],
            lon=s["lon"],
            lat=s["lat"],
            variables=tuple(s["variables"]),
        )
        for s in anagrafica["stations"]
    ]
    lon, lat = frames.read_grid_coords(ds)
    celle = profiles.nearest_sea_cells(elenco, lon, lat, index.sea_mask)
    colonne = profiles.extract_columns(ds, var_names, celle, profiles.PROFILE_SCALE)
    for identificativo, valori in colonne.items():
        store.put_frame(
            profiles.column_key(identificativo, f.date), encode.compress(valori.ravel())
        )


def reconcile(
    store,
    workdir: Path,
    window_days: int = config.WINDOW_DAYS,
    only: str | None = None,
    dry_run: bool = False,
    session=None,
) -> dict:
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    file = source.list_source_files(session=session)
    lavoro = plan(store, file, window_days=window_days, only=only)
    esito = {"planned": len(lavoro), "processed": 0, "skipped": 0, "errors": 0}

    if dry_run:
        for w in lavoro:
            log.info("da lavorare: %s (%s)", w.source.name, w.reason)
        return esito

    _aggiorna_anagrafica(store, session)

    indice = None
    prodotti = []
    for w in lavoro:
        try:
            if indice is None and w.source.group == GRUPPO_DI_RIFERIMENTO:
                scaricato = workdir / w.source.name
                source.download(w.source.url, scaricato, session=session)
                percorso = decompress_to_nc(scaricato)
                with Dataset(str(percorso)) as ds:
                    indice = ensure_index(store, ds, workdir)
                percorso.unlink(missing_ok=True)

            if indice is None:
                log.info("indice non ancora disponibile, rimando: %s", w.source.name)
                continue

            corrente = process_file(store, indice, w, workdir, session=session)
            if corrente is None:
                esito["skipped"] += 1
            else:
                prodotti.append(corrente)
                esito["processed"] += 1
        except GridMismatch:
            raise
        except Exception:
            log.exception("errore su %s", w.source.name)
            esito["errors"] += 1

    if prodotti:
        catalog.rebuild_indices(store, prodotti)

    descrittore = store.get_json(GRID_KEY) or {}
    catalog.write_catalog(store, catalog.build_catalog(store, descrittore))
    return esito


def _aggiorna_anagrafica(store, session=None):
    try:
        elenco = stations.fetch_stations(session=session)
    except Exception:
        log.exception("anagrafica stazioni non aggiornata")
        return
    if elenco:
        store.put_json(STATIONS_KEY, stations.stations_to_dict(elenco))
