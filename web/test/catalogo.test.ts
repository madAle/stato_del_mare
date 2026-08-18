import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leggiCatalogo } from "../src/data/catalogo";
import { urlFrame, urlIndice } from "../src/data/urls";

const CATALOGO = readFileSync("test/fixture/catalog.json", "utf8");

function recuperaFinto(): typeof fetch {
  return (async () => new Response(CATALOGO, {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;
}

describe("catalogo", () => {
  it("legge griglia e variabili dal catalogo vero", async () => {
    const c = await leggiCatalogo(recuperaFinto());
    expect(c.griglia.larghezza).toBe(858);
    expect(c.griglia.altezza).toBe(844);
    expect(c.griglia.risoluzioneM).toBe(1200);
    expect(c.griglia.boundsLonLat.ovest).toBeCloseTo(10.8437, 4);
    expect(c.variabili.map((v) => v.id)).toContain("hwave");
    const onda = c.variabili.find((v) => v.id === "hwave")!;
    expect(onda.scala).toBe(0.001);
    expect(onda.colormap).toBe("amp");
    expect(Object.keys(onda.tipi).sort()).toEqual(["an", "fc"]);
    // La riga che mancava: il bucket scrive "months" (il JSON grezzo, vedi la
    // fixture), il tipo Variabile dichiara "mesi". Un cast che afferma la
    // conversione senza farla lascia questo campo undefined, e solo
    // leggendolo davvero il difetto si vede.
    expect(onda.tipi.an.mesi).toEqual(["2026-08"]);
    expect(onda.tipi.fc.mesi).toEqual(["2026-08"]);
  });

  it("rifiuta uno schema che non conosce invece di indovinare", async () => {
    const futuro = JSON.stringify({ ...JSON.parse(CATALOGO), schema_version: 99 });
    const recupera = (async () => new Response(futuro, { status: 200 })) as unknown as typeof fetch;
    await expect(leggiCatalogo(recupera)).rejects.toThrow(/schema 99/);
  });
});

describe("url", () => {
  it("costruisce la chiave di un frame come la scrive l'ingestore", () => {
    // riferimento reale sul bucket: nella chiave i minuti ci sono sempre e non
    // c'e' il carattere due punti
    expect(urlFrame("hwave", "an", "20260817", new Date("2026-08-16T12:00:00Z")))
      .toBe("https://pub-58d91a839da640f8ab33e576c44b89c8.r2.dev/frames/hwave/an/20260817/2026-08-16T1200.bin");
  });

  it("costruisce la chiave di un indice mensile", () => {
    expect(urlIndice("hwave", "fc", "2026-08"))
      .toBe("https://pub-58d91a839da640f8ab33e576c44b89c8.r2.dev/index/hwave/fc/2026-08.json");
  });
});
