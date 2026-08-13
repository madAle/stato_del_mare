"""Il manifest e' il contratto d'archivio: deve reggere il giro completo."""
import json
from datetime import datetime, timezone

from ingest import manifest
from ingest.config import SCHEMA_VERSION


def _manifest_di_prova():
    return manifest.RunManifest(
        source_url="https://esempio/20260813_adriac_1km_his_HPDwave_an.nc.gz",
        source_sha256="abc123",
        source_bytes=24117248,
        source_last_modified="Thu, 13 Aug 2026 10:34:00 GMT",
        reference_time=datetime(2026, 8, 13, tzinfo=timezone.utc),
        kind="an",
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=datetime(2026, 8, 13, 11, 20, tzinfo=timezone.utc),
        frames=[
            manifest.FrameRecord(
                var="hwave",
                valid_time=datetime(2026, 8, 12, 1, tzinfo=timezone.utc),
                path="frames/hwave/an/20260813/2026-08-12T0100.bin",
                sha256="def456",
                source_units="meter",
                scale=0.001,
                offset=0.0,
                min=0.02,
                max=1.87,
                nodata_count=729412,
                clipped_count=0,
            )
        ],
    )


def test_la_chiave_e_per_gruppo_non_per_run():
    """Un giorno contiene piu' file sorgente per tipo: con un manifest unico
    il progresso parziale non si registrerebbe."""
    assert (
        manifest.manifest_key("20260813", "an", "his_HPDwave")
        == "runs/2026-08-13/an/his_HPDwave.json"
    )


def test_giro_completo_di_serializzazione():
    originale = _manifest_di_prova()
    tornato = manifest.RunManifest.from_dict(originale.to_dict())
    assert tornato == originale


def test_il_dizionario_e_json_serializzabile_e_versionato():
    d = _manifest_di_prova().to_dict()
    json.dumps(d)
    assert d["schema_version"] == SCHEMA_VERSION
    assert d["ingest_version"]


def test_gli_istanti_sono_in_utc_con_la_z():
    d = _manifest_di_prova().to_dict()
    assert d["reference_time"] == "2026-08-13T00:00:00Z"
    assert d["frames"][0]["valid_time"] == "2026-08-12T01:00:00Z"


def test_la_deduplica_riconosce_lo_stesso_file():
    esistente = _manifest_di_prova().to_dict()
    assert manifest.already_ingested(esistente, "abc123")
    assert not manifest.already_ingested(esistente, "impronta-diversa")


def test_senza_manifest_precedente_si_lavora():
    assert not manifest.already_ingested(None, "abc123")


def test_un_manifest_nel_vecchio_formato_non_conta_come_gia_ingerito():
    """Il formato del manifest e' cambiato, e schema_version deve dirlo.

    Uno scritto prima della revisione finale non ha `columns` ne'
    `source_units`: leggerlo con `from_dict` solleverebbe KeyError, contato
    come errore e ritentato a ogni run per sempre. Con la versione alzata quel
    file viene invece rilavorato, che e' esattamente il meccanismo per cui
    schema_version esiste.
    """
    vecchio = _manifest_di_prova().to_dict()
    vecchio["schema_version"] = 1
    vecchio.pop("columns")
    for frame in vecchio["frames"]:
        frame.pop("source_units")

    assert not manifest.already_ingested(vecchio, "abc123")


def test_un_manifest_di_schema_futuro_non_conta_come_gia_ingerito():
    """Se lo schema e' cambiato il file va rilavorato, non saltato."""
    esistente = _manifest_di_prova().to_dict()
    esistente["schema_version"] = SCHEMA_VERSION + 1
    assert not manifest.already_ingested(esistente, "abc123")
