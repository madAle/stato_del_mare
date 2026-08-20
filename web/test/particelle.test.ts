import { describe, expect, it } from "vitest";
import {
  avanza, latitudineDi, mescolaCampo, nasci, velocitaInCelle,
  FOTOGRAMMI_PER_PUNTO, PUNTI_SCIA,
  VELOCITA_PER_SECONDO_DI_PERIODO, type CampiDirezione, type Particella,
} from "../src/map/particelle";
import { NODATA } from "../src/data/frame";

/** Una griglia piccola, con la stessa geometria di quella vera. */
function campi(
  gradiDaCui: number, periodo = 4, larghezza = 8, altezza = 6,
): CampiDirezione {
  const n = larghezza * altezza;
  const r = (gradiDaCui * Math.PI) / 180;
  return {
    sin: new Float32Array(n).fill(Math.sin(r)),
    cos: new Float32Array(n).fill(Math.cos(r)),
    periodo: new Float32Array(n).fill(periodo),
    larghezza, altezza, risoluzioneM: 1200, yMax: 5_500_000,
  };
}

describe("il verso delle particelle", () => {
  it("vanno dove l'onda va, cioe' mezzo giro rispetto a dove viene", () => {
    // Convenzione nautica, ricavata dal dato il 2026-08-20 confrontando Dwave
    // con il verso in cui cresce l'altezza d'onda: l'angolo dice **da dove**.
    // Un'onda che viene da sud (180 gradi) viaggia verso nord, e nella griglia
    // il nord e' j che cala.
    const v = velocitaInCelle(campi(180), 4, 3)!;
    expect(v.dj).toBeLessThan(0);
    expect(Math.abs(v.di)).toBeLessThan(1e-6);
  });

  it("un'onda da ovest viaggia verso est, cioe' i che cresce", () => {
    const v = velocitaInCelle(campi(270), 4, 3)!;
    expect(v.di).toBeGreaterThan(0);
    expect(Math.abs(v.dj)).toBeLessThan(1e-6);
  });

  it("un'onda da nord-est viaggia verso sud-ovest", () => {
    const v = velocitaInCelle(campi(45), 4, 3)!;
    expect(v.di).toBeLessThan(0);   // verso ovest
    expect(v.dj).toBeGreaterThan(0); // verso sud
  });
});

describe("la velocita' viene dalla fisica, non da un numero scelto", () => {
  it("e' proporzionale al periodo, con la costante dell'acqua profonda", () => {
    // c = g T / 2 pi. Con T = 4 s sono 6,24 m/s: un mare lungo scorre
    // visibilmente piu' veloce di un mare corto, ed e' vero nel dato.
    const lento = velocitaInCelle(campi(180, 1), 4, 3)!;
    const veloce = velocitaInCelle(campi(180, 4), 4, 3)!;
    expect(Math.abs(veloce.dj) / Math.abs(lento.dj)).toBeCloseTo(4, 5);
    expect(VELOCITA_PER_SECONDO_DI_PERIODO).toBeCloseTo(1.5613, 3);
  });

  it("corregge la deformazione di Mercatore, se no il nord correrebbe di piu'", () => {
    // Un metro di mappa vale cos(latitudine) metri di mare: senza correzione le
    // particelle andrebbero il 9 per cento piu' veloci a Trieste che a Bari,
    // cioe' l'animazione mostrerebbe un gradiente che nel mare non c'e'.
    const c = campi(180, 4, 8, 600);
    const sud = velocitaInCelle(c, 4, 590)!;
    const nord = velocitaInCelle(c, 4, 10)!;
    const latSud = latitudineDi(c, 590);
    const latNord = latitudineDi(c, 10);
    expect(latNord).toBeGreaterThan(latSud);
    // piu' a nord, piu' metri di Mercatore per metro di mare, quindi meno celle
    expect(Math.abs(nord.dj)).toBeGreaterThan(Math.abs(sud.dj));
    expect(Math.abs(nord.dj) / Math.abs(sud.dj))
      .toBeCloseTo(Math.cos(latSud) / Math.cos(latNord), 6);
  });
});

