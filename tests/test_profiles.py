"""Estrazione delle colonne verticali sulle celle delle stazioni."""
import numpy as np
import pytest
from netCDF4 import Dataset

from ingest import config, encode, frames, grid, profiles
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


def test_una_variabile_di_profilo_rinominata_ferma_l_estrazione(profile_file):
    """Un rename qui vale quanto un rename fra i campi 2D.

    I campi 2D passano da `check_units`, che monta la guardia prima di
    leggere. Le colonne non hanno un passo equivalente: leggevano il nome
    direttamente e un `KeyError` sarebbe finito fra i guasti passeggeri.
    """
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)

    with Dataset(str(profile_file), "a") as ds:
        ds.renameVariable("temp", "temp_v2")

    with Dataset(str(profile_file)) as ds:
        with pytest.raises(frames.VariableMissing) as errore:
            profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)
    assert "temp" in str(errore.value)


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


def _lon_a_distanza(metri: float, lon0: float = 12.0, lat0: float = 44.0) -> float:
    """Longitudine che dista `metri` al suolo da (lon0, lat0), stessa latitudine.

    Inverte esattamente il conto che fa nearest_sea_cells (distanza in metri
    Mercator riportata al suolo moltiplicando per il coseno della latitudine),
    cosi' la soglia sotto esame e' quella vera e non una stima geodetica.
    """
    x0, _ = grid.lonlat_to_mercator(np.array(lon0), np.array(lat0))
    x1 = float(x0) + metri / np.cos(np.radians(lat0))
    lon1, _ = grid.mercator_to_lonlat(np.array(x1), np.array(0.0))
    return float(lon1)


def _mare_di_una_cella():
    """Una sola cella di mare a (12,0 E, 44,0 N): la distanza e' controllata."""
    return np.array([[12.0]]), np.array([[44.0]]), np.array([[True]])


def test_una_stazione_a_novecento_metri_viene_accettata():
    """Fra 800 e 1000 m la boa e' comunque rappresentata da quella cella.

    Cervia Porto sta a 922 m ed e' una boa in mare vero: la soglia del
    ricampionamento, che serve a impedire che il colore sbordi sulla
    terraferma, la scartava per un motivo che qui non vale.
    """
    lon, lat, mare = _mare_di_una_cella()
    s = _stazione(_lon_a_distanza(900.0), 44.0, "boa-a-900")
    celle = profiles.nearest_sea_cells([s], lon, lat, mare)
    assert celle["boa-a-900"] == (0, 0)


def test_una_stazione_oltre_il_chilometro_viene_scartata(caplog):
    lon, lat, mare = _mare_di_una_cella()
    s = _stazione(_lon_a_distanza(1200.0), 44.0, "marefe-lontana")
    with caplog.at_level("WARNING"):
        celle = profiles.nearest_sea_cells([s], lon, lat, mare)
    assert "marefe-lontana" not in celle
    assert "distanza" in caplog.text


def test_una_stazione_nell_elenco_di_esclusione_viene_scartata(caplog):
    """La distanza da sola non separa Cervia (923 m) da Manufatto (977 m).

    Fra i due ci sono 55 metri: nessuna soglia numerica puo' distinguerli
    senza essere tarata sul caso che si ha davanti. L'esclusione per nome e'
    l'unica separazione onesta, e il log deve dire che e' quella.
    """
    lon, lat, mare = _mare_di_una_cella()
    s = _stazione(_lon_a_distanza(200.0), 44.0, "marefe-manufatto")
    with caplog.at_level("WARNING"):
        celle = profiles.nearest_sea_cells([s], lon, lat, mare)
    assert "marefe-manufatto" not in celle
    assert "esclusa" in caplog.text
    assert "distanza" not in caplog.text


def test_l_elenco_di_esclusione_porta_con_se_il_motivo():
    """Senza il motivo la voce verra' rimessa in discussione, o tolta."""
    assert "marefe-manufatto" in config.EXCLUDED_STATIONS
    for identificativo, motivo in config.EXCLUDED_STATIONS.items():
        assert motivo.strip(), identificativo
