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
from .config import EXCLUDED_STATIONS, MAX_STATION_DISTANCE_M
from .frames import read_variable

log = logging.getLogger(__name__)

# Centesimi di unita': va bene per gradi Celsius, salinita' pratica e m/s.
PROFILE_SCALE = 0.01


def nearest_sea_cells(
    stations,
    lon_rho,
    lat_rho,
    sea_mask,
    max_distance_m: float = MAX_STATION_DISTANCE_M,
    excluded: dict[str, str] = EXCLUDED_STATIONS,
) -> dict[str, tuple[int, int]]:
    """Cella di mare ADRIAC piu' vicina a ogni stazione.

    La soglia predefinita e' MAX_STATION_DISTANCE_M, non quella del
    ricampionamento: sono due domande diverse, il motivo sta scritto accanto
    alle due costanti in config.py.

    Restituisce solo le stazioni che sopravvivono a due filtri distinti, che
    il log tiene separati perche' si correggono in modi diversi. Per
    distanza: nessuna cella di mare entro la soglia, come le lagunari del
    delta. Per elenco: la stazione sta in acqua non marina ma abbastanza
    vicino al mare da passare qualunque soglia sensata, quindi si nomina.
    """
    lon_rho = np.asarray(lon_rho, dtype=np.float64)
    lat_rho = np.asarray(lat_rho, dtype=np.float64)
    sea_mask = np.asarray(sea_mask, dtype=bool)

    righe, colonne = np.nonzero(sea_mask)
    sx, sy = grid.lonlat_to_mercator(lon_rho[sea_mask], lat_rho[sea_mask])
    albero = cKDTree(np.column_stack([sx, sy]))

    fuori: dict[str, tuple[int, int]] = {}
    for stazione in stations:
        if stazione.id in excluded:
            # Prima della ricerca, non dopo: la distanza qui non c'entra, e
            # riportarla farebbe credere che sia stata lei a decidere.
            log.warning(
                "stazione %s esclusa per elenco: %s", stazione.id, excluded[stazione.id]
            )
            continue
        px, py = grid.lonlat_to_mercator(
            np.array(stazione.lon), np.array(stazione.lat)
        )
        distanza, posizione = albero.query([float(px), float(py)])
        al_suolo = distanza * np.cos(np.radians(stazione.lat))
        if not np.isfinite(distanza) or al_suolo > max_distance_m:
            # Il log non e' decorativo: senza, una stazione lagunare sparisce
            # dall'archivio in silenzio e nessuno se ne accorge per mesi.
            log.warning(
                "stazione %s scartata per distanza: la cella di mare piu' vicina "
                "dista %.0f m, oltre la soglia di %.0f m",
                stazione.id,
                al_suolo,
                max_distance_m,
            )
            continue
        fuori[stazione.id] = (int(righe[posizione]), int(colonne[posizione]))
    return fuori


def column_key(station_id: str, group: str, date: str) -> str:
    """stations/{id}/columns/{gruppo}/{YYYY-MM-DD}.bin

    Il segmento di gruppo e' obbligatorio: i profili si estraggono da tre
    file sorgente distinti (temperatura, salinita', correnti), lavorati in
    tre passaggi separati. Senza quel segmento le tre scritture finirebbero
    sullo stesso oggetto, marcato per giunta come immutabile, e ne
    sopravvivrebbe una sola.
    """
    iso = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    return f"stations/{station_id}/columns/{group}/{iso}.bin"


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
        # Non ds.variables[nome]: i campi 2D hanno la guardia dentro
        # check_units, le colonne non hanno un passo equivalente e un nome
        # sparito uscirebbe come KeyError, cioe' fra i guasti passeggeri.
        variabile = read_variable(ds, nome)
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
