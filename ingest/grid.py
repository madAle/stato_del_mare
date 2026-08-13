"""Griglia di destinazione in Web Mercator e impronta delle coordinate sorgente.

La griglia sorgente ADRIAC e' curvilinea (ruotata lungo l'asse dell'Adriatico),
quindi non puo' essere appoggiata su una mappa come rettangolo nord-sud.
Il ricampionamento in Web Mercator si fa qui, una volta sola, in ingestione.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from .config import GRID_RESOLUTION_M, MAX_NEIGHBOUR_DISTANCE_M

# Raggio della sfera usata da Web Mercator (EPSG:3857).
EARTH_RADIUS_M = 6378137.0


@dataclass(frozen=True)
class MercatorGrid:
    """Raster di destinazione, in metri EPSG:3857.

    L'origine dei pixel e' l'angolo in alto a sinistra: la riga 0 e' la
    piu' a nord, coerentemente con l'ordine di lettura di una texture.
    """

    x_min: float
    x_max: float
    y_min: float
    y_max: float
    width: int
    height: int
    resolution: float


def lonlat_to_mercator(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    x = np.radians(lon) * EARTH_RADIUS_M
    y = EARTH_RADIUS_M * np.log(np.tan(np.pi / 4.0 + np.radians(lat) / 2.0))
    return x, y


def mercator_to_lonlat(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    lon = np.degrees(x / EARTH_RADIUS_M)
    lat = np.degrees(2.0 * np.arctan(np.exp(y / EARTH_RADIUS_M)) - np.pi / 2.0)
    return lon, lat


def build_grid(lon_rho, lat_rho, resolution: float = GRID_RESOLUTION_M) -> MercatorGrid:
    """Costruisce il raster che contiene tutta la griglia sorgente.

    Le dimensioni si calcolano dai dati e non vanno mai cablate: se ARPAE
    cambia il dominio, il numero di celle cambia con lui.
    """
    x, y = lonlat_to_mercator(lon_rho, lat_rho)
    x_min, x_max = float(x.min()), float(x.max())
    y_min, y_max = float(y.min()), float(y.max())
    width = int(np.ceil((x_max - x_min) / resolution))
    height = int(np.ceil((y_max - y_min) / resolution))
    return MercatorGrid(
        x_min=x_min,
        x_max=x_min + width * resolution,
        y_min=y_max - height * resolution,
        y_max=y_max,
        width=width,
        height=height,
        resolution=resolution,
    )


def grid_centres(g: MercatorGrid):
    """Centri dei pixel in metri Mercator, appiattiti in ordine C.

    L'ordine e' lo stesso di un array (height, width) letto riga per riga,
    dall'alto verso il basso: e' l'ordine in cui il frame viene poi scritto.
    """
    xs = g.x_min + (np.arange(g.width) + 0.5) * g.resolution
    ys = g.y_max - (np.arange(g.height) + 0.5) * g.resolution
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    return gx.ravel(), gy.ravel()


def grid_to_dict(g: MercatorGrid) -> dict:
    """Il descrittore che finisce in grid.json e che il client usa per
    posizionare la texture sulla mappa."""
    west, south = mercator_to_lonlat(np.array(g.x_min), np.array(g.y_min))
    east, north = mercator_to_lonlat(np.array(g.x_max), np.array(g.y_max))
    return {
        "crs": "EPSG:3857",
        "x_min": g.x_min,
        "x_max": g.x_max,
        "y_min": g.y_min,
        "y_max": g.y_max,
        "width": g.width,
        "height": g.height,
        "resolution_m": g.resolution,
        "bounds_lonlat": {
            "west": float(west),
            "south": float(south),
            "east": float(east),
            "north": float(north),
        },
    }


def coordinate_fingerprint(lon_rho, lat_rho) -> str:
    """Impronta delle coordinate sorgente.

    E' la difesa contro il solo guasto di questo sistema che non si annuncia:
    se ARPAE riconfigura il dominio, l'indice di ricampionamento in cache
    resta valido come forma ma sbagliato come contenuto, e produrrebbe frame
    plausibili con i valori nel posto sbagliato. Confrontando l'impronta a
    ogni run il job si ferma invece di corrompere l'archivio.
    """
    h = hashlib.sha256()
    h.update(np.ascontiguousarray(lon_rho, dtype=np.float64).tobytes())
    h.update(np.ascontiguousarray(lat_rho, dtype=np.float64).tobytes())
    return h.hexdigest()


@dataclass(frozen=True)
class RegridIndex:
    """Corrispondenza pixel di destinazione verso cella di mare sorgente.

    `indices` contiene, per ogni pixel, la posizione nel vettore delle celle
    di mare (cioe' in `values_2d[sea_mask]`), oppure -1 se nessuna cella di
    mare e' abbastanza vicina.
    """

    indices: np.ndarray
    sea_mask: np.ndarray
    fingerprint: str
    grid: MercatorGrid


def build_regrid_index(
    lon_rho,
    lat_rho,
    sea_mask,
    g: MercatorGrid,
    max_distance_m: float = MAX_NEIGHBOUR_DISTANCE_M,
) -> RegridIndex:
    """Costruisce l'indice interrogando un KDTree sulle sole celle di mare.

    Costruire l'albero solo sul mare e' la ragione per cui nessun valore puo'
    attraversare la costa: una interpolazione bilineare mediarebbe celle di
    mare con celle di terra mascherate, e le onde risulterebbero
    artificialmente smorzate proprio lungo la costa.

    La distanza si valuta al suolo e non in metri Mercator, che alle nostre
    latitudini sono gonfiati di circa il 37 per cento.
    """
    lon_rho = np.asarray(lon_rho, dtype=np.float64)
    lat_rho = np.asarray(lat_rho, dtype=np.float64)
    sea_mask = np.asarray(sea_mask, dtype=bool)

    sx, sy = lonlat_to_mercator(lon_rho[sea_mask], lat_rho[sea_mask])
    tree = cKDTree(np.column_stack([sx, sy]))

    cx, cy = grid_centres(g)
    _, lat_dest = mercator_to_lonlat(cx, cy)
    fattore = np.cos(np.radians(lat_dest))

    # Limite generoso in metri Mercator: si stringe dopo, al suolo.
    limite_mercator = max_distance_m / float(fattore.min())
    distanza, posizione = tree.query(
        np.column_stack([cx, cy]), distance_upper_bound=limite_mercator
    )

    trovato = np.isfinite(distanza)
    al_suolo = np.where(trovato, distanza * fattore, np.inf)
    valido = trovato & (al_suolo <= max_distance_m)

    indices = np.full(cx.shape, -1, dtype=np.int32)
    indices[valido] = posizione[valido].astype(np.int32)

    return RegridIndex(
        indices=indices,
        sea_mask=sea_mask,
        fingerprint=coordinate_fingerprint(lon_rho, lat_rho),
        grid=g,
    )


def apply_index(values_2d, index: RegridIndex) -> np.ndarray:
    """Ricampiona un campo sorgente sul raster di destinazione.

    Restituisce float64 con NaN sui nodata, cosi' che quantize() li converta
    in NODATA senza casi speciali. I valori gia' mascherati in origine
    diventano NaN e si propagano correttamente, il che rende innocuo il caso
    in cui la maschera di un singolo file differisca da quella di riferimento.
    """
    if np.ma.isMaskedArray(values_2d):
        piatto = np.ma.filled(values_2d.astype(np.float64), np.nan)[index.sea_mask]
    else:
        piatto = np.asarray(values_2d, dtype=np.float64)[index.sea_mask]

    fuori = np.full(index.indices.shape, np.nan, dtype=np.float64)
    trovato = index.indices >= 0
    fuori[trovato] = piatto[index.indices[trovato]]
    return fuori.reshape(index.grid.height, index.grid.width)


def save_index(index: RegridIndex, path: Path) -> None:
    np.savez_compressed(
        path,
        indices=index.indices,
        sea_mask=index.sea_mask,
        fingerprint=np.array(index.fingerprint),
        grid=np.array(
            [
                index.grid.x_min,
                index.grid.x_max,
                index.grid.y_min,
                index.grid.y_max,
                index.grid.width,
                index.grid.height,
                index.grid.resolution,
            ],
            dtype=np.float64,
        ),
    )


def load_index(path: Path) -> RegridIndex:
    with np.load(path, allow_pickle=False) as z:
        g = z["grid"]
        return RegridIndex(
            indices=z["indices"],
            sea_mask=z["sea_mask"],
            fingerprint=str(z["fingerprint"]),
            grid=MercatorGrid(
                x_min=float(g[0]),
                x_max=float(g[1]),
                y_min=float(g[2]),
                y_max=float(g[3]),
                width=int(g[4]),
                height=int(g[5]),
                resolution=float(g[6]),
            ),
        )
