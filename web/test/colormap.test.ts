import { describe, expect, it } from "vitest";
import { coloreA, PALETTE, paletteDi } from "../src/map/colormap";

describe("palette", () => {
  it("ogni palette ha 256 terne", () => {
    for (const [nome, p] of Object.entries(PALETTE)) {
      expect(p.length, nome).toBe(256 * 3);
    }
  });

  it("contiene le palette che il catalogo nomina oggi", () => {
    for (const nome of ["amp", "tempo", "phase", "speed", "balance"]) {
      expect(paletteDi(nome)).toBeDefined();
    }
  });

  it("amp va dal quasi bianco al rosso scuro", () => {
    // cmocean amp e' sequenziale: il basso e' chiaro, l'alto e' scuro. Se
    // qualcuno la rigenerasse al contrario, il mare calmo diventerebbe scuro e
    // la mappa mentirebbe a colpo d'occhio.
    const luminosita = (c: readonly number[]) => c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1;
    expect(luminosita(coloreA("amp", 0))).toBeGreaterThan(200);
    expect(luminosita(coloreA("amp", 1))).toBeLessThan(100);
  });

  it("phase e' ciclica: i due estremi quasi coincidono", () => {
    const a = coloreA("phase", 0);
    const b = coloreA("phase", 1);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(30);
  });

  it("un nome sconosciuto si ferma invece di disegnare grigio", () => {
    expect(() => paletteDi("arcobaleno")).toThrow(/sconosciuta/);
  });
});
