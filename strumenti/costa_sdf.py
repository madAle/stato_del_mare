# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "pyshp", "pillow"]
# ///
"""Campo di distanza con segno dalla linea di costa, per il ritaglio nella SPA.

Si esegue una volta sola: la costa non cambia. Serve GSHHG in risoluzione piena
(GSHHS_shp/f/GSHHS_f_L1) scompattato nella cartella indicata da --gshhg.

    uv run strumenti/costa_sdf.py --gshhg ~/gshhg --uscita web/public

Due scelte qui dentro sono costate tempo e non vanno rifatte al contrario.

La distanza si misura dai SEGMENTI della costa, non da una maschera
rasterizzata. Una trasformata di distanza su maschera non conosce nessun valore
sotto il texel: il suo minimo non nullo e' un texel intero, il livello zero e'
la scaletta della rasterizzazione, e nessuna interpolazione la raddrizza. La
prima versione era fatta cosi' e la costa si vedeva a gradini di 240 m.

Il segno si prende dalla PARITA' degli attraversamenti, non dalla giacitura del
segmento piu' vicino. La giacitura sbaglia sui vertici concavi e su ogni anello
orientato al contrario, e sbaglia su pixel isolati in mezzo a pixel giusti,
cioe' nel modo che non si nota guardando il risultato. Il raggio va verso ovest
e deve contare anche gli attraversamenti fuori dal riquadro, quindi i poligoni
si filtrano per latitudine e mai per riquadro.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import shapefile
from PIL import Image
from scipy.spatial import cKDTree

R = 6378137.0
PASSO_INFITTIMENTO = 40.0   # errore massimo del campionamento: meta' passo, sotto
                            # il passo di quantizzazione del byte


def a_mercatore(lon, lat):
    return (np.radians(lon) * R,
            R * np.log(np.tan(np.pi / 4 + np.radians(np.clip(lat, -85.0, 85.0)) / 2)))


def a_latitudine(y):
    return np.degrees(2 * np.arctan(np.exp(np.asarray(y) / R)) - np.pi / 2)


def anelli(percorso: Path, lat0: float, lat1: float, lon0=None, lon1=None):
    """Anelli di costa in mercatore. Senza limiti in longitudine li da' tutti."""
    lettore = shapefile.Reader(str(percorso / "GSHHS_shp" / "f" / "GSHHS_f_L1"))
    for forma in lettore.iterShapes():
        b = forma.bbox
        if b[3] < lat0 or b[1] > lat1:
            continue
        if lon0 is not None and (b[2] < lon0 or b[0] > lon1):
            continue
        p = np.asarray(forma.points, dtype=np.float64)
        x, y = a_mercatore(p[:, 0], p[:, 1])
        punti = np.column_stack([x, y])
        limiti = list(forma.parts) + [len(punti)]
        for j in range(len(forma.parts)):
            anello = punti[limiti[j]:limiti[j + 1]]
            if len(anello) > 1:
                yield anello


def segmenti(sorgente):
    a, b = [], []
    for anello in sorgente:
        a.append(anello[:-1])
        b.append(anello[1:])
    return np.concatenate(a), np.concatenate(b)


def distanze(A, B, xs, ys, limite):
    """Distanza di ogni centro di cella dal segmento di costa piu' vicino."""
    lung = np.hypot(*(B - A).T)
    n = np.maximum(1, np.ceil(lung / PASSO_INFITTIMENTO)).astype(np.int64)
    seg = np.repeat(np.arange(len(n)), n)
    inizio = np.concatenate([[0], np.cumsum(n)[:-1]])
    t = (np.arange(int(n.sum())) - np.repeat(inizio, n)) / n[seg]
    campioni = A[seg] + (B[seg] - A[seg]) * t[:, None]
    print(f"  {len(A)} segmenti, {lung.sum()/1000:.0f} km, {len(campioni)} campioni", file=sys.stderr)

    MX, MY = np.meshgrid(xs, ys)
    d, _ = cKDTree(campioni).query(np.column_stack([MX.ravel(), MY.ravel()]),
                                   workers=-1, distance_upper_bound=limite * 1.2)
    return np.where(np.isfinite(d), d, limite).reshape(len(ys), len(xs))


