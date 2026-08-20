import { describe, expect, it } from "vitest";
import type { Ora } from "../src/data/indice";
import { inquadra, oraPiuVicina, provenienza, scadenzaOre } from "../src/data/sorgente";

const an = (iso: string, rif: string): Ora => ({
  istante: Date.parse(iso), tipo: "an", riferimento: rif,
});
const fc = (iso: string, rif: string): Ora => ({
  istante: Date.parse(iso), tipo: "fc", riferimento: rif,
});

const ASSE: Ora[] = [
  an("2026-08-15T10:00:00Z", "20260815"),
  an("2026-08-15T11:00:00Z", "20260815"),
  an("2026-08-15T12:00:00Z", "20260816"),
  fc("2026-08-20T12:00:00Z", "20260818"),
];

describe("inquadratura", () => {
  it("su un istante esatto la frazione e' zero", () => {
    const q = inquadra(ASSE, Date.parse("2026-08-15T11:00:00Z"))!;
    expect(q.prima.istante).toBe(Date.parse("2026-08-15T11:00:00Z"));
    expect(q.frazione).toBe(0);
  });

  it("a meta' fra due ore la frazione e' un mezzo", () => {
    const q = inquadra(ASSE, Date.parse("2026-08-15T11:30:00Z"))!;
    expect(q.prima.istante).toBe(Date.parse("2026-08-15T11:00:00Z"));
    expect(q.dopo!.istante).toBe(Date.parse("2026-08-15T12:00:00Z"));
    expect(q.frazione).toBeCloseTo(0.5, 6);
  });

  it("dentro un buco non si interpola: si resta sull'ora prima", () => {
    // fra il 15 alle 12 e il 20 alle 12 mancano cinque giorni. Fondere due
    // campi lontani cinque giorni produrrebbe un'animazione morbida e falsa,
    // che e' peggio di un salto visibile.
    const q = inquadra(ASSE, Date.parse("2026-08-17T00:00:00Z"))!;
    expect(q.prima.istante).toBe(Date.parse("2026-08-15T12:00:00Z"));
    expect(q.dopo).toBeNull();
    expect(q.frazione).toBe(0);
  });

  it("fuori dall'asse non inventa niente", () => {
    expect(inquadra(ASSE, Date.parse("2026-01-01T00:00:00Z"))).toBeNull();
    expect(inquadra([], Date.now())).toBeNull();
  });
});

describe("provenienza", () => {
  it("l'analisi si chiama analisi", () => {
    expect(scadenzaOre(an("2026-08-15T11:00:00Z", "20260815"))).toBeNull();
    expect(provenienza(an("2026-08-15T11:00:00Z", "20260815"))).toBe("analisi");
  });

  it("la scadenza si conta dalle 00Z della data di riferimento", () => {
    // misurato sul bucket il 2026-08-18: la corsa 20260815 copre da
    // 2026-08-15T01:00Z a 2026-08-16T00:00Z, quindi la prima scadenza e' +1h
    expect(scadenzaOre(fc("2026-08-15T01:00:00Z", "20260815"))).toBe(1);
    expect(scadenzaOre(fc("2026-08-15T18:00:00Z", "20260815"))).toBe(18);
    expect(scadenzaOre(fc("2026-08-16T00:00:00Z", "20260815"))).toBe(24);
    expect(provenienza(fc("2026-08-15T18:00:00Z", "20260815"))).toBe("previsione +18h");
  });
});

describe("l'inquadratura senza dissolvenza", () => {
  const a: Ora = { istante: Date.UTC(2026, 7, 19, 9), tipo: "an", riferimento: "20260819" };
  const b: Ora = { istante: Date.UTC(2026, 7, 19, 10), tipo: "an", riferimento: "20260819" };

  it("prende l'ora piu' vicina e azzera la frazione", () => {
    // Nessun valore intermedio: il periodo di picco prende 17 valori in tutto
    // l'archivio (la griglia delle frequenze di SWAN), e fondere 3,48 con 3,95
    // darebbe 3,71 s, che il modello non puo' produrre.
    expect(oraPiuVicina({ prima: a, dopo: b, frazione: 0.1 })).toEqual({ prima: a, dopo: null, frazione: 0 });
    expect(oraPiuVicina({ prima: a, dopo: b, frazione: 0.9 })).toEqual({ prima: b, dopo: null, frazione: 0 });
  });

  it("a meta' esatta passa all'ora dopo, senza restare a cavallo", () => {
    // Il confine va scelto, non lasciato al caso: a 0,5 esatti si e' gia' piu'
    // vicini all'ora dopo che a quella prima per ogni istante successivo.
    expect(oraPiuVicina({ prima: a, dopo: b, frazione: 0.5 }).prima).toBe(b);
    expect(oraPiuVicina({ prima: a, dopo: b, frazione: 0.4999 }).prima).toBe(a);
  });

  it("dentro un buco non cambia niente: non c'era niente da fondere", () => {
    const dentroUnBuco = { prima: a, dopo: null, frazione: 0 };
    expect(oraPiuVicina(dentroUnBuco)).toEqual(dentroUnBuco);
  });
});
