"""Estrazione dei frame 2D da un NetCDF."""
from datetime import datetime, timezone

import numpy as np
from netCDF4 import Dataset

from ingest import encode, frames, grid
from tests.conftest import synthetic_coords, synthetic_sea_mask


def _indice():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    return grid.build_regrid_index(lon, lat, mare, g)


def test_gli_istanti_sono_utc_aware(wave_file):
    with Dataset(str(wave_file)) as ds:
        istanti = frames.read_times(ds)
    assert istanti[0] == datetime(2026, 8, 12, 1, tzinfo=timezone.utc)
    assert all(t.tzinfo is not None for t in istanti)


def test_il_campionamento_orario_tiene_solo_il_minuto_zero():
    istanti = [
        datetime(2026, 8, 12, 1, m, tzinfo=timezone.utc) for m in (0, 10, 20, 30, 40, 50)
    ] + [datetime(2026, 8, 12, 2, 0, tzinfo=timezone.utc)]
    assert frames.select_times(istanti, "hourly") == [0, 6]
    assert frames.select_times(istanti, "full") == list(range(7))


def test_la_chiave_del_frame():
    assert (
        frames.frame_key(
            "hwave", "an", "20260813", datetime(2026, 8, 12, 1, tzinfo=timezone.utc)
        )
        == "frames/hwave/an/20260813/2026-08-12T01.bin"
    )


def test_estrae_un_frame_per_campo_e_per_istante(wave_file):
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        prodotti = list(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))
    # 4 campi (hwave, pwave, dwave_sin, dwave_cos) per 2 istanti
    assert len(prodotti) == 8
    variabili = {record.var for record, _ in prodotti}
    assert variabili == {"hwave", "pwave", "dwave_sin", "dwave_cos"}


def test_il_frame_prodotto_si_rilegge_e_ha_la_forma_della_griglia(wave_file):
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        record, blob = next(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))
    valori = encode.decompress(blob)
    assert valori.size == idx.grid.height * idx.grid.width


def test_le_statistiche_finiscono_nel_record(wave_file):
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        per_variabile = {
            r.var: r for r, _ in frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx)
        }
    hwave = per_variabile["hwave"]
    assert hwave.scale == 0.001
    assert hwave.min is not None and hwave.max is not None
    assert hwave.nodata_count > 0  # la terraferma
    assert hwave.clipped_count == 0


def test_la_direzione_produce_seno_e_coseno_coerenti(wave_file):
    """Dwave vale 90 gradi ovunque nel file sintetico: seno 1, coseno 0."""
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        blob_per_variabile = {
            r.var: b for r, b in frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx)
        }
    seno = encode.dequantize(encode.decompress(blob_per_variabile["dwave_sin"]), 0.0001)
    coseno = encode.dequantize(encode.decompress(blob_per_variabile["dwave_cos"]), 0.0001)
    validi = ~np.isnan(seno)
    assert np.allclose(seno[validi], 1.0, atol=0.001)
    assert np.allclose(coseno[validi], 0.0, atol=0.001)


def test_la_maschera_di_mare_si_legge_dai_dati(wave_file):
    with Dataset(str(wave_file)) as ds:
        mare = frames.read_sea_mask(ds, "Hwave")
    assert np.array_equal(mare, synthetic_sea_mask())
