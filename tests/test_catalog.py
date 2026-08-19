"""Indici mensili e catalogo."""
from datetime import datetime, timezone

import boto3
import pytest
from moto import mock_aws

from ingest import catalog, manifest
from ingest.storage import ObjectStore

BUCKET = "prova"


def _frame(var, valid_time):
    return manifest.FrameRecord(
        var=var,
        valid_time=valid_time,
        path=f"frames/{var}/an/x/{valid_time:%Y-%m-%dT%H%M}.bin",
        sha256="x",
        source_units="meter",
        scale=0.001,
        offset=0.0,
        min=0.0,
        max=1.0,
        nodata_count=0,
        clipped_count=0,
    )


def _manifest(reference_time, frames, kind="an"):
    return manifest.RunManifest(
        source_url="https://esempio/f.nc.gz",
        source_sha256="x",
        source_bytes=1,
        source_last_modified="x",
        reference_time=reference_time,
        kind=kind,
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=reference_time,
        frames=frames,
    )


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
    # deep e non amp: scelto guardando il 2026-08-19, perche' con amp il mare
    # calmo e la terraferma avevano lo stesso colore e l'Adriatico sta sotto i
    # 0,5 m gran parte dell'anno. Il valore e' scritto qui alla lettera apposta:
    # e' il contratto che la SPA legge, e cambiarlo deve costare un test rosso.
    assert per_id["hwave"]["colormap"] == "deep"
    assert c["schema_version"]
    assert c["grid"]["crs"] == "EPSG:3857"


def test_il_catalogo_si_scrive_ed_e_rileggibile(store):
    c = catalog.build_catalog(store, {"crs": "EPSG:3857"})
    catalog.write_catalog(store, c)
    assert store.get_json("catalog.json")["schema_version"] == c["schema_version"]


def test_un_run_a_cavallo_di_due_mesi_tocca_due_indici(store):
    """Il raggruppamento e' per frame, non per manifest.

    Un run che copre la mezzanotte di fine mese tocca due indici mensili.
    Raggruppando per manifest se ne perderebbe uno, e quelle ore
    sparirebbero dal catalogo pur essendo su bucket.
    """
    m = _manifest(
        reference_time=datetime(2026, 9, 1, tzinfo=timezone.utc),
        frames=[
            _frame("hwave", datetime(2026, 8, 31, 23, tzinfo=timezone.utc)),
            _frame("hwave", datetime(2026, 9, 1, 0, tzinfo=timezone.utc)),
        ],
    )
    scritte = catalog.rebuild_indices(store, [m])
    assert scritte == {
        "index/hwave/an/2026-08.json",
        "index/hwave/an/2026-09.json",
    }
    agosto = store.get_json("index/hwave/an/2026-08.json")
    assert agosto["hours"] == {"2026-08-31T23:00:00Z": "20260901"}


def test_rebuild_indices_non_cancella_quanto_gia_sul_bucket(store):
    """Il giro di leggi, modifica e scrivi deve conservare lo storico."""
    primo = _manifest(
        reference_time=datetime(2026, 8, 13, tzinfo=timezone.utc),
        frames=[_frame("hwave", datetime(2026, 8, 12, 1, tzinfo=timezone.utc))],
    )
    catalog.rebuild_indices(store, [primo])

    secondo = _manifest(
        reference_time=datetime(2026, 8, 14, tzinfo=timezone.utc),
        frames=[_frame("hwave", datetime(2026, 8, 12, 2, tzinfo=timezone.utc))],
    )
    catalog.rebuild_indices(store, [secondo])

    indice = store.get_json("index/hwave/an/2026-08.json")
    assert set(indice["hours"]) == {
        "2026-08-12T01:00:00Z",
        "2026-08-12T02:00:00Z",
    }


def test_rebuild_indices_separa_analisi_e_previsione(store):
    """Analisi e previsione della stessa ora vivono su indici distinti.

    Fonderle renderebbe impossibile il confronto fra le due, che e' meta'
    del valore scientifico dell'archivio.
    """
    istante = datetime(2026, 8, 14, 1, tzinfo=timezone.utc)
    analisi = _manifest(
        reference_time=datetime(2026, 8, 15, tzinfo=timezone.utc),
        frames=[_frame("hwave", istante)],
        kind="an",
    )
    previsione = _manifest(
        reference_time=datetime(2026, 8, 13, tzinfo=timezone.utc),
        frames=[_frame("hwave", istante)],
        kind="fc",
    )
    scritte = catalog.rebuild_indices(store, [analisi, previsione])
    assert scritte == {
        "index/hwave/an/2026-08.json",
        "index/hwave/fc/2026-08.json",
    }
