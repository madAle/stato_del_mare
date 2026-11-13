"""Il client dell'object storage, contro un S3 finto in memoria."""
import boto3
import pytest
from botocore.awsrequest import AWSResponse
from botocore.exceptions import ClientError
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


class _CorpoFinto:
    def __init__(self, dati: bytes):
        self._dati = dati

    def stream(self, **_):
        yield self._dati


def test_una_scrittura_sopravvive_a_un_guasto_interno_di_r2(store, monkeypatch):
    """Il 2 e il 3 settembre 2026, verso le 00:20 UTC, R2 ha risposto
    InternalError a una PUT degli indici finche' botocore non si e' arreso:
    "reached max retries: 4", cioe' la modalita' legacy e i suoi cinque
    tentativi. Due run rossi, nessun dato perso (gli indici si rifanno al run
    dopo), ma una mail che chiedeva un intervento per una cosa che R2 dice da
    se' di riprovare.
    """
    monkeypatch.setattr("time.sleep", lambda _: None)
    guasti = {"restanti": 5}

    def guasto_interno(request, **_):
        if guasti["restanti"] == 0:
            return None  # la richiesta prosegue verso l'S3 finto
        guasti["restanti"] -= 1
        corpo = (
            b"<Error><Code>InternalError</Code>"
            b"<Message>We encountered an internal error. Please try again.</Message>"
            b"</Error>"
        )
        return AWSResponse(request.url, 500, {}, _CorpoFinto(corpo))

    store.client.meta.events.register_first("before-send.s3.PutObject", guasto_interno)
    store.put_json("index/hwave/an/2026-09.json", {"hours": {}})
    assert guasti["restanti"] == 0
    assert store.get_json("index/hwave/an/2026-09.json") == {"hours": {}}


_LIMITE_SULLA_CHIAVE = (
    b'<?xml version="1.0" encoding="UTF-8"?><Error><Code>ServiceUnavailable</Code>'
    b"<Message>Reduce your concurrent request rate for the same object.</Message>"
    b"</Error>"
)


def _respingi(store, stato: int, corpo: bytes, volte: int | None) -> list[str]:
    """Fa rispondere `stato` alle prime `volte` PUT (a tutte, se None).

    Restituisce l'elenco, che si allunga a ogni richiesta che parte.
    """
    richieste: list[str] = []

    def risposta(request, **_):
        richieste.append(request.url)
        if volte is not None and len(richieste) > volte:
            return None  # la richiesta prosegue verso l'S3 finto
        return AWSResponse(request.url, stato, {}, _CorpoFinto(corpo))

    store.client.meta.events.register_first("before-send.s3.PutObject", risposta)
    return richieste


def test_una_scrittura_sopravvive_al_limite_di_r2_sulla_stessa_chiave(
    store, monkeypatch
):
    """Il 12 novembre 2026 alle 17:48 UTC R2 ha respinto una PUT degli indici
    con "Reduce your concurrent request rate for the same object", e botocore
    non ha ritentato nemmeno una volta: la modalita' standard ritenta 500, 502,
    503 e 504, non il 429 con cui R2 applica il limite di una scrittura al
    secondo per chiave. Run rosso, e per sei ore indici aggiornati a meta'.

    Le attese devono superare il secondo, altrimenti il ritento ricade nella
    stessa finestra che ha fatto scattare il limite.
    """
    attese: list[float] = []
    monkeypatch.setattr("time.sleep", attese.append)
    richieste = _respingi(store, 429, _LIMITE_SULLA_CHIAVE, volte=2)

    store.put_json("index/hwave/fc/2026-11.json", {"hours": {}})

    assert store.get_json("index/hwave/fc/2026-11.json") == {"hours": {}}
    assert len(richieste) == 3
    assert len(attese) == 2
    assert all(attesa > 1 for attesa in attese)


def test_il_limite_sulla_chiave_che_non_passa_resta_un_errore(store, monkeypatch):
    """Se R2 insiste, ci si arrende: il run finisce rosso e gli indici si
    rifanno al run dopo, come gia' succede. Non si aspetta all'infinito."""
    monkeypatch.setattr("time.sleep", lambda _: None)
    richieste = _respingi(store, 429, _LIMITE_SULLA_CHIAVE, volte=None)

    with pytest.raises(ClientError):
        store.put_json("index/hwave/fc/2026-11.json", {"hours": {}})

    assert 1 < len(richieste) <= 10


def test_una_scrittura_respinta_mette_a_verbale_stato_e_chiave(
    store, monkeypatch, caplog
):
    """Del guasto del 12 novembre il log non diceva ne' lo stato HTTP ne' la
    chiave: il 429 si e' dovuto dedurre dalla forma del messaggio, e quali
    indici fossero rimasti indietro non si e' potuto dire. Vale per ogni
    scrittura respinta, non solo per quelle che si ritentano."""
    monkeypatch.setattr("time.sleep", lambda _: None)
    negato = b"<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>"
    richieste = _respingi(store, 403, negato, volte=None)

    with caplog.at_level("WARNING", logger="ingest.storage"):
        with pytest.raises(ClientError):
            store.put_json("index/ubar/an/2026-11.json", {"hours": {}})

    assert len(richieste) == 1  # un 403 non passa aspettando
    verbale = caplog.text
    assert "403" in verbale
    assert "AccessDenied" in verbale
    assert "index/ubar/an/2026-11.json" in verbale


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


def test_giro_completo_del_binario(store):
    store.put_binary("static/regrid_index.npz", b"\x01\x02\x03")
    assert store.get_binary("static/regrid_index.npz") == b"\x01\x02\x03"


def test_un_binario_assente_restituisce_none(store):
    assert store.get_binary("static/non_esiste.npz") is None


def test_il_binario_non_e_immutabile(store):
    """L'indice di ricampionamento cambia quando cambia la griglia sorgente:
    marcarlo immutabile congelerebbe nella CDN proprio il dato che la guardia
    deve poter aggiornare."""
    store.put_binary("static/regrid_index.npz", b"\x00")
    testa = store.client.head_object(Bucket=BUCKET, Key="static/regrid_index.npz")
    assert testa["CacheControl"] != CACHE_IMMUTABILE
    assert "ContentEncoding" not in testa
