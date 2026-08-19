# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "pillow"]
# ///
"""Campo di distanza con segno dalla linea di costa, per il ritaglio nella SPA.

Si esegue una volta sola: la costa non cambia in fretta.

    curl -O https://osmdata.openstreetmap.de/download/coastlines-split-4326.zip
    unzip coastlines-split-4326.zip
    uv run strumenti/costa_sdf.py --coste coastlines-split-4326 --uscita web/public

Tre scelte qui dentro sono costate tempo e non vanno rifatte al contrario.

**La sorgente e' la costa di OpenStreetMap, non GSHHG.** Non perche' sia piu'
esatta in assoluto, ma perche' e' quella da cui nascono le tile disegnate sotto
il campo, e l'occhio confronta il campo con la costa che vede. Con GSHHG il
campo sbordava sulla terraferma disegnata fino a 1.138 m a Venezia e 847 m sul
delta; con OSM gli stessi punti scendono a 161 e 121 m, e a Unije a zoom 13 la
sovrapposizione oltre i 100 m sparisce del tutto. Resta il disaccordo a zoom
bassi, dove sono le tile a disegnare una costa semplificata.

**La distanza si misura dai SEGMENTI, non da una maschera rasterizzata.** Una
trasformata di distanza su maschera non conosce nessun valore sotto il texel: il
suo livello zero e' la scaletta della rasterizzazione e nessuna interpolazione la
raddrizza. Diagnosi in una riga: istogramma dei valori vicino allo zero; se sono
pochi e discreti, viene da una maschera.

**Il segno viene dalla regola della mano.** In OSM la costa e' orientata con la
terra a sinistra del verso di percorrenza. Sui vertici la normale di un solo
segmento sbaglia dentro il cuneo, quindi si usa la somma delle due normali
adiacenti, che e' la pseudonormale del vertice.

**E i due segmenti adiacenti vanno cercati anche attraverso la cucitura
dell'anello.** Su una polilinea chiusa il vicino del primo segmento e' l'ultimo,
non l'indice -1. Cercandolo solo a `indice +- 1` il vertice di chiusura restava
senza pseudonormale, e tutti i punti il cui elemento di costa piu' vicino era
quel vertice prendevano il segno della terraferma: un settore che si allarga con
la distanza, visto come una fascia di venti chilometri accanto alle isole
Tremiti il 2026-08-19. Sulle isole e' vistoso perche' la cucitura cade su un
angolo; su una costa continua i tronconi si spezzano a meta' di un tratto
diritto, dove le due normali quasi coincidono e il settore ha ampiezza nulla.
"""

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

R = 6378137.0
PASSO_INFITTIMENTO = 40.0   # errore massimo del campionamento: meta' passo,
                            # sotto il passo di quantizzazione del byte
BLOCCO = 1_000_000          # punti per volta: il calcolo tiene otto candidati
                            # per punto e su tutta la griglia non entrerebbe


def polilinee(percorso: Path, lon0, lat0, lon1, lat1):
    """Polilinee di costa che toccano il riquadro, in gradi.

    Si legge il .shp a mano invece di usare una libreria perche' ogni record
    porta il proprio riquadro nell'intestazione: si decide sul riquadro e si
    salta il resto, senza decodificare i punti del 99% di costa del mondo che
    non serve. Sono 876.603 record e mezzo secondo.
    """
    tenute = []
    with open(percorso / "lines.shp", "rb") as f:
        f.seek(100)
        while True:
            testa = f.read(8)
            if len(testa) < 8:
                break
            _, parole = struct.unpack(">ii", testa)
            corpo = f.read(parole * 2)
            tipo, x0, y0, x1, y1 = struct.unpack("<idddd", corpo[:36])
            if tipo != 3 or x1 < lon0 or x0 > lon1 or y1 < lat0 or y0 > lat1:
                continue
            nparti, npunti = struct.unpack("<ii", corpo[36:44])
            parti = np.frombuffer(corpo[44:44 + 4 * nparti], dtype="<i4")
            punti = np.frombuffer(corpo[44 + 4 * nparti:44 + 4 * nparti + 16 * npunti],
                                  dtype="<f8").reshape(-1, 2)
            for i in range(nparti):
                a = parti[i]
                b = parti[i + 1] if i + 1 < nparti else npunti
                if b - a > 1:
                    tenute.append(punti[a:b].copy())
    return tenute


def a_mercatore(p):
    x = np.radians(p[:, 0]) * R
    y = R * np.log(np.tan(np.pi / 4 + np.radians(np.clip(p[:, 1], -85.0, 85.0)) / 2))
    return np.column_stack([x, y])


