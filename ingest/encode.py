"""Quantizzazione, trasformazioni e compressione.

Funzioni pure: dentro array, fuori array. Nessun I/O, nessuna dipendenza
dal resto del progetto oltre alle costanti.
"""

import gzip

import numpy as np

from .config import INT16_MAX, INT16_MIN, NODATA

_COMPRESS_LEVEL = 6


def _as_float(values: np.ndarray) -> np.ndarray:
    """Porta a float64 semplice, con NaN dove l'array e' mascherato."""
    if np.ma.isMaskedArray(values):
        return np.ma.filled(values.astype(np.float64), np.nan)
    return np.asarray(values, dtype=np.float64)


def quantize(
    values: np.ndarray, scale: float, offset: float = 0.0
) -> tuple[np.ndarray, dict]:
    """Converte valori fisici in int16.

    Restituisce l'array e le statistiche che finiscono nel manifest:
    minimo e massimo in unita' fisiche (None se non c'e' nessun valore
    valido), quanti nodata e quanti valori tosati.
    """
    arr = _as_float(values)
    valid = np.isfinite(arr)

    out = np.full(arr.shape, NODATA, dtype=np.int16)
    clipped = 0
    minimo: float | None = None
    massimo: float | None = None

    if valid.any():
        # Si arrotonda prima di confrontare con i limiti, non dopo: il valore
        # memorizzato e' l'arrotondato tosato, quindi contare i troncamenti sul
        # non arrotondato dichiarerebbe tosati dei valori che l'arrotondamento
        # da solo riporta in scala (tutta la fascia fra 32767 e 32767,5).
        # clipped_count finisce nel manifest permanente: deve dire il vero.
        grezzi = np.rint((arr[valid] - offset) / scale)
        clipped = int(np.count_nonzero((grezzi < INT16_MIN) | (grezzi > INT16_MAX)))
        out[valid] = np.clip(grezzi, INT16_MIN, INT16_MAX).astype(np.int16)
        minimo = float(arr[valid].min())
        massimo = float(arr[valid].max())

    stats = {
        "min": minimo,
        "max": massimo,
        "nodata_count": int(np.count_nonzero(~valid)),
        "clipped_count": clipped,
    }
    return out, stats


def dequantize(raw: np.ndarray, scale: float, offset: float = 0.0) -> np.ndarray:
    """Inverso di quantize. I nodata tornano NaN."""
    out = raw.astype(np.float64) * scale + offset
    out[raw == NODATA] = np.nan
    return out


def direction_component(degrees: np.ndarray, component: str) -> np.ndarray:
    """Seno o coseno di una direzione in gradi.

    Le direzioni non si archiviano come angoli perche' 359 e 1 grado sono
    adiacenti ma la loro media lineare e' 180, cioe' il verso opposto.
    Interpolare seno e coseno separatamente e' invece corretto.
    """
    rad = np.deg2rad(_as_float(degrees))
    if component == "sin":
        return np.sin(rad)
    if component == "cos":
        return np.cos(rad)
    raise ValueError(f"componente non riconosciuta: {component}")


def apply_transform(values: np.ndarray, transform: str) -> np.ndarray:
    if transform == "identity":
        return _as_float(values)
    if transform in ("sin", "cos"):
        return direction_component(values, transform)
    raise ValueError(f"trasformazione non riconosciuta: {transform}")


def compress(raw: np.ndarray) -> bytes:
    """int16 little endian, gzip.

    Il file viene poi caricato con Content-Encoding: gzip, cosi' il browser
    lo decomprime da solo e il client non ha bisogno di alcuna libreria.
    """
    return gzip.compress(raw.astype("<i2").tobytes(), compresslevel=_COMPRESS_LEVEL)


def decompress(blob: bytes) -> np.ndarray:
    return np.frombuffer(gzip.decompress(blob), dtype="<i2")
