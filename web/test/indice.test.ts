import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asseDeiTempi, buchi, leggiIndice, type Ora } from "../src/data/indice";

const AN = readFileSync("test/fixture/index-hwave-an.json", "utf8");
const FC = readFileSync("test/fixture/index-hwave-fc.json", "utf8");

function recupera(corpo: string): typeof fetch {
  return (async () => new Response(corpo, { status: 200 })) as unknown as typeof fetch;
}

describe("indice", () => {
  it("legge l'indice di analisi vero", async () => {
    const i = await leggiIndice("hwave", "an", ["2026-08"], recupera(AN));
    expect(i.size).toBe(216);
    expect(i.get(Date.parse("2026-08-09T01:00:00Z"))).toBe("20260810");
  });

  it("un mese assente non e' un guasto: il mese prima dell'archivio non esiste", async () => {
    const vuoto = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const i = await leggiIndice("hwave", "an", ["2026-07"], vuoto);
    expect(i.size).toBe(0);
  });
});

describe("asse dei tempi", () => {
  it("l'analisi vince sulla previsione dove esistono entrambe", async () => {
    const an = await leggiIndice("hwave", "an", ["2026-08"], recupera(AN));
    const fc = await leggiIndice("hwave", "fc", ["2026-08"], recupera(FC));
    const asse = asseDeiTempi(an, fc);
    // misurato: 216 ore di analisi, 264 di previsione, 192 in comune
    expect(asse.length).toBe(216 + 264 - 192);
    const comune = asse.find((o) => o.istante === Date.parse("2026-08-15T13:00:00Z"))!;
    expect(comune.tipo).toBe("an");
    const futura = asse.find((o) => o.istante === Date.parse("2026-08-20T12:00:00Z"))!;
    expect(futura.tipo).toBe("fc");
  });

  it("e' ordinato e senza duplicati", async () => {
    const an = await leggiIndice("hwave", "an", ["2026-08"], recupera(AN));
    const fc = await leggiIndice("hwave", "fc", ["2026-08"], recupera(FC));
    const asse = asseDeiTempi(an, fc);
    const istanti = asse.map((o) => o.istante);
    expect(istanti).toEqual([...istanti].sort((a, b) => a - b));
    expect(new Set(istanti).size).toBe(istanti.length);
  });
});

describe("buchi", () => {
  it("trova le ore mancanti invece di scavalcarle", () => {
    const ora = (s: string): Ora => ({
      istante: Date.parse(s), tipo: "an", riferimento: "20260810",
    });
    const asse = [
      ora("2026-08-09T01:00:00Z"),
      ora("2026-08-09T02:00:00Z"),
      ora("2026-08-09T06:00:00Z"),
    ];
    expect(buchi(asse)).toEqual([
      { da: Date.parse("2026-08-09T02:00:00Z"), a: Date.parse("2026-08-09T06:00:00Z") },
    ]);
  });

  it("un asse senza buchi non ne produce", () => {
    const asse: Ora[] = [
      { istante: Date.parse("2026-08-09T01:00:00Z"), tipo: "an", riferimento: "x" },
      { istante: Date.parse("2026-08-09T02:00:00Z"), tipo: "an", riferimento: "x" },
    ];
    expect(buchi(asse)).toEqual([]);
  });

  it("un asse con un solo elemento non produce buchi", () => {
    const asse: Ora[] = [
      { istante: Date.parse("2026-08-09T01:00:00Z"), tipo: "an", riferimento: "x" },
    ];
    expect(buchi(asse)).toEqual([]);
  });

  it("un asse non ordinato solleva errore", () => {
    const asse: Ora[] = [
      { istante: Date.parse("2026-08-09T06:00:00Z"), tipo: "an", riferimento: "x" },
      { istante: Date.parse("2026-08-09T02:00:00Z"), tipo: "an", riferimento: "x" },
    ];
    expect(() => buchi(asse)).toThrow(/asse non ordinato/);
  });
});
