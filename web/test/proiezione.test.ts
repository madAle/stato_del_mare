import { describe, expect, it } from "vitest";
import type { Griglia } from "../src/data/catalogo";
import { NODATA } from "../src/data/frame";
import type { Ora } from "../src/data/indice";
import { cellaDi, valoreA, valoreCorrente } from "../src/map/proiezione";

// la griglia vera, presa dal catalogo
const GRIGLIA: Griglia = {
  larghezza: 858, altezza: 844, risoluzioneM: 1200,
  boundsLonLat: {
    ovest: 10.843700499983923, sud: 39.75586866390025,
    est: 20.092754665278516, nord: 46.39161194148169,
  },
};

describe("cella", () => {
  it("l'angolo di nordovest e' la cella 0,0", () => {
    const c = cellaDi(GRIGLIA, GRIGLIA.boundsLonLat.ovest + 0.001,
                      GRIGLIA.boundsLonLat.nord - 0.001)!;
    expect(c).toEqual({ colonna: 0, riga: 0 });
  });

  it("l'angolo di sudest e' l'ultima cella", () => {
    const c = cellaDi(GRIGLIA, GRIGLIA.boundsLonLat.est - 0.001,
                      GRIGLIA.boundsLonLat.sud + 0.001)!;
    expect(c).toEqual({ colonna: 857, riga: 843 });
  });

  it("un punto sul bordo est esatto cade nell'ultima colonna", () => {
    const c = cellaDi(GRIGLIA, GRIGLIA.boundsLonLat.est, 44)!;
    expect(c.colonna).toBe(857);
  });

  it("un punto sul bordo sud esatto cade nell'ultima riga", () => {
    const c = cellaDi(GRIGLIA, 13, GRIGLIA.boundsLonLat.sud)!;
    expect(c.riga).toBe(843);
  });

  it("l'angolo di sudest esatto e' la cella 857,843", () => {
    const c = cellaDi(GRIGLIA, GRIGLIA.boundsLonLat.est, GRIGLIA.boundsLonLat.sud)!;
    expect(c).toEqual({ colonna: 857, riga: 843 });
  });

  it("la riga cresce verso SUD, che e' il verso del frame e non quello dell'istinto", () => {
    const nord = cellaDi(GRIGLIA, 13, 46)!;
    const sud = cellaDi(GRIGLIA, 13, 41)!;
    expect(sud.riga).toBeGreaterThan(nord.riga);
  });

  it("fuori dal dominio non restituisce una cella qualsiasi", () => {
    expect(cellaDi(GRIGLIA, 5, 44)).toBeNull();
    expect(cellaDi(GRIGLIA, 13, 60)).toBeNull();
  });
});

describe("valore", () => {
  it("applica scala e offset", () => {
    const dato = new Int16Array(858 * 844);
    const c = cellaDi(GRIGLIA, 13, 44)!;
    dato[c.riga * 858 + c.colonna] = 1234;
    expect(valoreA(GRIGLIA, dato, 13, 44, 0.001, 0)).toBeCloseTo(1.234, 6);
  });

  it("il nodata non diventa meno trentadue metri di onda", () => {
    // NODATA vale -32768 e con scala 0,001 diventerebbe -32,768 m: un valore
    // perfettamente stampabile e completamente falso
    const dato = new Int16Array(858 * 844).fill(NODATA);
    expect(valoreA(GRIGLIA, dato, 13, 44, 0.001, 0)).toBeNull();
  });
});

describe("valoreCorrente", () => {
  const ore: Ora[] = [
    { istante: Date.UTC(2026, 7, 15, 10), tipo: "an", riferimento: "20260815" },
    { istante: Date.UTC(2026, 7, 15, 11), tipo: "an", riferimento: "20260815" },
    { istante: Date.UTC(2026, 7, 15, 12), tipo: "an", riferimento: "20260815" },
  ];

  function fotogramma(valoreGrezzo: number): Int16Array {
    const dato = new Int16Array(858 * 844);
    const c = cellaDi(GRIGLIA, 13, 44)!;
    dato[c.riga * 858 + c.colonna] = valoreGrezzo;
    return dato;
  }

  // Un dizionario per riferimento, non per chiave testuale: e' quello che
  // conta qui, cioe' che la funzione chieda il fotogramma giusto, non come lo
  // identifica una cache vera (quello e' compito di Prefetcher.chiave).
  const frame = new Map<Ora, Int16Array>([
    [ore[0], fotogramma(1000)],
    [ore[1], fotogramma(2000)],
    [ore[2], fotogramma(3000)],
  ]);
  const prendiFrame = (ora: Ora) => frame.get(ora);

  it("legge il fotogramma dell'istante corrente, non il primo dell'asse", () => {
    // prima della correzione questa chiamata avrebbe letto asse[0] a
    // prescindere dall'istante, cioe' 1,0 invece di 2,0
    expect(valoreCorrente(GRIGLIA, ore, ore[1].istante, prendiFrame, 13, 44, 0.001, 0))
      .toBeCloseTo(2.0, 6);
    expect(valoreCorrente(GRIGLIA, ore, ore[2].istante, prendiFrame, 13, 44, 0.001, 0))
      .toBeCloseTo(3.0, 6);
  });

  it("fuori dall'asse non inventa niente", () => {
    expect(valoreCorrente(GRIGLIA, ore, Date.UTC(2026, 0, 1), prendiFrame, 13, 44, 0.001, 0))
      .toBeNull();
  });

  it("un fotogramma non ancora arrivato non fa saltare niente", () => {
    expect(valoreCorrente(GRIGLIA, ore, ore[0].istante, () => undefined, 13, 44, 0.001, 0))
      .toBeNull();
  });
});
