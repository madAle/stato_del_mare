"""Client dell'object storage.

Uno dei due soli moduli che parlano col mondo esterno, e uno dei due che
i test stubbano.
"""

import json
import os

import boto3
from botocore.exceptions import ClientError

# I frame non cambiano mai: una volta scritta, l'analisi delle 14:00 del
# 12 agosto restera' quella per sempre.
CACHE_IMMUTABILE = "public, max-age=31536000, immutable"
# Catalogo e indici cambiano a ogni run.
CACHE_BREVE = "public, max-age=300"


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

    def put_frame(self, key: str, blob: bytes) -> None:
        """Carica un frame gia' compresso.

        Content-Encoding: gzip fa decomprimere il browser in modo
        trasparente, cosi' il client non ha bisogno di alcuna libreria di
        decompressione: fetch().arrayBuffer() restituisce gia' i byte in
        chiaro.
        """
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=blob,
            ContentType="application/octet-stream",
            ContentEncoding="gzip",
            CacheControl=CACHE_IMMUTABILE,
        )

    def put_json(self, key: str, obj: dict) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
            CacheControl=CACHE_BREVE,
        )

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
