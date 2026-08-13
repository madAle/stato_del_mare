"""Interfaccia a riga di comando.

Il primo comando da lanciare e' sempre `reconcile --dry-run`: stampa il piano
senza scrivere niente, e serve a capire se il diff ragiona come ci si aspetta.

Codici di uscita, pensati per un cron che deve decidere da solo cosa fare:

    0  tutto bene
    1  qualche file e' fallito o e' stato rimandato, ritentabile: il run
       successivo recupera
    2  guasto che non si risolve da solo, il run si e' fermato, serve un umano:
       la griglia sorgente e' cambiata, le unita' di una variabile sono
       cambiate, oppure due stazioni diverse collidono sullo stesso
       identificativo
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
from .frames import UnitMismatch
from .reconcile import GridMismatch, reconcile
from .stations import StationCollision
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
        except UnitMismatch as errore:
            logging.error("LE UNITA' DELLA SORGENTE SONO CAMBIATE: %s", errore)
            logging.error(
                "un cambio di unita' non si annuncia: i valori restano "
                "plausibili e diventano sbagliati. Intervento umano necessario."
            )
            return 2
        except StationCollision as errore:
            # Come GridMismatch: una collisione di nomi nel flusso ARPAE non si
            # risolve da sola. Senza questa clausola Python stampava un
            # traceback e usciva 1, cioe' "ritentabile, il run successivo
            # recupera", e il cron avrebbe ritentato due volte al giorno per
            # sempre mentre la notifica prometteva che sarebbe guarito.
            logging.error("COLLISIONE FRA STAZIONI: %s", errore)
            logging.error(
                "l'identificativo e' un segmento di percorso permanente: due "
                "stazioni fuse mescolerebbero le loro storie. Intervento umano "
                "necessario."
            )
            return 2

    logging.info(
        "pianificati %d, lavorati %d, saltati %d, rimandati %d, errori %d",
        esito["planned"],
        esito["processed"],
        esito["skipped"],
        esito["deferred"],
        esito["errors"],
    )
    # Un file rimandato e' lavoro non fatto, non lavoro non necessario: non
    # deve poter uscire 0. E' ritentabile, perche' basta che il prossimo run
    # trovi un file del gruppo di riferimento da cui costruire l'indice.
    return 1 if esito["errors"] or esito["deferred"] else 0


if __name__ == "__main__":
    sys.exit(main())
