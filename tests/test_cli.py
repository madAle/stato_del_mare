"""I codici di uscita della CLI: e' il contratto su cui un cron decide."""
import boto3
import pytest
from moto import mock_aws
from netCDF4 import Dataset

from ingest import __main__ as cli
from ingest import reconcile
from ingest.frames import UnitMismatch
from ingest.reconcile import GridMismatch
from ingest.source import parse_filename
from ingest.stations import StationCollision
from ingest.storage import ObjectStore
from tests.conftest import synthetic_coords, write_profile_file, write_wave_file

BUCKET = "prova"


def _store_finto(monkeypatch):
    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(lambda cls: object()))


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(BUCKET, None, "chiave", "segreto", region="us-east-1")


def _esito(errors=0, deferred=0):
    return {
        "planned": 1,
        "processed": 1,
        "skipped": 0,
        "deferred": deferred,
        "errors": errors,
    }


def test_un_run_pulito_esce_con_zero(monkeypatch):
    _store_finto(monkeypatch)
    monkeypatch.setattr(cli, "reconcile", lambda *a, **k: _esito())
    assert cli.main(["reconcile"]) == 0


def test_errori_sui_singoli_file_escono_con_uno(monkeypatch):
    """Ritentabile: il run successivo recupera dalla finestra di 8 giorni."""
    _store_finto(monkeypatch)
    monkeypatch.setattr(cli, "reconcile", lambda *a, **k: _esito(errors=1))
    assert cli.main(["reconcile"]) == 1


def test_i_file_rimandati_escono_con_uno(monkeypatch):
    """Un file rimandato e' lavoro non fatto: non deve poter uscire 0.

    Senza questo, un run che non riesce a costruire l'indice rimanda tutto,
    non conta nulla come errore e riporta successo.
    """
    _store_finto(monkeypatch)
    monkeypatch.setattr(cli, "reconcile", lambda *a, **k: _esito(deferred=2))
    assert cli.main(["reconcile"]) == 1


def test_la_griglia_cambiata_esce_con_due(monkeypatch):
    """Non ritentabile: niente e' stato scritto e serve un umano."""
    _store_finto(monkeypatch)

    def esplode(*a, **k):
        raise GridMismatch("le coordinate sorgente sono cambiate")

    monkeypatch.setattr(cli, "reconcile", esplode)
    assert cli.main(["reconcile"]) == 2


def test_il_cambio_di_unita_esce_con_due(monkeypatch):
    """Non ritentabile: la sorgente ha cambiato unita' di misura."""
    _store_finto(monkeypatch)

    def esplode(*a, **k):
        raise UnitMismatch("Hwave: unita' attesa 'meter', trovata 'centimeter'")

    monkeypatch.setattr(cli, "reconcile", esplode)
    assert cli.main(["reconcile"]) == 2


def test_la_collisione_fra_stazioni_esce_con_due(monkeypatch):
    """Non ritentabile: due nomi diversi sullo stesso identificativo.

    Senza una clausola dedicata, Python stampava un traceback e usciva 1, che
    il workflow rende come "ritentabile, il run successivo recupera": il cron
    avrebbe ritentato per sempre un guasto che non si risolve da solo.
    """
    _store_finto(monkeypatch)

    def esplode(*a, **k):
        raise StationCollision("boa-prova generato sia da 'Prova' sia da 'Prova!'")

    monkeypatch.setattr(cli, "reconcile", esplode)
    assert cli.main(["reconcile"]) == 2