def terraferma(A, B, xs, ys):
    """Maschera di terra per parita' di attraversamenti di un raggio verso ovest."""
    H, W = len(ys), len(xs)
    passo = abs(ys[1] - ys[0])
    y0, y1 = A[:, 1], B[:, 1]
    r_da = np.clip(np.ceil((ys[0] - np.maximum(y0, y1)) / passo).astype(np.int64), 0, H)
    r_a = np.clip(np.floor((ys[0] - np.minimum(y0, y1)) / passo).astype(np.int64), -1, H - 1)
    quante = np.maximum(0, r_a - r_da + 1)
    s = np.repeat(np.arange(len(A)), quante)
    off = np.concatenate([[0], np.cumsum(quante)[:-1]])
    riga = r_da[s] + (np.arange(int(quante.sum())) - np.repeat(off, quante))
    yy = ys[riga]
    # regola semiaperta: un vertice condiviso da due segmenti si conta una volta
    tiene = ((y0[s] <= yy) & (yy < y1[s])) | ((y1[s] <= yy) & (yy < y0[s]))
    s, riga, yy = s[tiene], riga[tiene], yy[tiene]
    xx = A[s, 0] + (B[s, 0] - A[s, 0]) * (yy - A[s, 1]) / (B[s, 1] - A[s, 1])
    ordine = np.lexsort((xx, riga))
    riga, xx = riga[ordine], xx[ordine]
    confini = np.searchsorted(riga, np.arange(H + 1))
    terra = np.zeros((H, W), dtype=bool)
    for r in range(H):
        tagli = xx[confini[r]:confini[r + 1]]
        if len(tagli):
            terra[r] = np.searchsorted(tagli, xs) % 2 == 1
    return terra


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--gshhg", type=Path, required=True, help="cartella con GSHHS_shp/")
    p.add_argument("--uscita", type=Path, required=True)
    p.add_argument("--catalogo", type=Path, help="catalog.json da cui prendere il riquadro")
    p.add_argument("--risoluzione", type=float, default=240.0)
    p.add_argument("--limite", type=float, default=1600.0,
                   help="fondoscala in metri: piu' e' stretto, piu' fine e' il passo del byte")
    a = p.parse_args()

    if a.catalogo:
        g = json.loads(a.catalogo.read_text())["grid"]
        x0, x1 = g["bounds_3857"]["west"], g["bounds_3857"]["east"]
        y0, y1 = g["bounds_3857"]["south"], g["bounds_3857"]["north"]
    else:   # riquadro della griglia ADRIAC ricampionata, 858x844 a 1200 m
        x0, x1 = 1207115.2179729764, 2236715.217972976
        y0, y1 = 4830528.941284913, 5843328.941284913
    W = int(round((x1 - x0) / a.risoluzione))
    H = int(round((y1 - y0) / a.risoluzione))
    xs = x0 + (np.arange(W) + 0.5) * a.risoluzione
    ys = y1 - (np.arange(H) + 0.5) * a.risoluzione        # riga 0 a nord, come i frame
    lat0, lat1 = a_latitudine([y0, y1]) + np.array([-0.2, 0.2])
    lon0, lon1 = np.degrees(np.array([x0, x1]) / R) + np.array([-0.2, 0.2])

    print(f"griglia {W}x{H} a {a.risoluzione:.0f} m", file=sys.stderr)
    print("distanza dai segmenti...", file=sys.stderr)
    d = distanze(*segmenti(anelli(a.gshhg, lat0, lat1, lon0, lon1)), xs, ys, a.limite)
    print("segno per parita'...", file=sys.stderr)
    terra = terraferma(*segmenti(anelli(a.gshhg, lat0, lat1)), xs, ys)
    print(f"  terra: {terra.mean()*100:.1f}% del riquadro", file=sys.stderr)

    campo = np.clip(d, 0, a.limite) * np.where(terra, -1.0, 1.0)
    byte = np.clip(np.rint((campo / a.limite + 1.0) * 0.5 * 255.0), 0, 255).astype(np.uint8)
    a.uscita.mkdir(parents=True, exist_ok=True)
    Image.fromarray(byte, mode="L").save(a.uscita / "costa_sdf.png", optimize=True)
    (a.uscita / "costa_sdf.json").write_text(json.dumps({
        "width": W, "height": H, "resolution_m": a.risoluzione, "limite_m": a.limite,
        "x_min": x0, "x_max": x1, "y_min": y0, "y_max": y1,
        "metodo": "distanza dai segmenti GSHHG f L1, segno per parita' di attraversamenti",
    }, indent=1) + "\n")
    print(f"scritto {a.uscita / 'costa_sdf.png'}", file=sys.stderr)


if __name__ == "__main__":
    main()
