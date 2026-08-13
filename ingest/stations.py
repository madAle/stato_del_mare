"""Anagrafica delle stazioni marine.

Il flusso in tempo reale e' JSONL con codici variabile BUFR/DB-All.e. Qui
interessano solo le reti marine: le boe ondametriche e i mareografi.

Nessuna boa ARPAE misura profili verticali: le colonne d'acqua che
pubblicheremo sono sempre dati di modello, e vanno etichettate come tali.
"""

import json
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

import requests

from .config import OBSERVED_NETWORKS, OBSERVED_REALTIME

# Le coordinate arrivano come interi moltiplicati per centomila.
_SCALA_COORDINATE = 100_000.0

# I codici anagrafici e temporali non sono grandezze osservate.
_PREFISSI_NON_OSSERVATI = ("B01", "B04", "B05", "B06")

_NON_ALFANUMERICO = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    network: str
    lon: float
    lat: float
    variables: tuple[str, ...]


def slugify(network: str, name: str) -> str:
    normalizzato = unicodedata.normalize("NFKD", name)
    senza_accenti = normalizzato.encode("ascii", "ignore").decode("ascii")
    pezzo = _NON_ALFANUMERICO.sub("-", senza_accenti.lower()).strip("-")
    return f"{network}-{pezzo}"


def parse_realtime(lines: Iterable[str]) -> list[Station]:
    accumulate: dict[str, dict] = {}

    for riga in lines:
        riga = riga.strip()
        if not riga:
            continue
        try:
            record = json.loads(riga)
        except json.JSONDecodeError:
            continue

        rete = record.get("network")
        if rete not in OBSERVED_NETWORKS:
            continue

        nome = None
        variabili: set[str] = set()
        for blocco in record.get("data", []):
            for codice, valore in blocco.get("vars", {}).items():
                if codice == "B01019":
                    nome = valore.get("v")
                if not codice.startswith(_PREFISSI_NON_OSSERVATI):
                    variabili.add(codice)

        if not nome:
            continue

        identificativo = slugify(rete, nome)
        voce = accumulate.setdefault(
            identificativo,
            {
                "name": nome,
                "network": rete,
                "lon": record["lon"] / _SCALA_COORDINATE,
                "lat": record["lat"] / _SCALA_COORDINATE,
                "variables": set(),
            },
        )
        voce["variables"].update(variabili)

    return [
        Station(
            id=identificativo,
            name=v["name"],
            network=v["network"],
            lon=v["lon"],
            lat=v["lat"],
            variables=tuple(sorted(v["variables"])),
        )
        for identificativo, v in sorted(accumulate.items())
    ]


def fetch_stations(url: str = OBSERVED_REALTIME, session=None) -> list[Station]:
    ses = session or requests
    with ses.get(url, stream=True, timeout=300) as risposta:
        risposta.raise_for_status()
        return parse_realtime(
            riga.decode("utf-8", "replace") for riga in risposta.iter_lines()
        )


def stations_to_dict(stations: list[Station]) -> dict:
    return {
        "stations": [
            {
                "id": s.id,
                "name": s.name,
                "network": s.network,
                "lon": s.lon,
                "lat": s.lat,
                "variables": list(s.variables),
            }
            for s in stations
        ]
    }
