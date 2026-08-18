"""Configurazione statica: endpoint, variabili, regole di campionamento.

Questo modulo non fa I/O e non importa nulla del progetto: e' la radice
del grafo delle dipendenze.
"""

from dataclasses import dataclass

ADRIAC_BASE = "https://dati-simc.arpae.it/opendata/adriac/"
OBSERVED_REALTIME = (
    "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl"
)

# Alzata a 2 dalla revisione finale: il manifest registra ora `columns` (gli
# oggetti colonna, che nessun indice nomina) e `source_units` per frame, e i
# frame stanno su chiavi con i minuti. Un manifest scritto prima non e'
# leggibile con lo schema di oggi, e questa versione e' cio' che lo fa
# rilavorare invece di farlo esplodere a ogni run.
SCHEMA_VERSION = 2
INGEST_VERSION = "0.1.0"

# -32768 e' riservato al nodata, quindi l'intervallo utile e' asimmetrico.
NODATA = -32768
INT16_MIN = -32767
INT16_MAX = 32767

# Risoluzione della griglia di destinazione, in metri Web Mercator.
# A 43 gradi di latitudine corrisponde a circa 878 m al suolo, cioe' la
# risoluzione reale del modello ADRIAC (1 km).
GRID_RESOLUTION_M = 1200.0

# Distanza massima fra il centro di una cella di destinazione e il centro
# della cella di mare sorgente piu' vicina. Vedi le note in testa al piano:
# 800 m copre tutti i punti interni a una cella sorgente (semidiagonale 707 m)
# e limita lo sbordamento sulla terraferma a meno di una cella.
MAX_NEIGHBOUR_DISTANCE_M = 800.0

# Distanza massima fra una stazione e la cella di mare che la rappresenta.
# Sono due numeri e non uno perche' rispondono a due domande diverse.
# MAX_NEIGHBOUR_DISTANCE_M chiede "questo pixel puo' prendere il valore di
# quella cella?", e li' un pixel a 900 m da una cella sorgente e' quasi sempre
# terraferma, quindi va lasciato vuoto. Qui la domanda e' "quale cella
# rappresenta questa boa?", e una boa a 900 m dalla prima cella di mare e'
# comunque rappresentata da quella cella: non ce n'e' un'altra in gara.
# Al primo run reale gli 800 m del ricampionamento scartavano le due boe di
# Cervia Porto, a 922 e 923 m, che stanno in mare vero.
MAX_STATION_DISTANCE_M = 1000.0

# Stazioni che stanno in acque non marine e che la sola distanza non separa.
# Manufatto e' a 977 m, Cervia Porto a 923: fra i due ci sono 55 metri, quindi
# nessuna soglia numerica puo' distinguerli e sceglierne una fra quei due
# valori vorrebbe dire tarare sul caso che si ha davanti. L'esclusione va per
# nome, e ogni voce porta con se' il motivo: senza, verra' rimessa in
# discussione o tolta senza sapere cosa si sta scambiando.
# Le altre due lagunari del delta (marefe-logonovo a 2.788 m e
# marefe-bellocchio a 3.003 m) restano fuori per distanza e non vanno nominate.
EXCLUDED_STATIONS: dict[str, str] = {
    "marefe-manufatto": (
        "salinita' misurata 0,02 parti per mille il 2026-08-18, cioe' acqua "
        "dolce: la colonna del modello marino non significa niente"
    ),
}

# ADRIAC conserva 8 giorni. Oltre questa finestra non c'e' nulla da riconciliare.
WINDOW_DAYS = 8

OBSERVED_NETWORKS = ("boa", "marefe")


@dataclass(frozen=True)
class FieldSpec:
    """Un array pubblicato.

    Piu' FieldSpec possono leggere la stessa variabile NetCDF: le direzioni
    producono due array (seno e coseno) dalla stessa sorgente.
    """

    id: str
    group: str
    nc_name: str
    scale: float
    units: str
    colormap: str
    source_units: str
    transform: str = "identity"
    offset: float = 0.0


# `units` e' l'unita' dell'array pubblicato, `source_units` quella attesa
# nell'attributo NetCDF della variabile sorgente. Sono due cose diverse e non
# vanno confuse: ARPAE scrive "meter" dove noi pubblichiamo "m", e le due
# componenti di direzione nascono da gradi ma escono adimensionali. Le stringhe
# di source_units sono state lette dalle intestazioni reali dell'archivio il
# 2026-08-13, non dedotte: sbagliarle fermerebbe ogni run.
FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("hwave", "his_HPDwave", "Hwave", 0.001, "m", "amp", "meter"),
    FieldSpec("pwave", "his_HPDwave", "Pwave_top", 0.01, "s", "tempo", "second"),
    FieldSpec("dwave_sin", "his_HPDwave", "Dwave", 0.0001, "1", "phase", "degrees", "sin"),
    FieldSpec("dwave_cos", "his_HPDwave", "Dwave", 0.0001, "1", "phase", "degrees", "cos"),
    FieldSpec(
        "ubar", "his_2dcur", "ubar_eastward", 0.001, "m s-1", "speed", "meter second-1"
    ),
    FieldSpec(
        "vbar", "his_2dcur", "vbar_northward", 0.001, "m s-1", "speed", "meter second-1"
    ),
    FieldSpec("sealevel", "qck_sl", "sea_level", 0.001, "m", "balance", "meter"),
)

FIELD_GROUPS: tuple[str, ...] = tuple(dict.fromkeys(f.group for f in FIELDS))

# Gruppi 3D da cui estrarre i profili verticali sulle stazioni.
# Solo da file di analisi: i profili da previsione costerebbero circa
# 2,8 GB al giorno di download per un caso d'uso non previsto.
# Tutte e tre le variabili stanno su punti rho, verificato sulle intestazioni.
PROFILE_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("his_temp", ("temp",)),
    ("his_salt", ("salt",)),
    ("his_cur", ("u_eastward", "v_northward")),
)

# "full" tiene tutti gli istanti del file, "hourly" solo quelli al minuto 00.
_SAMPLING: dict[tuple[str, str], str] = {
    ("qck_sl", "fc"): "hourly",
}
DEFAULT_SAMPLING = "full"


def sampling_for(group: str, kind: str) -> str:
    return _SAMPLING.get((group, kind), DEFAULT_SAMPLING)


def fields_for(group: str) -> tuple[FieldSpec, ...]:
    return tuple(f for f in FIELDS if f.group == group)
