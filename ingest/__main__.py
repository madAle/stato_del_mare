"""Interfaccia a riga di comando.

Il primo comando da lanciare e' sempre `reconcile --dry-run`: stampa il piano
senza scrivere niente, e serve a capire se il diff ragiona come ci si aspetta.

Codici di uscita, pensati per un cron che deve decidere da solo cosa fare:

    0  tutto bene
    1  qualche file e' fallito, ritentabile: il run successivo recupera
    2  la griglia sorgente e' cambiata, niente e' stato scritto, serve un umano
    3  configurazione incompleta, fallira' identico a ogni tentativo

La distinzione fra 1 e gli altri due e' l'unica cosa che impedisce a un cron di
ritentare all'infinito un guasto che non si risolve da solo.
"""

import argparse
import logging
import sys
import tempfile
from pathlib import Path

from .config import WINDOW_DAYS
from .reconcile import GridMismatch, reconcile
from .storage import ObjectStore


def main(argv: list[str] | None = None) -> int:
    analizzatore = argparse.ArgumentParser(prog="ingest")
    sottocomandi = analizzatore.add_subparsers(dest="comando", required=True)

    r = sottocomandi.add_parser("reconcile", help="colma la differenza con la sorgente")
    r.add_argument("--dry-run", action="store_true", help="stampa il piano senza scrivere")
    r.add_argument("--window", type=int, default=WINDOW_DAYS, help="giorni da considerare")
    r.add_argument(
        "--only",
        default=None,
        help=(
            "lavora solo i file che contengono questa variabile. Attenzione: "
            "filtra per gruppo, non per variabile, quindi --only hwave pubblica "
            "anche periodo e direzione, che stanno nello stesso file"
        ),
    )
    r.add_argument("--workdir", default=None, help="cartella di lavoro temporanea")
    r.add_argument("--verbose", action="store_true")

    argomenti = analizzatore.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if argomenti.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # Le credenziali si leggono prima di tutto e fuori dal try sotto: mancarle
    # non e' un guasto passeggero, fallirebbe identico a ogni tentativo, e un
    # traceback grezzo farebbe sembrare rotto lo strumento invece che la
    # configurazione.
    try:
        store = ObjectStore.from_env()
    except RuntimeError as errore:
        logging.error("configurazione incompleta: %s", errore)
        logging.error("nessun tentativo eseguito, serve intervento umano")
        return 3

    with tempfile.TemporaryDirectory() as temporanea:
        workdir = Path(argomenti.workdir or temporanea)
        try:
            esito = reconcile(
                store,
                workdir,
                window_days=argomenti.window,
                only=argomenti.only,
                dry_run=argomenti.dry_run,
            )
        except GridMismatch as errore:
            logging.error("LA GRIGLIA SORGENTE E' CAMBIATA: %s", errore)
            logging.error("nessun dato scritto. Intervento umano necessario.")
            return 2

    logging.info(
        "pianificati %d, lavorati %d, saltati %d, errori %d",
        esito["planned"],
        esito["processed"],
        esito["skipped"],
        esito["errors"],
    )
    return 1 if esito["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