def segmenti_e_vicini(linee):
    """Segmenti delle polilinee, e per ognuno il segmento precedente e il successivo.

    `-1` dove il vicino non c'e'. Il vicino si cerca **per coordinata
    condivisa**, non per indice dentro la stessa polilinea, e la differenza non
    e' teorica: `coastlines-split-4326` spezza le vie di costa in pezzi da al
    massimo mille nodi, quindi l'anello di un'isola arriva come due o piu'
    polilinee aperte che si toccano agli estremi. Le isole Tremiti sono
    esattamente questo caso, e cercando il vicino a `indice +- 1` il punto di
    giunzione restava senza pseudonormale.

    Una regola sola copre tre casi: dentro un pezzo il vicino e' l'indice
    accanto, fra due pezzi e' l'estremo condiviso, e su un anello chiuso in una
    sola polilinea e' la cucitura (il primo nodo coincide con l'ultimo).

    Dove piu' di due segmenti si toccano nello stesso nodo il vicino e'
    ambiguo e resta `-1`: meglio la normale del solo segmento che sceglierne
    uno a caso fra tre.
    """
    A, B = [], []
    for p in linee:
        if len(p) < 2:
            continue
        A.append(p[:-1])
        B.append(p[1:])
    if not A:
        vuoto_p = np.empty((0, 2))
        vuoto_i = np.empty(0, dtype=np.int64)
        return vuoto_p, vuoto_p, vuoto_i, vuoto_i
    A = np.concatenate(A)
    B = np.concatenate(B)

    # Un identificatore intero per ogni coordinata distinta, calcolato in una
    # volta sola su inizi e fini insieme: due nodi sono lo stesso nodo se hanno
    # gli stessi byte, che e' vero quando vengono dallo stesso valore nel file.
    tutti = np.ascontiguousarray(np.concatenate([A, B]))
    vista = tutti.view([("x", tutti.dtype), ("y", tutti.dtype)]).ravel()
    _, nodo = np.unique(vista, return_inverse=True)
    nodo_di_A, nodo_di_B = nodo[:len(A)], nodo[len(A):]
    n_nodi = int(nodo.max()) + 1

    def unico(nodo_di, quanti):
        """Per ogni nodo, l'unico segmento che vi si aggancia, o -1 se non e' unico."""
        tabella = np.full(n_nodi, -1, dtype=np.int64)
        tabella[nodo_di] = np.arange(quanti)
        tabella[np.bincount(nodo_di, minlength=n_nodi) != 1] = -1
        return tabella

    prec = unico(nodo_di_B, len(B))[nodo_di_A]
    succ = unico(nodo_di_A, len(A))[nodo_di_B]
    # un segmento non e' vicino di se stesso (succede solo se e' lungo zero)
    proprio = np.arange(len(A))
    prec[prec == proprio] = -1
    succ[succ == proprio] = -1
    return A, B, prec, succ


