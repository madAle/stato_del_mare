import { describe, expect, it } from "vitest";
import type { Griglia } from "../src/data/catalogo";
import { NODATA } from "../src/data/frame";
import { cellaDi, valoreA } from "../src/map/proiezione";

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
