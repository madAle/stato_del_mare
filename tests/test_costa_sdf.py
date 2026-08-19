"""Il nucleo del campo di distanza dalla costa.

Gli strumenti in `strumenti/` non avevano nessun test, ed e' il motivo per cui
il difetto delle Tremiti (un settore di mare col segno della terraferma, largo
una ventina di chilometri) e' arrivato fino a schermo: il calcolo viveva dentro
`main()`, insieme alla lettura dello shapefile e alla scrittura del PNG, e non
c'era niente che si potesse chiamare senza 920 MB di coste OSM.
"""

import importlib.util
from pathlib import Path

import numpy as np
import pytest

RADICE = Path(__file__).resolve().parents[1]


def _carica():
    """Importa lo strumento, che non e' un pacchetto ma uno script."""
    spec = importlib.util.spec_from_file_location(
        "costa_sdf", RADICE / "strumenti" / "costa_sdf.py"
    )
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


costa_sdf = _carica()


def isola_quadrata(lato=1000.0):
    """Un'isola quadrata, anello chiuso, orientata come le coste OSM.

    In OSM la terra sta a sinistra del verso di percorrenza. Con l'asse y verso
    l'alto (metri Mercator) questo verso e' orario.
    """
    return np.array(
        [[-lato, -lato], [-lato, lato], [lato, lato], [lato, -lato], [-lato, -lato]],
        dtype=float,
    )


def griglia(passo=100.0, mezza=6000.0):
    g = np.arange(-mezza, mezza + passo, passo)
    mx, my = np.meshgrid(g, g)
    return np.column_stack([mx.ravel(), my.ravel()]), mx, my


def test_il_mare_attorno_a_unisola_e_tutto_positivo():
    """Il difetto vero, ridotto al minimo.

    Al vertice dove l'anello si chiude i due segmenti adiacenti sono l'ultimo e
    il primo. Trattandolo come "vicino assente" il segno lo decide una normale
    sola, e tutti i punti il cui elemento piu' vicino e' quel vertice prendono
    il segno sbagliato: un settore che si allarga con la distanza, ancorato al
    vertice. Su un quadrato degenera in una semiretta, su un'isola vera diventa
    la fascia vista attorno alle Tremiti il 2026-08-19.
    """
    lato = 1000.0
    P, mx, my = griglia()
    _, segno = costa_sdf.campo_con_segno([isola_quadrata(lato)], P)
    segno = segno.reshape(mx.shape)

    dentro = (np.abs(mx) <= lato) & (np.abs(my) <= lato)
    in_mare_ma_terra = (segno < 0) & ~dentro
    assert not in_mare_ma_terra.any(), (
        f"{in_mare_ma_terra.sum()} punti di mare aperto hanno il segno della "
        f"terraferma, fra x {mx[in_mare_ma_terra].min():.0f} e "
        f"{mx[in_mare_ma_terra].max():.0f}"
    )


def test_l_entroterra_dell_isola_resta_negativo():
    """L'altra meta': se il segno fosse positivo ovunque il test sopra passerebbe
    per il motivo sbagliato, cioe' perche' non si distingue piu' niente."""
    lato = 1000.0
    P, mx, my = griglia()
    _, segno = costa_sdf.campo_con_segno([isola_quadrata(lato)], P)
    segno = segno.reshape(mx.shape)

    ben_dentro = (np.abs(mx) <= lato - 200) & (np.abs(my) <= lato - 200)
    assert (segno[ben_dentro] < 0).all()


def test_la_distanza_e_quella_geometrica_non_quella_di_una_maschera():
    """Una trasformata di distanza su maschera non conosce nessun valore sotto
    il texel. Qui la distanza da un punto noto deve venire esatta."""
    lato = 1000.0
    P = np.array([[0.0, -3000.0], [2500.0, 0.0]])
    dist, segno = costa_sdf.campo_con_segno([isola_quadrata(lato)], P)
    assert dist == pytest.approx([2000.0, 1500.0], abs=1.0)
    assert (segno > 0).all()


def test_una_polilinea_aperta_non_si_chiude_da_sola():
    """La costa OSM arriva spezzata in tronconi: chiuderli tutti d'ufficio
    inventerebbe un segmento che non esiste, fra l'inizio e la fine del
    troncone, e il campo ne porterebbe il segno."""
    aperta = np.array([[-1000.0, 0.0], [0.0, 0.0], [0.0, 1000.0]])
    A, B, prec, succ = costa_sdf.segmenti_e_vicini([aperta])
    assert len(A) == 2
    assert prec.tolist() == [-1, 0]
    assert succ.tolist() == [1, -1]


def test_un_anello_chiuso_dichiara_i_vicini_attraverso_la_cucitura():
    chiuso = isola_quadrata()
    A, _, prec, succ = costa_sdf.segmenti_e_vicini([chiuso])
    assert len(A) == 4
    # il precedente del primo e' l'ultimo, il successivo dell'ultimo e' il primo
    assert prec.tolist() == [3, 0, 1, 2]
    assert succ.tolist() == [1, 2, 3, 0]


def test_due_linee_non_si_considerano_vicine():
    """Due tronconi diversi non hanno segmenti adiacenti fra loro, anche se nel
    file stanno uno dopo l'altro."""
    una = np.array([[0.0, 0.0], [100.0, 0.0]])
    altra = np.array([[500.0, 500.0], [600.0, 500.0]])
    _, _, prec, succ = costa_sdf.segmenti_e_vicini([una, altra])
    assert prec.tolist() == [-1, -1]
    assert succ.tolist() == [-1, -1]


def isola_in_due_pezzi(lato=1000.0):
    """La stessa isola, ma memorizzata come due archi aperti che condividono
    entrambe le estremita'.

    E' cosi' che arriva davvero: `coastlines-split-4326` spezza le vie di costa
    in pezzi da al massimo mille nodi, quindi l'anello di un'isola sta in due o
    piu' polilinee aperte. Le isole Tremiti sono esattamente questo caso.
    """
    anello = isola_quadrata(lato)
    return [anello[:3].copy(), anello[2:].copy()]


def test_il_vicino_si_trova_anche_in_un_altro_pezzo():
    _, _, prec, succ = costa_sdf.segmenti_e_vicini(isola_in_due_pezzi())
    # segmenti: 0,1 dal primo pezzo, 2,3 dal secondo. L'anello e' 0->1->2->3->0
    assert prec.tolist() == [3, 0, 1, 2]
    assert succ.tolist() == [1, 2, 3, 0]


def test_il_mare_e_positivo_anche_se_l_isola_arriva_spezzata():
    """Il difetto delle Tremiti, ridotto al minimo.

    Al punto dove i due pezzi si toccano il vicino sta in un'altra polilinea.
    Cercandolo solo dentro il proprio pezzo, quel vertice resta senza
    pseudonormale e il segno lo decide una normale sola: nasce il settore di
    mare col segno della terraferma, ancorato al punto di giunzione. Misurato
    sul campo pubblicato: l'apice della fascia stava a 226 m dalla giunzione fra
    i pezzi 4 e 5 della costa OSM, cioe' dentro una cella della griglia.
    """
    lato = 1000.0
    P, mx, my = griglia()
    _, segno = costa_sdf.campo_con_segno(isola_in_due_pezzi(lato), P)
    segno = segno.reshape(mx.shape)

    dentro = (np.abs(mx) <= lato) & (np.abs(my) <= lato)
    in_mare_ma_terra = (segno < 0) & ~dentro
    assert not in_mare_ma_terra.any(), (
        f"{in_mare_ma_terra.sum()} punti di mare aperto hanno il segno della terraferma"
    )
