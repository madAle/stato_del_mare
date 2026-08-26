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

# Cinque tentativi con attesa crescente: 5, 10, 20 e 40 secondi, 75 in tutto.
# Erano tre, cioe' 15 secondi, e il 25 agosto 2026 un 403 sull'indice li ha
# esauriti tutti prima che il blocco finisse. Un errore passeggero a meta' di
# un download da 2 GB non deve costare l'intero run, e un rifiuto passeggero
# sull'indice non deve impedirgli di cominciare.
#
# Cosa costa se e' sbagliata: un run che fallisce davvero impiega 80 secondi
# invece di 20, e resta fermo li' senza fare altro. Con dodici run al giorno e
# una finestra di otto giorni, e' un prezzo che non si vede.
TENTATIVI = 5
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
    """Elenca i file dell'indice, ritentando come fanno HEAD e download.

    L'indice e' la prima chiamata del run e da lei dipendono tutte le altre:
    senza tentativi un rifiuto passeggero della sorgente ferma il run prima
    che abbia guardato un solo file. E' successo il 24 agosto 2026, due volte,
    con un 403 durato meno di un'ora.
    """
    ses = session or requests

    def _leggi():
        risposta = ses.get(base_url, timeout=60)
        risposta.raise_for_status()
        return risposta.text

    pagina = _con_tentativi(_leggi, f"GET {base_url}")
    file: list[SourceFile] = []
    for href in _HREF.findall(pagina):
        nome = href.rsplit("/", 1)[-1]
        analizzato = parse_filename(nome, base_url)
        if analizzato is not None:
            file.append(analizzato)
    return file


# Quello che di una risposta rifiutata vale la pena mettere a verbale. La
# lista e' chiusa apposta: registrare tutte le intestazioni vorrebbe dire
# scrivere cookie e chiavi in un log pubblico.
_INTESTAZIONI_UTILI = frozenset(
    {
        "retry-after",
        "server",
        "content-type",
        "cf-ray",
        "cf-mitigated",
        "x-cache",
        "via",
    }
)
_CORPO_MAX = 300


def _dettaglio(errore: Exception) -> str:
    """Cosa dice di se' una risposta rifiutata, che raise_for_status butta via.

    Un 403 nudo non distingue un filtro anti bot da un limitatore di frequenza
    da un deny secco, e i tre vogliono rimedi diversi: il 25 agosto 2026 siamo
    rimasti senza sapere quale dei tre fosse.

    Non puo' fallire. Una diagnosi che fa cadere il run e' peggio della sua
    assenza, e questa gira proprio quando qualcosa e' gia' andato storto.
    """
    risposta = getattr(errore, "response", None)
    # `is None` e non la verita': Response.__bool__ vale ok, quindi una
    # risposta 403 e' falsa e un `if not risposta` la scarterebbe sempre,
    # cioe' esattamente nel caso per cui questa funzione esiste.
    if risposta is None:
        return ""
    try:
        intestazioni = {
            nome: valore
            for nome, valore in risposta.headers.items()
            if nome.lower() in _INTESTAZIONI_UTILI
        }
        # Su download il corpo arriva in streaming e qui e' gia' chiuso: resta
        # vuoto, ed e' giusto cosi'. Il rifiuto che ci interessa e' sull'indice,
        # che e' una GET normale e il corpo ce l'ha.
        corpo = " ".join(risposta.text.split())[:_CORPO_MAX]
    except Exception:
        return f" [stato {risposta.status_code}, corpo non leggibile]"
    return (
        f" [stato {risposta.status_code}, intestazioni {intestazioni},"
        f" corpo: {corpo!r}]"
    )


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
                    "%s fallito (%s)%s, riprovo fra %.0f s",
                    descrizione,
                    errore,
                    _dettaglio(errore),
                    attesa,
                )
                time.sleep(attesa)
    # L'ultimo tentativo e' quello che decide l'esito del run: se il suo
    # dettaglio non finisce nel log, resta fuori proprio la riga che serve.
    log.error("%s fallito definitivamente (%s)%s", descrizione, ultimo, _dettaglio(ultimo))
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
