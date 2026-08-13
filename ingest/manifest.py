"""Manifest di run.

E' la ragione per cui l'archivio verra' ancora qualcosa fra anni: registra
provenienza (da quale file, con che impronta), auto-descrizione (unita' e
fattori di scala nel dato, non nel codice) e riproducibilita' (versione di
schema e di codice).

La deduplica cade fuori gratis: se l'impronta del file sorgente coincide con
quella registrata, non c'e' niente da rifare.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from .config import INGEST_VERSION, SCHEMA_VERSION

_FORMATO = "%Y-%m-%dT%H:%M:%SZ"


def _dump_time(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime(_FORMATO)


def _load_time(s: str) -> datetime:
    return datetime.strptime(s, _FORMATO).replace(tzinfo=timezone.utc)


@dataclass
class FrameRecord:
    var: str
    valid_time: datetime
    path: str
    sha256: str
    scale: float
    offset: float
    min: float | None
    max: float | None
    nodata_count: int
    clipped_count: int

    def to_dict(self) -> dict:
        d = asdict(self)
        d["valid_time"] = _dump_time(self.valid_time)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "FrameRecord":
        d = dict(d)
        d["valid_time"] = _load_time(d["valid_time"])
        return cls(**d)


@dataclass
class RunManifest:
    source_url: str
    source_sha256: str
    source_bytes: int
    source_last_modified: str
    reference_time: datetime
    kind: str
    group: str
    grid_ref: str
    ingested_at: datetime
    frames: list[FrameRecord] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "ingest_version": INGEST_VERSION,
            "ingested_at": _dump_time(self.ingested_at),
            "source": {
                "url": self.source_url,
                "sha256": self.source_sha256,
                "bytes": self.source_bytes,
                "last_modified": self.source_last_modified,
            },
            "reference_time": _dump_time(self.reference_time),
            "kind": self.kind,
            "group": self.group,
            "grid": self.grid_ref,
            "frames": [f.to_dict() for f in self.frames],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "RunManifest":
        return cls(
            source_url=d["source"]["url"],
            source_sha256=d["source"]["sha256"],
            source_bytes=d["source"]["bytes"],
            source_last_modified=d["source"]["last_modified"],
            reference_time=_load_time(d["reference_time"]),
            kind=d["kind"],
            group=d["group"],
            grid_ref=d["grid"],
            ingested_at=_load_time(d["ingested_at"]),
            frames=[FrameRecord.from_dict(f) for f in d["frames"]],
        )


def manifest_key(date: str, kind: str, group: str) -> str:
    """runs/{YYYY-MM-DD}/{kind}/{gruppo}.json

    Un manifest per gruppo di file e non per run: in un giorno si lavorano
    piu' file sorgente per tipo, e se uno riesce e un altro fallisce il
    progresso parziale deve restare registrato.
    """
    iso = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    return f"runs/{iso}/{kind}/{group}.json"


def already_ingested(existing: dict | None, source_sha256: str) -> bool:
    if not existing:
        return False
    if existing.get("schema_version") != SCHEMA_VERSION:
        return False
    return existing.get("source", {}).get("sha256") == source_sha256
