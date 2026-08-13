"""Estrazione delle colonne verticali sulle celle delle stazioni."""
import numpy as np
from netCDF4 import Dataset

from ingest import encode, profiles
from ingest.stations import Station
from tests.conftest import NS, NT, synthetic_coords, synthetic_sea_mask


def _stazione(lon, lat, identificativo="boa-prova"):
    return Station(
        id=identificativo, name="Prova", network="boa", lon=lon, lat=lat, variables=()
    )


def test_trova_la_cella_di_mare_piu_vicina():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    assert celle["boa-prova"] == (1, 1)


def test_una_stazione_lontana_dal_mare_viene_scartata():
    """Le stazioni lagunari possono non avere una cella ADRIAC vicina."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(20.0, 40.0, "boa-lontana")
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    assert "boa-lontana" not in celle


def test_una_stazione_sopra_la_terraferma_prende_la_cella_di_mare_vicina():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    # riga 4 e' terra, riga 3 e' l'ultima di mare
    s = _stazione(float(lon[4, 2]), float(lat[4, 2]), "boa-costa")
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=5000.0)
    assert celle["boa-costa"][0] <= 3


def test_la_chiave_della_colonna_e_giornaliera():
    """L'object storage non supporta l'append: un file mensile andrebbe
    riscritto ogni giorno, perdendo l'immutabilita'."""
    assert (
        profiles.column_key("boa-nausicaa-2", "20260813")
        == "stations/boa-nausicaa-2/columns/2026-08-13.bin"
    )


def test_estrae_una_colonna_per_istante_e_per_variabile(profile_file):
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    with Dataset(str(profile_file)) as ds:
        colonne = profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)
    grezzo = colonne["boa-prova"]
    assert grezzo.shape == (NT, 1, NS)
    assert grezzo.dtype == np.int16


def test_i_valori_estratti_sono_quelli_del_file(profile_file):
    """Nel file sintetico temp vale livello + ora*10."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    with Dataset(str(profile_file)) as ds:
        colonne = profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)
    valori = encode.dequantize(colonne["boa-prova"], profiles.PROFILE_SCALE)
    assert np.allclose(valori[0, 0], [0.0, 1.0, 2.0], atol=0.01)
    assert np.allclose(valori[1, 0], [10.0, 11.0, 12.0], atol=0.01)