def campo_con_segno(linee, P, blocco=BLOCCO, verboso=False):
    """Distanza dalla costa e segno, per ogni punto di `P`. Positivo in mare.

    Array dentro, array fuori: nessun file, nessuna rete. E' il nucleo che si
    puo' provare, e finche' e' stato scritto dentro main() nessuno l'ha provato.

    `linee` sono polilinee in metri Web Mercator, orientate come le coste OSM
    (terra a sinistra del verso di percorrenza).
    """
    A, B, prec, succ = segmenti_e_vicini(linee)
    lung = np.hypot(*(B - A).T)

    n = np.maximum(1, np.ceil(lung / PASSO_INFITTIMENTO)).astype(np.int64)
    seg = np.repeat(np.arange(len(n)), n)
    off = np.concatenate([[0], np.cumsum(n)[:-1]])
    t = (np.arange(int(n.sum())) - np.repeat(off, n)) / n[seg]
    albero = cKDTree(A[seg] + (B[seg] - A[seg]) * t[:, None])
    if verboso:
        print(f"segmenti {len(A)}, costa {lung.sum()/1000:.0f} km, "
              f"campioni {len(seg)}", file=sys.stderr)

    def normale_mare(i):
        """Normale verso il mare: la terra sta a sinistra del verso di percorrenza."""
        u = B[i] - A[i]
        u = u / np.maximum(np.hypot(*u.T), 1e-9)[:, None]
        return np.column_stack([-u[:, 1], u[:, 0]])

    dist = np.empty(len(P))
    segno = np.empty(len(P))
    for i0 in range(0, len(P), blocco):
        Q = P[i0:i0 + blocco]
        # Il campione piu' vicino non basta: serve il SEGMENTO piu' vicino, e
        # vicino a un vertice non e' quello del campione. Otto candidati.
        _, vic = albero.query(Q, k=min(8, albero.n), workers=-1)
        vic = np.atleast_2d(vic)
        cand = seg[vic]
        Ac, ab = A[cand], B[cand] - A[cand]
        aq = Q[:, None, :] - Ac
        tt = np.clip((aq * ab).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-9), 0.0, 1.0)
        vicino = Ac + tt[..., None] * ab
        dd = np.hypot(*(Q[:, None, :] - vicino).transpose(2, 0, 1))
        scelto = np.argmin(dd, axis=1)
        r = np.arange(len(Q))
        s_scelto, t_scelto, punto = cand[r, scelto], tt[r, scelto], vicino[r, scelto]

        nrm = normale_mare(s_scelto)
        for estremo, vicino_di in ((0.0, prec), (1.0, succ)):
            v = np.flatnonzero(np.isclose(t_scelto, estremo))
            if not len(v):
                continue
            j = vicino_di[s_scelto[v]]
            ok = j >= 0
            if ok.any():
                somma = nrm[v].copy()
                somma[ok] += normale_mare(j[ok])
                nrm[v] = somma / np.maximum(np.hypot(*somma.T), 1e-9)[:, None]

        dist[i0:i0 + blocco] = dd[r, scelto]
        segno[i0:i0 + blocco] = np.where(((Q - punto) * nrm).sum(1) > 0, 1.0, -1.0)
        if verboso:
            print(f"  {min(i0 + blocco, len(P))}/{len(P)}", file=sys.stderr)
    return dist, segno


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--coste", type=Path, required=True,
                    help="cartella con lines.shp di coastlines-split-4326")
    ap.add_argument("--uscita", type=Path, required=True)
    ap.add_argument("--catalogo", type=Path, help="catalog.json da cui prendere il riquadro")
    ap.add_argument("--risoluzione", type=float, default=240.0)
    ap.add_argument("--limite", type=float, default=1600.0,
                    help="fondoscala in metri: piu' e' stretto, piu' fine e' il passo del byte")
    a = ap.parse_args()

    if a.catalogo:
        g = json.loads(a.catalogo.read_text())["grid"]["bounds_3857"]
        x0, x1, y0, y1 = g["west"], g["east"], g["south"], g["north"]
    else:   # riquadro della griglia ADRIAC ricampionata, 858x844 a 1200 m
        x0, x1 = 1207115.2179729764, 2236715.217972976
        y0, y1 = 4830528.941284913, 5843328.941284913
    W = int(round((x1 - x0) / a.risoluzione))
    H = int(round((y1 - y0) / a.risoluzione))

    # Il margine e' largo apposta: il segno di un punto lo decide il segmento di
    # costa piu' vicino, e per un punto molto nell'entroterra quel segmento puo'
    # stare ben fuori dal riquadro.
    lon0, lon1 = np.degrees(np.array([x0, x1]) / R) + np.array([-2.0, 2.0])
    lat0, lat1 = np.degrees(2 * np.arctan(np.exp(np.array([y0, y1]) / R)) - np.pi / 2) \
        + np.array([-2.0, 2.0])
    linee = polilinee(a.coste, lon0, lat0, lon1, lat1)
    print(f"polilinee {len(linee)}, nodi {sum(len(t) for t in linee)}", file=sys.stderr)

    xs = x0 + (np.arange(W) + 0.5) * a.risoluzione
    ys = y1 - (np.arange(H) + 0.5) * a.risoluzione       # riga 0 a nord, come i frame
    MX, MY = np.meshgrid(xs, ys)
    P = np.column_stack([MX.ravel(), MY.ravel()])

    dist, segno = campo_con_segno([a_mercatore(linea) for linea in linee], P, verboso=True)

    from PIL import Image  # solo per scrivere: il nucleo sopra e' puro

    campo = (np.clip(dist, 0, a.limite) * segno).reshape(H, W)
    byte = np.clip(np.rint((campo / a.limite + 1.0) * 0.5 * 255.0), 0, 255).astype(np.uint8)
    a.uscita.mkdir(parents=True, exist_ok=True)
    Image.fromarray(byte, mode="L").save(a.uscita / "costa_sdf.png", optimize=True)
    (a.uscita / "costa_sdf.json").write_text(json.dumps({
        "width": W, "height": H, "resolution_m": a.risoluzione, "limite_m": a.limite,
        "x_min": x0, "x_max": x1, "y_min": y0, "y_max": y1,
        "metodo": "distanza dai segmenti della costa OSM, segno dalla regola della mano",
    }, indent=1) + "\n")
    print(f"terra: {(campo < 0).mean()*100:.1f}% del riquadro, "
          f"scritto {a.uscita / 'costa_sdf.png'}", file=sys.stderr)


if __name__ == "__main__":
    main()
