import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Gli asset sono prodotti da uno strumento e non versionati, quindi il rischio
 * non e' che siano sbagliati ma che manchino o che siano di un'altra griglia.
 * Un campo di distanza della griglia sbagliata non fa fallire niente: ritaglia
 * il mare nel posto sbagliato e sembra un difetto dello shader.
 */
const attesi = {
  "public/costa_sdf.json": { width: 4290, height: 4220, resolution_m: 240 },
  "public/maschera_dato.json": { width: 4290, height: 4220, resolution_m: 240 },
};

describe("asset statici", () => {
  for (const [percorso, forma] of Object.entries(attesi)) {
    it(`${percorso} esiste e ha la griglia attesa`, () => {
      expect(existsSync(percorso), `${percorso} manca: eseguire gli strumenti`).toBe(true);
      const m = JSON.parse(readFileSync(percorso, "utf8"));
      expect(m.width).toBe(forma.width);
      expect(m.height).toBe(forma.height);
      expect(m.resolution_m).toBe(forma.resolution_m);
    });
  }

  it("i due campi coprono lo stesso riquadro", () => {
    const costa = JSON.parse(readFileSync("public/costa_sdf.json", "utf8"));
    const dato = JSON.parse(readFileSync("public/maschera_dato.json", "utf8"));
    // se i riquadri differissero, le due texture userebbero coordinate diverse
    // e il ritaglio scivolerebbe rispetto al dato senza che niente si lamenti
    for (const k of ["x_min", "x_max", "y_min", "y_max"]) {
      expect(dato[k]).toBeCloseTo(costa[k], 6);
    }
  });

  it("le immagini non sono vuote", () => {
    for (const png of ["public/costa_sdf.png", "public/maschera_dato.png"]) {
      expect(statSync(png).size).toBeGreaterThan(100_000);
    }
  });
});
