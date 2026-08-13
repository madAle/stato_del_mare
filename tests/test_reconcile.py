"""L'orchestratore: diff, guardia sulla griglia, idempotenza."""
from datetime import datetime, timezone

import boto3
import numpy as np
import pytest
from moto import mock_aws
from netCDF4 import Dataset

from ingest import grid, manifest, reconcile
from ingest.source import parse_filename
from ingest.storage import ObjectStore
from tests.conftest import synthetic_coords, synthetic_sea_mask, write_wave_file

BUCKET = "prova"


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(BUCKET, None, "chiave", "segreto", region="us-east-1")


def _file_sorgente(nome="20260813_adriac_1km_his_HPDwave_an.nc.gz"):
    return parse_filename(nome)


def test_il_piano_ignora_i_gruppi_non_configurati(store):
    file = [
        _file_sorgente(),
        _file_sorgente("20260813_adriac_1km_avg_2dcur_an.nc.gz"),
    ]
    pianificato = reconcile.plan(store, file, window_days=8)
    gruppi = {p.source.group for p in pianificato}
    assert "his_HPDwave" in gruppi
    assert "avg_2dcur" not in gruppi


def test_il_piano_include_i_file_gia_ingeriti(store, monkeypatch):
    """L'impronta si verifica dopo lo scaricamento, non in pianificazione.

    `plan()` non conosce lo sha256 del sorgente senza scaricarlo, quindi
    pianifica comunque e la deduplica avviene in `process_file`. Il nome di
    questo test diceva il contrario e mentiva.
    """
    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    istante = datetime(2026, 8, 13, tzinfo=timezone.utc)
    esistente = manifest.RunManifest(
        source_url=f.url,
        source_sha256="impronta",
        source_bytes=1,
        source_last_modified="x",
        reference_time=istante,
        kind="an",
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=istante,
        frames=[],
    )
    store.put_json(manifest.manifest_key("20260813", "an", "his_HPDwave"), esistente.to_dict())
    # Il piano si basa sul manifest: senza scaricare non conosce l'impronta,
    # quindi pianifica comunque e la deduplica avviene in process_file.
    pianificato = reconcile.plan(store, [f], window_days=8)
    assert len(pianificato) == 1
    assert pianificato[0].reason == "manifest presente, impronta da verificare"


def test_la_guardia_sulla_griglia_ferma_il_job(store, tmp_path, wave_file):
    """Se le coordinate sorgente cambiano, l'indice in cache produrrebbe
    frame plausibili con i valori nel posto sbagliato."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    indice = grid.build_regrid_index(lon, lat, mare, g)
    percorso = tmp_path / "regrid_index.npz"
    # Impronta falsificata: simula un cambio di griglia a monte.
    grid.save_index(
        grid.RegridIndex(indice.indices, indice.sea_mask, "impronta-vecchia", g), percorso
    )
    with Dataset(str(wave_file)) as ds:
        with pytest.raises(reconcile.GridMismatch):
            reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)


def test_la_guardia_sulla_griglia_ferma_reconcile(store, tmp_path, monkeypatch, wave_file):
    """GridMismatch deve uscire da reconcile(), non essere contata come errore.

    reconcile() cattura Exception per non far cadere l'intero run su un file
    storto. Se quella clausola inghiottisse anche GridMismatch, il run
    proseguirebbe scrivendo frame con i valori nel posto sbagliato, che e'
    esattamente il danno che la guardia esiste per impedire. Verificare
    ensure_index in isolamento non basta: la clausola larga sta qui.
    """
    f = _file_sorgente()
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    def esplode(*args, **kwargs):
        raise reconcile.GridMismatch("le coordinate sorgente sono cambiate")

    monkeypatch.setattr(reconcile, "ensure_index", esplode)

    with pytest.raises(reconcile.GridMismatch):
        reconcile.reconcile(store, tmp_path, window_days=8)

    # Il punto della guardia: non deve essere stato scritto niente.
    assert store.get_json("catalog.json") is None


def test_l_indice_si_costruisce_al_primo_giro_e_si_riusa(store, tmp_path, wave_file):
    percorso = tmp_path / "regrid_index.npz"
    with Dataset(str(wave_file)) as ds:
        primo = reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)
        assert percorso.exists()
        secondo = reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)
    assert np.array_equal(primo.indices, secondo.indices)


def test_il_catalogo_si_scrive_dopo_i_frame(store, tmp_path, monkeypatch, wave_file):
    """Ordine di scrittura: frame, manifest, indici, catalogo."""
    ordine = []
    put_frame_originale = store.put_frame
    put_json_originale = store.put_json

    def traccia_frame(key, blob):
        ordine.append(("frame", key))
        return put_frame_originale(key, blob)

    def traccia_json(key, obj):
        ordine.append(("json", key))
        return put_json_originale(key, obj)

    monkeypatch.setattr(store, "put_frame", traccia_frame)
    monkeypatch.setattr(store, "put_json", traccia_json)

    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))
    monkeypatch.setattr(
        reconcile.stations, "fetch_stations", lambda session=None: []
    )
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [f]
    )

    reconcile.reconcile(store, tmp_path, window_days=8, only="hwave")

    chiavi = [k for _, k in ordine]
    assert "catalog.json" in chiavi
    assert chiavi.index("catalog.json") == len(chiavi) - 1
    assert any(k.startswith("frames/") for k in chiavi)


def test_il_secondo_giro_non_scrive_nulla(store, tmp_path, monkeypatch, wave_file):
    """Idempotenza: rilanciare non deve produrre scritture."""
    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))
    monkeypatch.setattr(
        reconcile.stations, "fetch_stations", lambda session=None: []
    )
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [f]
    )

    primo = reconcile.reconcile(store, tmp_path, window_days=8)
    assert primo["processed"] >= 1

    secondo = reconcile.reconcile(store, tmp_path, window_days=8)
    assert secondo["processed"] == 0
    assert secondo["skipped"] >= 1
