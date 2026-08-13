"""Il client dell'object storage, contro un S3 finto in memoria."""
import boto3
import pytest
from moto import mock_aws

from ingest.storage import CACHE_IMMUTABILE, ObjectStore

BUCKET = "prova"


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(
            bucket=BUCKET,
            endpoint_url=None,
            access_key="chiave",
            secret_key="segreto",
            region="us-east-1",
        )


def test_un_frame_viene_marcato_gzip_e_immutabile(store):
    store.put_frame("frames/hwave/an/20260813/2026-08-12T01.bin", b"\x01\x02")
    testa = store.client.head_object(
        Bucket=BUCKET, Key="frames/hwave/an/20260813/2026-08-12T01.bin"
    )
    assert testa["ContentEncoding"] == "gzip"
    assert testa["CacheControl"] == CACHE_IMMUTABILE


def test_giro_completo_del_json(store):
    store.put_json("catalog.json", {"schema_version": 1})
    assert store.get_json("catalog.json") == {"schema_version": 1}


def test_un_json_assente_restituisce_none(store):
    assert store.get_json("non/esiste.json") is None


def test_il_json_non_e_immutabile(store):
    """Catalogo e indici cambiano a ogni run: marcarli immutabili li
    congelerebbe nella cache della CDN."""
    store.put_json("catalog.json", {})
    testa = store.client.head_object(Bucket=BUCKET, Key="catalog.json")
    assert testa["CacheControl"] != CACHE_IMMUTABILE


def test_exists(store):
    assert not store.exists("frames/x.bin")
    store.put_frame("frames/x.bin", b"\x00")
    assert store.exists("frames/x.bin")


def test_list_keys(store):
    store.put_frame("frames/a/1.bin", b"\x00")
    store.put_frame("frames/a/2.bin", b"\x00")
    store.put_frame("frames/b/1.bin", b"\x00")
    assert sorted(store.list_keys("frames/a/")) == ["frames/a/1.bin", "frames/a/2.bin"]
