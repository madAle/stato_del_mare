import { describe, expect, it } from "vitest";
import { ORA_MS, istanteEsteso, soloGiorno, soloOra, tacche } from "../src/ui/tempo";

/** L'ora dell'orologio sull'Adriatico, per controllare le tacche. */
function oraLocale(istante: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", hourCycle: "h23", hour: "2-digit",
  }).format(istante));
}
function minutoLocale(istante: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", minute: "2-digit",
  }).format(istante));
}

describe("formattazione", () => {
  it("scrive l'ora dell'Adriatico, e dichiara quale fuso e'", () => {
    // Chiesto il 2026-08-21: chi guarda il mare legge l'orologio che ha al
    // polso, non ocean_time. La sigla resta perche' senza, uno screenshot non
    // dice piu' in che fuso e' scritto, ed e' l'unica cosa che teneva in piedi
    // la scelta di UTC.
    expect(istanteEsteso(Date.UTC(2026, 7, 19, 9, 0))).toMatch(/11:00 CEST$/);
    expect(istanteEsteso(Date.UTC(2026, 7, 19, 9, 0))).toMatch(/19\/08/);
  });

  it("d'inverno torna all'ora solare, e la sigla cambia da sola", () => {
    expect(istanteEsteso(Date.UTC(2026, 0, 19, 9, 0))).toMatch(/10:00 CET$/);
  });

  it("il fuso e' quello del mare, non quello della macchina che disegna", () => {
    // Le 22:30 UTC sono l'una meno mezza del giorno dopo sull'Adriatico. Se il
    // fuso venisse dalla macchina, questa riga sarebbe verde qui e rossa in CI,
    // che gira a UTC: ed e' il modo in cui un test smette di misurare.
    // Fissarlo vuol dire anche che lo stesso fotogramma si legge con la stessa
    // ora da Roma, da New York e da Tokyo.
    expect(soloGiorno(Date.UTC(2026, 7, 19, 22, 30))).toContain("20/08");
    expect(soloOra(Date.UTC(2026, 7, 19, 22, 30))).toBe("00:30");
  });

  it("il solo giorno e la sola ora sono coerenti con l'esteso", () => {
    const t = Date.UTC(2026, 7, 19, 6, 0);
    expect(istanteEsteso(t)).toContain(soloGiorno(t));
    expect(istanteEsteso(t)).toContain(soloOra(t));
  });
});

describe("tacche della scala", () => {
  const t = (giorno: number, ora: number) => Date.UTC(2026, 7, giorno, ora);

  it("su una finestra breve cadono ogni sei ore, su ore tonde locali", () => {
    // Ore tonde per chi legge, non per Greenwich: una scala che segna 05:00,
    // 11:00, 17:00 non e' una scala, e sarebbe esattamente quello che si vede
    // formattando in locale delle tacche calcolate in UTC.
    const trovate = tacche(t(19, 3), t(19, 21));
    expect(trovate.map((x) => oraLocale(x.istante))).toEqual([6, 12, 18]);
    expect(trovate.map((x) => new Date(x.istante).getUTCHours())).toEqual([4, 10, 16]);
  });

  it("su una finestra di giorni si diradano invece di diventare una riga nera", () => {
    const cinqueGiorni = tacche(t(15, 0), t(20, 0));
    expect(cinqueGiorni.length).toBeLessThan(12);
    const duesettimane = tacche(t(1, 0), t(15, 0));
    expect(duesettimane.length).toBeLessThan(20);
  });

  it("riconosce la mezzanotte, che e' la tacca da etichettare col giorno", () => {
    const trovate = tacche(t(19, 3), t(20, 12));
    const mezzenotti = trovate.filter((x) => x.mezzanotte);
    expect(mezzenotti).toHaveLength(1);
    // La mezzanotte di chi guarda, cioe' le 22:00 UTC del giorno prima: se
    // restasse quella UTC, l'etichetta del giorno cadrebbe sulla tacca delle
    // 02:00 e il confine fra un giorno e l'altro sarebbe disegnato nel posto
    // sbagliato.
    expect(oraLocale(mezzenotti[0].istante)).toBe(0);
    expect(mezzenotti[0].istante).toBe(Date.UTC(2026, 7, 19, 22));
  });

  it("un intervallo vuoto o rovesciato non produce tacche invece di sollevare", () => {
    // lo scrubber lo chiama a ogni render, anche mentre l'asse e' di un elemento
    expect(tacche(t(19, 0), t(19, 0))).toEqual([]);
    expect(tacche(t(20, 0), t(19, 0))).toEqual([]);
  });

  it("l'ora vale un'ora", () => {
    expect(ORA_MS).toBe(3_600_000);
  });
});

