"""Indici mensili e catalogo.

Il catalogo e' cio' che il client legge per sapere cosa esiste, quindi si
scrive sempre per ultimo: se il run muore a meta', il browser semplicemente
non vede ancora i dati nuovi, invece di vedere un catalogo che promette
frame inesistenti. Niente transazioni, solo ordine di scrittura.
"""

from collections.abc import Iterable
from datetime import datetime, timezone

from .config import FIELDS, INGEST_VERSION, SCHEMA_VERSION

_FORMATO = "%Y-%m-%dT%H:%M:%SZ"


def index_key(var: str, kind: str, month: str) -> str:
    return f"index/{var}/{kind}/{month}.json"


def merge_index(existing: dict | None, records: Iterable[tuple[datetime, str]]) -> dict:
    """Fonde nuove ore in un indice mensile.

    La chiave e' l'istante valido, il valore e' il run di riferimento da cui
    prendere il frame. Se la stessa ora arriva da un run piu' recente, vince
    quello: entrambi i frame restano comunque in archivio su percorsi
    distinti, qui si sceglie solo cosa segnalare per primo.
    """
    ore: dict[str, str] = dict((existing or {}).get("hours", {}))
    for valido, riferimento in records:
        chiave = valido.astimezone(timezone.utc).strftime(_FORMATO)
        precedente = ore.get(chiave)
        if precedente is None or riferimento >= precedente:
            ore[chiave] = riferimento
    return {"hours": dict(sorted(ore.items()))}


def rebuild_indices(store, manifests) -> set[str]:
    """Aggiorna gli indici mensili toccati dai manifest passati."""
    per_indice: dict[tuple[str, str, str], list[tuple[datetime, str]]] = {}
    for m in manifests:
        riferimento = m.reference_time.astimezone(timezone.utc).strftime("%Y%m%d")
        for frame in m.frames:
            mese = frame.valid_time.astimezone(timezone.utc).strftime("%Y-%m")
            per_indice.setdefault((frame.var, m.kind, mese), []).append(
                (frame.valid_time, riferimento)
            )

    scritte: set[str] = set()
    for (variabile, tipo, mese), record in per_indice.items():
        chiave = index_key(variabile, tipo, mese)
        store.put_json(chiave, merge_index(store.get_json(chiave), record))
        scritte.add(chiave)
    return scritte


def build_catalog(store, grid_dict: dict) -> dict:
    """Costruisce il catalogo leggendo gli indici presenti sul bucket."""
    variabili = []
    for campo in FIELDS:
        voce = {
            "id": campo.id,
            "units": campo.units,
            "scale": campo.scale,
            "offset": campo.offset,
            "colormap": campo.colormap,
            "kinds": {},
        }
        for tipo in ("an", "fc"):
            mesi = sorted(
                chiave.rsplit("/", 1)[-1].removesuffix(".json")
                for chiave in store.list_keys(f"index/{campo.id}/{tipo}/")
            )
            if mesi:
                voce["kinds"][tipo] = {"months": mesi}
        variabili.append(voce)

    return {
        "schema_version": SCHEMA_VERSION,
        "ingest_version": INGEST_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime(_FORMATO),
        "grid": grid_dict,
        "variables": variabili,
    }


def write_catalog(store, catalog: dict) -> None:
    store.put_json("catalog.json", catalog)