def test_una_variabile_rinominata_esce_con_due(store, tmp_path, monkeypatch):
    """Non ritentabile: la sorgente ha rinominato una variabile.

    La spec 6.1 promette a un cambio di nome variabile lo stesso trattamento
    di un cambio di unita', cioe' run fermo e uscita 2. Senza guardia il nome
    assente emergeva come `KeyError`, la clausola larga di `reconcile` lo
    contava come fallimento passeggero e la CLI usciva 1, che il workflow rende
    come "ritentabile, il run successivo recupera": il cron avrebbe ritentato
    due volte al giorno per sempre mentre la finestra di 8 giorni scorreva via.
    E' lo stesso guasto della collisione fra stazioni su un'altra causa.

    Il giro qui e' completo, dalla sorgente al codice di uscita: il difetto non
    stava nel sollevare l'eccezione ma nel tradurla in un codice, quindi un
    test che si fermasse all'eccezione non lo vedrebbe.
    """
    f = parse_filename("20260813_adriac_1km_his_HPDwave_an.nc.gz")

    def scarica_rinominato(url, dest, session=None):
        percorso = write_wave_file(dest.with_suffix(".nc"))
        with Dataset(str(percorso), "a") as ds:
            ds.renameVariable("Hwave", "Hwave_v2")
        return "impronta"

    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(lambda cls: store))
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(reconcile.source, "download", scarica_rinominato)
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    assert cli.main(["reconcile", "--workdir", str(tmp_path)]) == 2
    # E come per la griglia: fermarsi vuol dire non lasciare niente dietro.
    assert store.get_json("catalog.json") is None


def test_una_variabile_di_profilo_rinominata_esce_con_due(store, tmp_path, monkeypatch):
    """La stessa promessa vale per le colonne, non solo per i campi 2D.

    `extract_columns` leggeva `ds.variables[nome]` per conto suo, senza passare
    dalla guardia: un rename di `temp`, `salt`, `u_eastward` o `v_northward`
    usciva ancora come `KeyError`, la clausola larga di `reconcile` lo contava
    come fallimento passeggero e la CLI usciva 1. Il cron avrebbe ritentato due
    volte al giorno per sempre mentre la finestra ARPAE di 8 giorni scorreva
    via, e le colonne di quei giorni sono perse in modo definitivo.

    Il giro e' completo apposta: il difetto non sta nel sollevare l'eccezione
    ma nel tradurla in un codice di uscita, e ci vogliono due file perche' le
    colonne si estraggono solo dopo che l'indice e' stato costruito dal gruppo
    di riferimento.
    """
    lon, lat = synthetic_coords()
    store.put_json(
        "stations/stations.json",
        {
            "stations": [
                {
                    "id": "boa-prova",
                    "name": "Prova",
                    "network": "boa",
                    "lon": float(lon[1, 1]),
                    "lat": float(lat[1, 1]),
                    "variables": [],
                }
            ]
        },
    )

    onda = parse_filename("20260813_adriac_1km_his_HPDwave_an.nc.gz")
    profilo = parse_filename("20260813_adriac_1km_his_temp_an.nc.gz")

    def scarica(url, dest, session=None):
        percorso = dest.with_suffix(".nc")
        if "HPDwave" in url:
            write_wave_file(percorso)
        else:
            write_profile_file(percorso, var_names=("temp",))
            with Dataset(str(percorso), "a") as ds:
                ds.renameVariable("temp", "temp_v2")
        return "impronta-" + url.rsplit("/", 1)[-1]

    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(lambda cls: store))
    monkeypatch.setattr(
        reconcile.source, "list_source_files", lambda session=None: [onda, profilo]
    )
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(reconcile.source, "download", scarica)
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    assert cli.main(["reconcile", "--workdir", str(tmp_path)]) == 2
    # Fermarsi vuol dire fermarsi: il catalogo non deve annunciare un giorno
    # che in archivio e' incompleto.
    assert store.get_json("catalog.json") is None


def test_le_credenziali_mancanti_escono_con_tre(monkeypatch):
    """Fallirebbe identico a ogni tentativo: il cron non deve ritentare."""

    def manca(cls):
        raise RuntimeError("variabili d'ambiente mancanti: R2_BUCKET")

    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(manca))
    assert cli.main(["reconcile"]) == 3