describe("le tacche si diradano quando le etichette non ci stanno", () => {
  const ORA = 3_600_000;
  const inizio = Date.parse("2026-08-11T00:00:00Z");

  it("otto giorni in una scala da telefono danno meno di otto etichette", () => {
    // il difetto vero, visto su iPhone il 2026-08-19: l'asse aperto su tutto
    // l'archivio produceva otto etichette da giorno larghe 55 px in 335 px di
    // scala, una sopra l'altra. In 335 px ne stanno cinque.
    // Otto, e non nove come quando le tacche erano in UTC: la finestra parte
    // dalla mezzanotte di Greenwich, che sull'Adriatico sono le 02:00, quindi di
    // mezzanotti locali dentro 192 ore ce ne stanno otto. Da qui una cosa da
    // sapere: il numero di tacche dipende ora **da dove comincia** la finestra
    // rispetto alla mezzanotte locale, e 192 ore ne danno otto o nove. Sembrera'
    // un difetto a chi lo incontrera' senza questa riga.
    expect(tacche(inizio, inizio + 192 * ORA).length).toBe(8);
    expect(tacche(inizio, inizio + 192 * ORA, 5).length).toBeLessThanOrEqual(5);
  });

  it("il passo si allarga, non si scartano tacche a caso", () => {
    // scartare le etichette in eccesso lascerebbe buchi irregolari: si allarga
    // il passo, cosi' la scala resta uniforme e leggibile
    const t = tacche(inizio, inizio + 192 * ORA, 5);
    const passi = t.slice(1).map((x, i) => x.istante - t[i].istante);
    expect(new Set(passi).size).toBe(1);
  });

  it("senza sapere la larghezza si decide come prima, sulla sola ampiezza", () => {
    // jsdom e il primo render non conoscono la larghezza: meglio la scelta di
    // prima che una scala arbitrariamente rada
    expect(tacche(inizio, inizio + 192 * ORA))
      .toEqual(tacche(inizio, inizio + 192 * ORA, Number.POSITIVE_INFINITY));
  });

  it("un tetto impossibile non manda in ciclo infinito", () => {
    expect(() => tacche(inizio, inizio + 192 * ORA, 0)).not.toThrow();
    expect(tacche(inizio, inizio + 192 * ORA, 0).length).toBeGreaterThan(0);
  });
});

describe("tacche e ora legale", () => {
  // L'asse tiene otto giorni indietro e tre avanti, quindi due volte l'anno
  // attraversa un cambio d'ora. Con un solo scarto calcolato a un capo, le
  // tacche dopo il salto cadrebbero all'01:00 e alle 03:00, e la mezzanotte
  // finirebbe su una tacca che mezzanotte non e'.

  it("il ritorno all'ora solare non sposta le tacche", () => {
    // Domenica 25 ottobre 2026: alle 03:00 locali si torna alle 02:00.
    const trovate = tacche(Date.UTC(2026, 9, 24, 12), Date.UTC(2026, 9, 26, 12));
    expect(trovate.length).toBeGreaterThan(0);
    for (const x of trovate) {
      expect(minutoLocale(x.istante), `${new Date(x.istante).toISOString()}`).toBe(0);
      expect(oraLocale(x.istante) % 6, `${new Date(x.istante).toISOString()}`).toBe(0);
    }
    expect(trovate.filter((x) => x.mezzanotte)).toHaveLength(2);
  });

  it("il passaggio all'ora legale nemmeno", () => {
    // Domenica 29 marzo 2026: alle 02:00 locali si salta alle 03:00, e l'ora
    // fra le due non esiste.
    const trovate = tacche(Date.UTC(2026, 2, 28, 12), Date.UTC(2026, 2, 30, 12));
    expect(trovate.length).toBeGreaterThan(0);
    for (const x of trovate) {
      expect(minutoLocale(x.istante), `${new Date(x.istante).toISOString()}`).toBe(0);
    }
    expect(trovate.filter((x) => x.mezzanotte)).toHaveLength(2);
  });
});
