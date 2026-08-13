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


def test_la_chiave_della_colonna_e_giornaliera_e_per_gruppo():
    """L'object storage non supporta l'append: un file mensile andrebbe
    riscritto ogni giorno, perdendo l'immutabilita'.

    Il segmento di gruppo non e' decorativo: i tre gruppi di profilo si
    lavorano in tre passaggi distinti, e senza quel segmento si
    sovrascriverebbero a vicenda sulla stessa chiave.
    """
    assert (
        profiles.column_key("boa-nausicaa-2", "his_temp", "20260813")
        == "stations/boa-nausicaa-2/columns/his_temp/2026-08-13.bin"
    )
    assert profiles.column_key(
        "boa-nausicaa-2", "his_salt", "20260813"
    ) != profiles.column_key("boa-nausicaa-2", "his_temp", "20260813")


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
    """Nel file sintetico temp vale livello + ora*10 + indice_piatto/100.

    La cella (1,1) ha indice piatto 5, quindi il suo contributo e' 0,05.
    """
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    with Dataset(str(profile_file)) as ds:
        colonne = profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)
    valori = encode.dequantize(colonne["boa-prova"], profiles.PROFILE_SCALE)
    assert np.allclose(valori[0, 0], [0.05, 1.05, 2.05], atol=0.01)
    assert np.allclose(valori[1, 0], [10.05, 11.05, 12.05], atol=0.01)


def test_la_colonna_viene_presa_dalla_cella_giusta(profile_file):
    """Due stazioni su celle diverse devono dare valori diversi.

    La seconda cella sta fuori dalla diagonale apposta. Su una diagonale
    il contributo per cella e' invariante allo scambio di riga e colonna,
    quindi una trasposizione dentro extract_columns passerebbe inosservata:
    con (2,1) invece la trasposizione leggerebbe (1,2), che ha un valore
    diverso, e il test fallisce.
    """
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    a = _stazione(float(lon[1, 1]), float(lat[1, 1]), "boa-a")
    b = _stazione(float(lon[2, 1]), float(lat[2, 1]), "boa-b")
    celle = profiles.nearest_sea_cells([a, b], lon, lat, mare, max_distance_m=2000.0)
    assert celle["boa-a"] == (1, 1)
    assert celle["boa-b"] == (2, 1)

    with Dataset(str(profile_file)) as ds:
        colonne = profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)

    valori_a = encode.dequantize(colonne["boa-a"], profiles.PROFILE_SCALE)
    valori_b = encode.dequantize(colonne["boa-b"], profiles.PROFILE_SCALE)
    # Indici piatti 5 e 9, quindi i contributi sono 0,05 e 0,09.
    # Con righe e colonne scambiate la seconda leggerebbe (1,2), indice 6,
    # cioe' 0,06: la differenza attesa cambierebbe da -0,04 a -0,01.
    assert np.allclose(valori_a[0, 0] - valori_b[0, 0], -0.04, atol=0.005)
