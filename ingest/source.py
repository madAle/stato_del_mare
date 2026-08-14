"""Accesso alla sorgente ARPAE.

E' un indice Apache senza API: si legge la pagina, si estraggono i nomi che
corrispondono al formato noto, e si interroga ciascuno con HEAD. I file sono
poche decine, quindi una HEAD ciascuno costa meno che interpretare le colonne
formattate dell'indice, che cambiano formato senza preavviso.
"""

import hashlib
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import requests

from .config import ADRIAC_BASE

log = logging.getLogger(__name__)

# Tre tentativi con attesa crescente. Un errore passeggero a meta' di un
# download da 2 GB non deve costare l'intero run: la riconciliazione lo
# recupererebbe comunque il giorno dopo, ma senza motivo.
TENTATIVI = 3
ATTESA_BASE_S = 5.0

_NOME = re.compile(
    r"^(?P<date>\d{8})_adriac_1km_(?P<output>avg|his|qck)_(?P<group>[A-Za-z0-9]+)_(?P<kind>an|fc)\.nc\.gz$"
)
_HREF = re.compile(r'href="([^"]+\.nc\.gz)"')

_CHUNK = 1 << 20


@dataclass(frozen=True)
class SourceFile:
    name: str
    url: str
    date: str
    output: str
    group_short: str
    kind: str

    @property
    def group(self) -> str:
        return f"{self.output}_{self.group_short}"


def parse_filename(name: str, base_url: str = ADRIAC_BASE) -> SourceFile | None:
    trovato = _NOME.match(name)
    if trovato is None:
        return None
    return SourceFile(
        name=name,
        url=urljoin(base_url, name),
        date=trovato["date"],
        output=trovato["output"],
        group_short=trovato["group"],
        kind=trovato["kind"],
    )


def list_source_files(base_url: str = ADRIAC_BASE, session=None) -> list[SourceFile]:
    ses = session or requests
    risposta = ses.get(base_url, timeout=60)
    risposta.raise_for_status()
    file: list[SourceFile] = []
    for href in _HREF.findall(risposta.text):
        nome = href.rsplit("/", 1)[-1]
        analizzato = parse_filename(nome, base_url)
        if analizzato is not None:
            file.append(analizzato)
    return file


def _con_tentativi(operazione, descrizione: str):
    """Riprova con attesa crescente, poi rilancia l'ultima eccezione."""
    ultimo: Exception | None = None
    for tentativo in range(TENTATIVI):
        try:
            return operazione()
        except Exception as errore:
            ultimo = errore
            if tentativo < TENTATIVI - 1:
                attesa = ATTESA_BASE_S * (2**tentativo)
                log.warning(
                    "%s fallito (%s), riprovo fra %.0f s", descrizione, errore, attesa
                )
                time.sleep(attesa)
    raise ultimo


def head(url: str, session=None) -> dict:
    ses = session or requests

    def _leggi():
        risposta = ses.head(url, timeout=60, allow_redirects=True)
        risposta.raise_for_status()
        return {
            "bytes": int(risposta.headers.get("Content-Length", 0)),
            "last_modified": risposta.headers.get("Last-Modified", ""),
        }

    return _con_tentativi(_leggi, f"HEAD {url}")


def download(url: str, dest: Path, session=None) -> str:
    """Scarica in streaming e restituisce lo sha256.

    I file arrivano a quasi 2 GB: non si tengono in memoria. Il file
    parziale viene rimosso prima di ogni nuovo tentativo, altrimenti
    l'impronta risulterebbe calcolata su byte incompleti.
    """
    ses = session or requests
    dest.parent.mkdir(parents=True, exist_ok=True)

    def _scarica():
        dest.unlink(missing_ok=True)
        impronta = hashlib.sha256()
        with ses.get(url, stream=True, timeout=300) as risposta:
            risposta.raise_for_status()
            with open(dest, "wb") as uscita:
                for pezzo in risposta.iter_content(chunk_size=_CHUNK):
                    if pezzo:
                        impronta.update(pezzo)
                        uscita.write(pezzo)
        return impronta.hexdigest()

    return _con_tentativi(_scarica, f"GET {url}")
