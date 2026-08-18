# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "pillow", "requests"]
# ///
"""Campo di distanza con segno dal bordo del dato, sulla griglia della costa.

Risponde alla domanda "quanto ci si sta allontanando dal dato", e serve a
spegnere il campo dove il modello non ha celle.

Non e' la distanza dal campione valido piu' vicino. Quella, dentro il dato,
vale la distanza dal centro del texel piu' vicino: continua ma **periodica**,
cioe' una scacchiera su tutto il mare aperto. Ci sono voluti tre tentativi per
arrivarci, e il difetto e' insidioso proprio perche' non salta all'occhio come
un blocco.

La maschera di terra del modello non cambia da un frame all'altro, quindi
questo file e' statico per gruppo di variabili e si rigenera solo se ADRIAC
cambia dominio (nel qual caso l'ingestore si ferma da solo con GridMismatch).

    uv run strumenti/maschera_dato.py --frame URL --uscita web/public
"""

import argparse
import json
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy.ndimage import distance_transform_edt

NODATA = -32768
RISOLUZIONE_DATO_M = 1200.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frame", required=True, help="URL di un frame qualunque della variabile")
    ap.add_argument("--costa", type=Path, default=Path("web/public/costa_sdf.json"),
                    help="metadati della costa, da cui si prende la griglia fine")
    ap.add_argument("--uscita", type=Path, required=True)
    ap.add_argument("--limite", type=float, default=4000.0)
    a = ap.parse_args()

    meta = json.loads(a.costa.read_text())
    risoluzione = meta["resolution_m"]
    fattore = int(round(RISOLUZIONE_DATO_M / risoluzione))
    # Divisione esatta o niente: un resto assorbito in silenzio nasconderebbe
    # uno scarto di griglia esattamente nel punto in cui il controllo sui byte,
    # qui sotto, dovrebbe farlo saltare all'occhio.
    if meta["width"] % fattore or meta["height"] % fattore:
        raise SystemExit(
            f"griglia della costa {meta['width']}x{meta['height']} non e' multiplo "
            f"esatto del fattore {fattore} (risoluzione dato {RISOLUZIONE_DATO_M} m "
            f"su risoluzione costa {risoluzione} m)"
        )
    larghezza = meta["width"] // fattore
    altezza = meta["height"] // fattore

    # Senza raise_for_status(), un errore del bucket si travestirebbe da griglia
    # sbagliata: il corpo sarebbe una pagina d'errore, la lunghezza non
    # tornerebbe, e il messaggio del controllo sotto manderebbe a cercare il
    # problema nella griglia invece che nella rete.
    risposta = requests.get(a.frame, timeout=120)
    risposta.raise_for_status()
    grezzo = risposta.content
    atteso = larghezza * altezza * 2
    if len(grezzo) != atteso:
        raise SystemExit(
            f"frame di {len(grezzo)} byte, attesi {atteso} per {larghezza}x{altezza}: "
            "la griglia del frame non corrisponde a quella della costa"
        )

    valido = np.frombuffer(grezzo, dtype="<i2").reshape(altezza, larghezza) != NODATA
    fine = np.repeat(np.repeat(valido, fattore, axis=0), fattore, axis=1)

    dentro = distance_transform_edt(fine) * risoluzione
    fuori = distance_transform_edt(~fine) * risoluzione
    # Mezzo texel di correzione da entrambi i lati: al centro di una cella di
    # bordo la distanza vale mezzo passo, non zero, e senza questa riga il
    # livello zero cadrebbe dentro l'ultima cella valida invece che sul confine.
    campo = np.where(fine, dentro - 0.5 * risoluzione, -(fuori - 0.5 * risoluzione))
    campo = np.clip(campo, -a.limite, a.limite)

    byte = np.rint((campo / a.limite + 1.0) * 0.5 * 255.0).astype(np.uint8)
    a.uscita.mkdir(parents=True, exist_ok=True)
    Image.fromarray(byte, mode="L").save(a.uscita / "maschera_dato.png", optimize=True)
    (a.uscita / "maschera_dato.json").write_text(json.dumps({
        "width": int(fine.shape[1]), "height": int(fine.shape[0]),
        "resolution_m": risoluzione, "limite_m": a.limite,
        "x_min": meta["x_min"], "x_max": meta["x_max"],
        "y_min": meta["y_min"], "y_max": meta["y_max"],
        "frame_sorgente": a.frame,
    }, indent=1) + "\n")
    print(f"dato su {fine.mean()*100:.0f}% del riquadro, scritto {a.uscita}/maschera_dato.png")


if __name__ == "__main__":
    main()