describe("dove il dato non c'e'", () => {
  it("non restituisce una rotta inventata", () => {
    const c = campi(180);
    c.sin[0] = NaN; c.cos[0] = NaN;
    expect(velocitaInCelle(c, 0, 0)).toBeNull();
    expect(velocitaInCelle(campi(180), -1, 3)).toBeNull();
    expect(velocitaInCelle(campi(180), 99, 3)).toBeNull();
  });

  it("scarta un seno e coseno che non stanno su un cerchio unitario", () => {
    // Succede dove l'interpolazione fra due ore ha mescolato una cella con dato
    // e una senza: il risultato non e' una direzione, e' una media di niente.
    const c = campi(180);
    c.sin[0] = 0.1; c.cos[0] = 0.1;
    expect(velocitaInCelle(c, 0, 0)).toBeNull();
  });

  it("una particella su un buco rinasce, non resta ferma", () => {
    // Una particella immobile disegna un punto fisso, che si legge come "qui il
    // mare sta fermo" invece che come "qui non so".
    const c = campi(180);
    c.sin.fill(NaN); c.cos.fill(NaN);
    const p: Particella[] = [{ i: 4, j: 3, scia: [], vita: 100 }];
    let n = 0;
    avanza(p, c, 1, () => ((n = (n + 0.37) % 1), n), 50);
    expect(p[0].i === 4 && p[0].j === 3).toBe(false);
  });

  it("una particella che ha esaurito la vita rinasce anche se il campo c'e'", () => {
    // Senza ricambio le particelle si accumulano dove il campo converge e le
    // zone di uscita restano vuote: la densita' racconterebbe da quanto tempo
    // guardi, non com'e' il mare.
    const p: Particella[] = [{ i: 4, j: 3, scia: [1, 2], vita: 0 }];
    avanza(p, campi(180), 1, () => 0.5, 50);
    expect(p[0].scia).toEqual([]);
    expect(p[0].vita).toBeGreaterThan(0);
  });
});

describe("la scia", () => {
  it("tiene le ultime posizioni e non cresce senza fine", () => {
    const p = [nasci(campi(180), () => 0.5, 50)];
    for (let k = 0; k < 60; k++) avanza(p, campi(180), 0.1, () => 0.5, 5000);
    expect(p[0].scia.length).toBeLessThanOrEqual(PUNTI_SCIA * 2);
    expect(p[0].scia.length).toBeGreaterThan(2);
  });

  it("un punto ogni tanto, non uno per fotogramma", () => {
    // A una velocita' leggibile un fotogramma vale meno di un pixel: una scia
    // presa a ogni fotogramma e' lunga sei pixel, e a schermo non e' una
    // striscia ma polvere. Misurato, ed e' il motivo per cui esiste il salto.
    const p = [nasci(campi(180), () => 0.5, 500)];
    for (let k = 0; k < 12; k++) {
      avanza(p, campi(180), 0.1, () => 0.5, 5000, k % FOTOGRAMMI_PER_PUNTO === 0);
    }
    expect(p[0].scia.length / 2).toBe(Math.ceil(12 / FOTOGRAMMI_PER_PUNTO));
  });
});

describe("il campo mescolato", () => {
  it("usa l'altra ora dove una manca, invece di mediare con zero", () => {
    const a = Int16Array.from([NODATA, 200]);
    const b = Int16Array.from([300, NODATA]);
    expect(Array.from(mescolaCampo(a, b, 0.5, 0.01))).toEqual([3, 2]);
  });

  it("dove non ha dato nessuna delle due mette NaN", () => {
    expect(Number.isNaN(mescolaCampo(Int16Array.from([NODATA]), Int16Array.from([NODATA]), 0.5, 1)[0])).toBe(true);
  });
});
