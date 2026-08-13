"""Configurazione statica: endpoint, variabili, regole di campionamento.

Questo modulo non fa I/O e non importa nulla del progetto: e' la radice
del grafo delle dipendenze.
"""

from dataclasses import dataclass

ADRIAC_BASE = "https://dati-simc.arpae.it/opendata/adriac/"
OBSERVED_REALTIME = (
    "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl"
)

SCHEMA_VERSION = 1
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
