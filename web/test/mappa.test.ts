import { describe, expect, it } from "vitest";
import { primoLivelloSimboli, ZOOM_MASSIMO } from "../src/map/mappa";

describe("ordine dei livelli", () => {
  it("il campo va prima del primo livello di simboli", () => {
    const stile = {
      layers: [
        { id: "sfondo", type: "background" },
        { id: "acqua", type: "fill" },
        { id: "strade", type: "line" },
        { id: "etichette_luoghi", type: "symbol" },
        { id: "etichette_strade", type: "symbol" },
      ],
    };
    expect(primoLivelloSimboli(stile)).toBe("etichette_luoghi");
  });

  it("uno stile senza simboli non fa saltare niente", () => {
    // in quel caso il campo va in cima, che e' il comportamento predefinito di
    // addLayer senza beforeId
    expect(primoLivelloSimboli({ layers: [{ id: "sfondo", type: "background" }] }))
      .toBeUndefined();
  });
});

describe("tetto di zoom", () => {
  it("e' 15, dove una cella del modello vale 353 pixel", () => {
    expect(ZOOM_MASSIMO).toBe(15);
  });
});
