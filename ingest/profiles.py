"""Colonne verticali sulle celle delle stazioni.

Si estraggono i 30 valori sigma grezzi, senza conversione in metri: s_rho,
Cs_r, hc e la batimetria sono statici e gia' archiviati, quindi la profondita'
reale si ricostruisce in qualunque momento. Rimandiamo la parte difficile
senza perdere il dato.

Solo da file di analisi. Scaricare 1,2 GB al giorno per estrarne 130 KB e'
sproporzionato ma inevitabile: NetCDF non supporta richieste parziali per
cella.
"""

import logging

import numpy as np
from scipy.spatial import cKDTree

from . import encode, grid
from .config import MAX_NEIGHBOUR_DISTANCE_M

log = logging.getLogger(__name__)

# Centesimi di unita': va bene per gradi Celsius, salinita' pratica e m/s.
PROFILE_SCALE = 0.01


def nearest_sea_cells(
    stations, lon_rho, lat_rho, sea_mask, max_distance_m: float = MAX_NEIGHBOUR_DISTANCE_M
) -> dict[str, tuple[int, int]]:
    """Cella di mare ADRIAC piu' vicina a ogni stazione.

    Restituisce solo le stazioni che ne hanno una entro la soglia: le
    stazioni lagunari del delta possono non averla, e vanno saltate con un
    log invece che approssimate.
    """
    lon_rho = np.asarray(lon_rho, dtype=np.float64)
    lat_rho = np.asarray(lat_rho, dtype=np.float64)
    sea_mask = np.asarray(sea_mask, dtype=bool)

    righe, colonne = np.nonzero(sea_mask)
    sx, sy = grid.lonlat_to_mercator(lon_rho[sea_mask], lat_rho[sea_mask])
    albero = cKDTree(np.column_stack([sx, sy]))

    fuori: dict[str, tuple[int, int]] = {}
    for stazione in stations:
        px, py = grid.lonlat_to_mercator(
            np.array(stazione.lon), np.array(stazione.lat)
        )
        distanza, posizione = albero.query([float(px), float(py)])
        al_suolo = distanza * np.cos(np.radians(stazione.lat))
        if not np.isfinite(distanza) or al_suolo > max_distance_m:
            # Il log non e' decorativo: senza, una stazione lagunare sparisce
            # dall'archivio in silenzio e nessuno se ne accorge per mesi.
            log.warning(
                "stazione %s saltata: la cella di mare piu' vicina dista %.0f m, "
                "oltre la soglia di %.0f m",
                stazione.id,
                al_suolo,
                max_distance_m,
            )
            continue
        fuori[stazione.id] = (int(righe[posizione]), int(colonne[posizione]))
    return fuori


def column_key(station_id: str, date: str) -> str:
    iso = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    return f"stations/{station_id}/columns/{iso}.bin"


def extract_columns(
    ds, var_names: tuple[str, ...], cells: dict[str, tuple[int, int]], scale: float
) -> dict[str, np.ndarray]:
    """Colonne sigma per stazione, forma (istanti, variabili, livelli).

    Si legge la fetta ds[var][t] intera una volta per istante e si indicizza
    in memoria: su NetCDF3 contiguo e' nettamente piu' rapido che fare una
    lettura strided per stazione, e la memoria di picco resta bassa (circa
    25 MB per fetta).
    """
    n_istanti = len(ds.dimensions["ocean_time"])
    n_livelli = len(ds.dimensions["s_rho"])

    accumulato = {
        identificativo: np.full(
            (n_istanti, len(var_names), n_livelli), np.nan, dtype=np.float64
        )
        for identificativo in cells
    }

    for indice_variabile, nome in enumerate(var_names):
        variabile = ds.variables[nome]
        for indice_t in range(n_istanti):
            fetta = np.ma.filled(variabile[indice_t].astype(np.float64), np.nan)
            for identificativo, (riga, colonna) in cells.items():
                accumulato[identificativo][indice_t, indice_variabile, :] = fetta[
                    :, riga, colonna
                ]

    return {
        identificativo: encode.quantize(valori, scale)[0]
        for identificativo, valori in accumulato.items()
    }
