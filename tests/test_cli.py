"""I codici di uscita della CLI: e' il contratto su cui un cron decide."""
from ingest import __main__ as cli
from ingest.reconcile import GridMismatch
from ingest.stations import StationCollision


def _store_finto(monkeypatch):
    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(lambda cls: object()))


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


def test_le_credenziali_mancanti_escono_con_tre(monkeypatch):
    """Fallirebbe identico a ogni tentativo: il cron non deve ritentare."""

    def manca(cls):
        raise RuntimeError("variabili d'ambiente mancanti: R2_BUCKET")

    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(manca))
    assert cli.main(["reconcile"]) == 3
