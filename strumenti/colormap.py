# /// script
# requires-python = ">=3.11"
# dependencies = ["cmocean", "numpy"]
# ///
"""Scrive src/map/colormap.ts con le palette cmocean a 256 passi.

I colori stanno nella SPA e non nel pacchetto d'archivio: sono presentazione,
non misura. Ma vengono da cmocean e non dall'occhio di chi scrive, perche' una
palette non percettivamente uniforme su un campo geofisico introduce contorni
che sembrano struttura fisica e non lo sono.

    uv run strumenti/colormap.py > web/src/map/colormap.ts
"""

import cmocean
import numpy as np

# I nomi sono quelli che il catalogo pubblica per variabile.
PALETTE = {
    "amp": cmocean.cm.amp,
    "tempo": cmocean.cm.tempo,
    "phase": cmocean.cm.phase,
    "speed": cmocean.cm.speed,
    "balance": cmocean.cm.balance,
    "thermal": cmocean.cm.thermal,
    "haline": cmocean.cm.haline,
}

CODA = '''
/** La palette di un nome, con un guasto esplicito se il nome non c'e'. */
export function paletteDi(nome: string): Uint8Array {
  const p = PALETTE[nome];
  if (!p) {
    throw new Error(
      `palette ${nome} sconosciuta: il catalogo ne pubblica una che questa ` +
        `versione della SPA non conosce. Rigenerare colormap.ts.`,
    );
  }
  return p;
}

/** Il colore a una frazione della scala, per la legenda in HTML. */
export function coloreA(nome: string, t: number): Colore {
  const p = paletteDi(nome);
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return [p[i], p[i + 1], p[i + 2]] as const;
}
'''


def main() -> None:
    righe = [
        "// GENERATO DA strumenti/colormap.py, NON MODIFICARE A MANO.",
        "// Rigenerare con: uv run strumenti/colormap.py > web/src/map/colormap.ts",
        "",
        "export type Colore = readonly [number, number, number];",
        "",
        "export const PALETTE: Record<string, Uint8Array> = {",
    ]
    for nome, mappa in PALETTE.items():
        rgb = (np.asarray(mappa(np.linspace(0, 1, 256)))[:, :3] * 255).round().astype(int)
        righe.append(f"  {nome}: new Uint8Array([{','.join(str(v) for v in rgb.ravel())}]),")
    righe.append("};")
    righe.append(CODA)
    print("\n".join(righe))


if __name__ == "__main__":
    main()
