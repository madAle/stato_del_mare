"""Client dell'object storage.

Uno dei due soli moduli che parlano col mondo esterno, e uno dei due che
i test stubbano.
"""

import json
import logging
import os
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# I frame non cambiano mai: una volta scritta, l'analisi delle 14:00 del
# 12 agosto restera' quella per sempre.
CACHE_IMMUTABILE = "public, max-age=31536000, immutable"
# Catalogo e indici cambiano a ogni run.
CACHE_BREVE = "public, max-age=300"

# Il predefinito di botocore e' la modalita' legacy: cinque tentativi con
# attese di pochi secondi in tutto. Il 2 e il 3 settembre 2026 R2 ha risposto
# InternalError a una PUT finche' non si sono esauriti, e il run e' finito
# rosso. La modalita' standard attende con jitter fino a 20 s per volta, e
# dieci tentativi coprono in media circa un minuto.
#
# Cosa costa se e' sbagliata: una scrittura che fallisce davvero ci mette un
# minuto o due in piu' ad arrendersi. Se il guasto di R2 dura di piu', il run
# resta rosso e gli indici si rifanno al run dopo, come gia' succedeva.
_TENTATIVI = Config(retries={"mode": "standard", "max_attempts": 10})

# Quei tentativi non coprono il 429: la modalita' standard ritenta 500, 502,
# 503 e 504, e R2 applica con un 429 il limite di una scrittura al secondo
# sulla stessa chiave ("Reduce your concurrent request rate for the same
# object", codice ServiceUnavailable). Il 12 novembre 2026 una PUT degli indici
# e' stata respinta cosi' e non e' stata ritentata nemmeno una volta: run
# rosso, e sei ore di indici aggiornati a meta'. Misurato contro un R2 finto:
# con un 503 partono tutti i tentativi, con un 429 una richiesta sola.
#
# Le attese partono sopra il secondo perche' il limite e' al secondo: un
# ritento piu' rapido ricadrebbe nella finestra che lo ha fatto scattare.
#
# Cosa costa se e' sbagliata: che fosse un 429 e' dedotto dalla forma del
# messaggio, non letto. Se non lo era, questo ritento non scatta mai e il
# guasto torna identico: per questo ogni scrittura respinta mette a verbale lo
# stato HTTP. Se lo era ma R2 insiste, ci si arrende 17 secondi piu' tardi.
_ATTESE_SUL_LIMITE = (2, 5, 10)
_LIMITE_SUPERATO = 429

log = logging.getLogger(__name__)


class ObjectStore:
    def __init__(
        self,
        bucket: str,
        endpoint_url: str | None,
        access_key: str,
        secret_key: str,
        region: str = "auto",
    ):
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=_TENTATIVI,
        )

    @classmethod
    def from_env(cls) -> "ObjectStore":
        mancanti = [
            n
            for n in ("R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
            if not os.environ.get(n)
        ]
        if mancanti:
            raise RuntimeError(
                "variabili d'ambiente mancanti: " + ", ".join(mancanti)
            )
        return cls(
            bucket=os.environ["R2_BUCKET"],
            endpoint_url=os.environ["R2_ENDPOINT"],
            access_key=os.environ["R2_ACCESS_KEY_ID"],
            secret_key=os.environ["R2_SECRET_ACCESS_KEY"],
        )

    def _put(self, key: str, **argomenti) -> None:
        """Una PUT che ritenta il limite di R2 sulla stessa chiave."""
        for attesa in (*_ATTESE_SUL_LIMITE, None):
            try:
                self.client.put_object(Bucket=self.bucket, Key=key, **argomenti)
                return
            except ClientError as errore:
                metadati = errore.response.get("ResponseMetadata", {})
                stato = metadati.get("HTTPStatusCode")
                si_ritenta = stato == _LIMITE_SUPERATO and attesa is not None
                # RetryAttempts dice se botocore aveva gia' ritrasmesso: se un
                # giorno il limite scatta dopo una sua ritrasmissione, la
                # seconda scrittura sulla stessa chiave l'abbiamo fatta noi.
                log.warning(
                    "scrittura respinta: %s, HTTP %s, codice %s, "
                    "ritrasmissioni di botocore %s, %s",
                    key,
                    stato,
                    errore.response.get("Error", {}).get("Code"),
                    metadati.get("RetryAttempts"),
                    f"riprovo fra {attesa} s" if si_ritenta else "non si ritenta",
                )
                if not si_ritenta:
                    raise
                time.sleep(attesa)

    def put_frame(self, key: str, blob: bytes) -> None:
        """Carica un frame gia' compresso.

        Content-Encoding: gzip fa decomprimere il browser in modo
        trasparente, cosi' il client non ha bisogno di alcuna libreria di
        decompressione: fetch().arrayBuffer() restituisce gia' i byte in
        chiaro.
        """
        self._put(
            key,
            Body=blob,
            ContentType="application/octet-stream",
            ContentEncoding="gzip",
            CacheControl=CACHE_IMMUTABILE,
        )

    def put_json(self, key: str, obj: dict) -> None:
        self._put(
            key,
            Body=json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
            CacheControl=CACHE_BREVE,
        )

    def put_binary(self, key: str, data: bytes) -> None:
        """Oggetto binario mutabile, cioe' l'indice di ricampionamento.

        Niente Content-Encoding e niente cache immutabile: questo file cambia
        quando cambia la griglia sorgente, e congelarlo nella CDN vanificherebbe
        proprio la guardia che deve alimentare.
        """
        self._put(
            key,
            Body=data,
            ContentType="application/octet-stream",
            CacheControl=CACHE_BREVE,
        )

    def get_binary(self, key: str) -> bytes | None:
        try:
            risposta = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as errore:
            if errore.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise
        return risposta["Body"].read()

    def get_json(self, key: str) -> dict | None:
        try:
            risposta = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as errore:
            if errore.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise
        return json.loads(risposta["Body"].read().decode("utf-8"))

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as errore:
            if errore.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return False
            raise
        return True

    def list_keys(self, prefix: str) -> list[str]:
        chiavi: list[str] = []
        paginatore = self.client.get_paginator("list_objects_v2")
        for pagina in paginatore.paginate(Bucket=self.bucket, Prefix=prefix):
            chiavi.extend(o["Key"] for o in pagina.get("Contents", []))
        return chiavi
