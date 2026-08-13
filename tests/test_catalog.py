"""Indici mensili e catalogo."""
from datetime import datetime, timezone

import boto3
import pytest
from moto import mock_aws

from ingest import catalog
from ingest.storage import ObjectStore

BUCKET = "prova"


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(BUCKET, None, "chiave", "segreto", region="us-east-1")


def test_la_chiave_dell_indice_e_mensile():
    assert catalog.index_key("hwave", "an", "2026-08") == "index/hwave/an/2026-08.json"


def test_l_indice_raccoglie_le_ore_disponibili():
    d = catalog.merge_index(
        None,
        [
            (datetime(2026, 8, 12, 1, tzinfo=timezone.utc), "20260813"),
            (datetime(2026, 8, 12, 2, tzinfo=timezone.utc), "20260813"),
        ],
    )
    assert d["hours"] == {
        "2026-08-12T01:00:00Z": "20260813",
        "2026-08-12T02:00:00Z": "20260813",
    }


def test_l_indice_si_fonde_senza_perdere_lo_storico():
    prima = catalog.merge_index(
        None, [(datetime(2026, 8, 12, 1, tzinfo=timezone.utc), "20260813")]
    )
    dopo = catalog.merge_index(
        prima, [(datetime(2026, 8, 12, 2, tzinfo=timezone.utc), "20260813")]
    )
    assert len(dopo["hours"]) == 2


def test_un_run_piu_recente_sovrascrive_il_riferimento_della_stessa_ora():
    """Due run di previsione coprono la stessa ora: vince il piu' recente.

    L'archivio conserva comunque entrambi i frame su percorsi diversi:
    qui si decide solo quale l'indice segnala per primo.
    """
    prima = catalog.merge_index(
        None, [(datetime(2026, 8, 14, 1, tzinfo=timezone.utc), "20260812")]
    )
    dopo = catalog.merge_index(
        prima, [(datetime(2026, 8, 14, 1, tzinfo=timezone.utc), "20260813")]
    )
    assert dopo["hours"]["2026-08-14T01:00:00Z"] == "20260813"


def test_il_catalogo_elenca_le_variabili_con_unita_e_colormap(store):
    c = catalog.build_catalog(store, {"crs": "EPSG:3857", "width": 10, "height": 10})
    per_id = {v["id"]: v for v in c["variables"]}
    assert per_id["hwave"]["units"] == "m"
    assert per_id["hwave"]["scale"] == 0.001
    assert per_id["hwave"]["colormap"] == "amp"
    assert c["schema_version"]
    assert c["grid"]["crs"] == "EPSG:3857"


def test_il_catalogo_si_scrive_ed_e_rileggibile(store):
    c = catalog.build_catalog(store, {"crs": "EPSG:3857"})
    catalog.write_catalog(store, c)
    assert store.get_json("catalog.json")["schema_version"] == c["schema_version"]
