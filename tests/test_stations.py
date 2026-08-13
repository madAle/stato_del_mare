"""Anagrafica delle stazioni marine dal flusso BUFR in tempo reale."""
import json

from ingest import stations

RIGA_BOA = json.dumps(
    {
        "version": "0.1",
        "network": "boa",
        "ident": None,
        "lon": 1247590,
        "lat": 4421460,
        "date": "2026-08-13T04:00:00Z",
        "data": [
            {"vars": {"B01019": {"v": "Nausicaa 2"}, "B01194": {"v": "boa"}}},
            {"timerange": [0, 0, 900], "level": [1, None, None, None],
             "vars": {"B22070": {"v": 0.34}, "B22001": {"v": 90.0}}},
        ],
    }
)

RIGA_TERRA = json.dumps(
    {
        "version": "0.1",
        "network": "agrmet",
        "ident": None,
        "lon": 1090937,
        "lat": 4455123,
        "date": "2026-08-13T04:00:00Z",
        "data": [{"vars": {"B01019": {"v": "Formigine"}, "B12101": {"v": 294.9}}}],
    }
)


def test_tiene_solo_le_reti_marine():
    trovate = stations.parse_realtime([RIGA_BOA, RIGA_TERRA])
    assert [s.name for s in trovate] == ["Nausicaa 2"]


def test_le_coordinate_sono_in_gradi():
    s = stations.parse_realtime([RIGA_BOA])[0]
    assert s.lon == 12.47590
    assert s.lat == 44.21460


def test_l_identificativo_e_stabile_e_senza_spazi():
    s = stations.parse_realtime([RIGA_BOA])[0]
    assert s.id == "boa-nausicaa-2"
    assert stations.slugify("boa", "Nausicaa 2") == "boa-nausicaa-2"
    assert stations.slugify("marefe", "Po di Goro") == "marefe-po-di-goro"


def test_raccoglie_le_variabili_osservate():
    s = stations.parse_realtime([RIGA_BOA])[0]
    assert "B22070" in s.variables
    assert "B22001" in s.variables
    # I codici anagrafici non sono variabili osservate.
    assert "B01019" not in s.variables


def test_una_stazione_ripetuta_compare_una_volta_sola():
    trovate = stations.parse_realtime([RIGA_BOA, RIGA_BOA, RIGA_BOA])
    assert len(trovate) == 1


def test_una_riga_malformata_non_ferma_il_parsing():
    trovate = stations.parse_realtime(["non e' json", RIGA_BOA, ""])
    assert len(trovate) == 1


def test_il_dizionario_e_serializzabile():
    d = stations.stations_to_dict(stations.parse_realtime([RIGA_BOA]))
    json.dumps(d)
    assert d["stations"][0]["id"] == "boa-nausicaa-2"
