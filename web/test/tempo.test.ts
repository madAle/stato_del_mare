import { describe, expect, it } from "vitest";
import { ORA_MS, istanteEsteso, soloGiorno, soloOra, tacche } from "../src/ui/tempo";

describe("formattazione", () => {
  it("dichiara sempre UTC, perche' il dato non e' nell'ora di chi guarda", () => {
    // se un giorno qualcuno togliesse timeZone: "UTC", questo test diventerebbe
    // rosso solo sulle macchine fuori da Greenwich: per questo si controlla la
    // stringa e non l'ora locale
    expect(istanteEsteso(Date.UTC(2026, 7, 19, 9, 0))).toMatch(/09:00 UTC$/);
    expect(istanteEsteso(Date.UTC(2026, 7, 19, 9, 0))).toMatch(/19\/08/);
  });

  it("il solo giorno e la sola ora sono coerenti con l'esteso", () => {
    const t = Date.UTC(2026, 7, 19, 6, 0);
    expect(istanteEsteso(t)).toContain(soloGiorno(t));
    expect(istanteEsteso(t)).toContain(soloOra(t));
  });
});

describe("tacche della scala", () => {
  const t = (giorno: number, ora: number) => Date.UTC(2026, 7, giorno, ora);

  it("su una finestra breve cadono ogni sei ore, su ore tonde UTC", () => {
    const trovate = tacche(t(19, 3), t(19, 21));
    expect(trovate.map((x) => new Date(x.istante).getUTCHours())).toEqual([6, 12, 18]);
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
    expect(new Date(mezzenotti[0].istante).getUTCDate()).toBe(20);
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
