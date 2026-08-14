"""Anagrafica delle stazioni marine.

Il flusso in tempo reale e' JSONL con codici variabile BUFR/DB-All.e. Qui
interessano solo le reti marine: le boe ondametriche e i mareografi.

Nessuna boa ARPAE misura profili verticali: le colonne d'acqua che
pubblicheremo sono sempre dati di modello, e vanno etichettate come tali.
"""

import json
import logging
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

import requests

from .config import OBSERVED_NETWORKS, OBSERVED_REALTIME

log = logging.getLogger(__name__)


class StationCollision(Exception):
    """Due nomi di stazione diversi producono lo stesso identificativo.

    Non e' un caso da ignorare: l'identificativo e' un segmento di percorso
    sull'object store, quindi due stazioni fuse su uno stesso id mescolerebbero
    le loro storie in un archivio permanente. Meglio fermarsi.
    """

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
    if not pezzo:
        raise ValueError(f"nome di stazione senza caratteri utili: {name!r}")
    return f"{network}-{pezzo}"


def _accumula(record: dict, accumulate: dict[str, dict]) -> None:
    """Aggiunge un record all'anagrafica in costruzione.

    Solleva se il record e' malformato: il chiamante lo salta. Solleva
    StationCollision se due nomi diversi finiscono sullo stesso identificativo,
    e quella invece non va saltata.
    """
    rete = record.get("network")
    if rete not in OBSERVED_NETWORKS:
        return

    nome = None
    variabili: set[str] = set()
    for blocco in record.get("data", []):
        for codice, valore in blocco.get("vars", {}).items():
            if codice == "B01019":
                nome = valore.get("v")
            if not codice.startswith(_PREFISSI_NON_OSSERVATI):
                variabili.add(codice)

    if not nome:
        return

    identificativo = slugify(rete, nome)
    esistente = accumulate.get(identificativo)
    if esistente is not None and esistente["name"] != nome:
        raise StationCollision(
            f"{identificativo!r} generato sia da {esistente['name']!r} "
            f"sia da {nome!r}"
        )

    voce = accumulate.setdefault(
        identificativo,
        {
            "name": nome,
            "network": rete,
            # Le coordinate si prendono dal primo record e non si aggiornano:
            # sono infrastrutture fisse, e un aggiornamento silenzioso
            # sposterebbe la stazione a meta' archivio.
            "lon": record["lon"] / _SCALA_COORDINATE,
            "lat": record["lat"] / _SCALA_COORDINATE,
            "variables": set(),
        },
    )
    voce["variables"].update(variabili)


def parse_realtime(lines: Iterable[str]) -> list[Station]:
    """Costruisce l'anagrafica dal flusso JSONL.

    Un record malformato viene saltato senza fermare gli altri: il flusso
    arriva da fuori e non ne controlliamo la forma, quindi una riga storta non
    deve far perdere tutte le stazioni gia' accumulate.
    """
    accumulate: dict[str, dict] = {}

    for riga in lines:
        riga = riga.strip()
        if not riga:
            continue
        try:
            _accumula(json.loads(riga), accumulate)
        except StationCollision:
            raise
        except (json.JSONDecodeError, AttributeError, KeyError, TypeError, ValueError) as errore:
            log.debug("riga ignorata: %s", errore)
            continue

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


def merge_stations(existing: list[Station], fresh: list[Station]) -> list[Station]:
    """Fonde l'anagrafica sul bucket con quella appena letta.

    `realtime.jsonl` e' un'istantanea scorrevole, non un elenco completo: una
    stazione in manutenzione ne esce e rientra quando torna in servizio.
    Sostituire l'anagrafica invece di fonderla la farebbe sparire, e con lei
    l'estrazione della sua colonna per tutto il tempo dell'assenza: dentro la
    finestra di 8 giorni quel dato e' perso per sempre. L'anagrafica e' anche
    l'unico posto in cui e' scritto a chi appartiene un file colonna storico.

    Le coordinate di una stazione gia' nota non si aggiornano: sono
    infrastrutture fisse, e spostarle a meta' archivio cambierebbe il
    significato delle colonne gia' scritte. E' la stessa regola gia' applicata
    dentro un singolo run in `_accumula`.
    """
    fuse = {s.id: s for s in existing}
    for stazione in fresh:
        precedente = fuse.get(stazione.id)
        if precedente is None:
            fuse[stazione.id] = stazione
            continue
        fuse[stazione.id] = Station(
            id=stazione.id,
            name=stazione.name,
            network=stazione.network,
            lon=precedente.lon,
            lat=precedente.lat,
            variables=stazione.variables,
        )
    return [fuse[identificativo] for identificativo in sorted(fuse)]


def stations_from_dict(d: dict | None) -> list[Station]:
    """Inverso di stations_to_dict. Un dizionario assente vale elenco vuoto."""
    return [
        Station(
            id=s["id"],
            name=s["name"],
            network=s["network"],
            lon=s["lon"],
            lat=s["lat"],
            variables=tuple(s["variables"]),
        )
        for s in (d or {}).get("stations", [])
    ]


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
