"""Griglia di destinazione in Web Mercator e impronta delle coordinate sorgente.

La griglia sorgente ADRIAC e' curvilinea (ruotata lungo l'asse dell'Adriatico),
quindi non puo' essere appoggiata su una mappa come rettangolo nord-sud.
Il ricampionamento in Web Mercator si fa qui, una volta sola, in ingestione.
"""

import hashlib
from dataclasses import dataclass

import numpy as np

from .config import GRID_RESOLUTION_M

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
