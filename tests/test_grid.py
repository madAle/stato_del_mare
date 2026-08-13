"""La griglia di destinazione e l'impronta delle coordinate sorgente."""
import numpy as np
import pytest

from ingest import grid


def test_giro_completo_mercator():
    lon = np.array([12.0, 20.0, -5.0])
    lat = np.array([44.0, 39.5, 60.0])
    x, y = grid.lonlat_to_mercator(lon, lat)
    lon2, lat2 = grid.mercator_to_lonlat(x, y)
    assert np.allclose(lon, lon2)
    assert np.allclose(lat, lat2)


def test_l_equatore_ha_ordinata_zero():
    _, y = grid.lonlat_to_mercator(np.array([0.0]), np.array([0.0]))
    assert y[0] == pytest.approx(0.0, abs=1e-9)


def test_la_griglia_copre_i_dati_e_ha_dimensioni_intere():
    lon = np.array([[12.0, 12.5], [12.2, 12.7]])
    lat = np.array([[44.0, 44.2], [44.5, 44.7]])
    g = grid.build_grid(lon, lat, resolution=1000.0)
    assert g.width > 0 and g.height > 0
    x, y = grid.lonlat_to_mercator(lon, lat)
    assert g.x_min <= x.min() and g.x_max >= x.max()
    assert g.y_min <= y.min() and g.y_max >= y.max()


def test_i_centri_sono_uno_per_pixel_in_ordine_c():
    lon = np.array([[12.0, 12.5], [12.2, 12.7]])
    lat = np.array([[44.0, 44.2], [44.5, 44.7]])
    g = grid.build_grid(lon, lat, resolution=5000.0)
    cx, cy = grid.grid_centres(g)
    assert cx.shape == (g.height * g.width,)
    # La prima riga e' quella piu' a nord: y decresce scorrendo l'array.
    assert cy[0] > cy[-1]
    # Dentro una riga x cresce.
    assert cx[1] > cx[0]


def test_l_impronta_cambia_se_cambiano_le_coordinate():
    lon = np.array([[12.0, 12.5]])
    lat = np.array([[44.0, 44.2]])
    prima = grid.coordinate_fingerprint(lon, lat)
    assert prima == grid.coordinate_fingerprint(lon.copy(), lat.copy())
    lon2 = lon.copy()
    lon2[0, 0] += 0.0001
    assert grid.coordinate_fingerprint(lon2, lat) != prima


def test_il_dizionario_della_griglia_e_serializzabile():
    import json

    lon = np.array([[12.0, 12.5]])
    lat = np.array([[44.0, 44.2]])
    g = grid.build_grid(lon, lat, resolution=1000.0)
    d = grid.grid_to_dict(g)
    json.dumps(d)  # non deve sollevare
    assert d["crs"] == "EPSG:3857"
    assert d["width"] == g.width
