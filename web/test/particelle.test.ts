import { describe, expect, it } from "vitest";
import {
  avanza, cresta, latitudineDi, mescolaCampo, nasci, velocitaInCelle,
  VELOCITA_PER_SECONDO_DI_PERIODO, type CampiMoto, type Particella,
} from "../src/map/particelle";
import { NODATA } from "../src/data/frame";

/** Una griglia piccola, con la stessa geometria di quella vera. */
function campi(
  gradiDaCui: number, periodo = 4, larghezza = 8, altezza = 6,
): CampiMoto {
  const n = larghezza * altezza;
  const r = (gradiDaCui * Math.PI) / 180;
  return {
    tipo: "onda",
    sin: new Float32Array(n).fill(Math.sin(r)),
    cos: new Float32Array(n).fill(Math.cos(r)),
    periodo: new Float32Array(n).fill(periodo),
    larghezza, altezza, risoluzioneM: 1200, yMax: 5_500_000,
  };
}

/** Un campo di corrente uniforme, in m/s. */
function correnteUniforme(
  est: number, nord: number, larghezza = 8, altezza = 6,
): CampiMoto {
  const n = larghezza * altezza;
  return {
    tipo: "corrente",
    u: new Float32Array(n).fill(est),
    v: new Float32Array(n).fill(nord),
    larghezza, altezza, risoluzioneM: 1200, yMax: 5_500_000,
  };
}

describe("il moto della corrente", () => {
  it("va dove l'acqua va, senza mezzo giro", () => {
    // Al contrario di Dwave, che dichiara la direzione **da cui** l'onda viene,
    // ubar e vbar sono componenti della velocita': dicono gia' dove l'acqua va.
    // Girarle di mezzo giro qui sarebbe la cosa piu' dannosa che questa mappa
    // possa fare a chi la usa per uscire in barca.
    const versoEst = velocitaInCelle(correnteUniforme(0.5, 0), 4, 3)!;
    expect(versoEst.di).toBeGreaterThan(0);
    expect(Math.abs(versoEst.dj)).toBeLessThan(1e-9);

    // Il nord e' j che CALA, come per l'onda: la riga 0 e' quella a nord.
    const versoNord = velocitaInCelle(correnteUniforme(0, 0.5), 4, 3)!;
    expect(versoNord.dj).toBeLessThan(0);
    expect(Math.abs(versoNord.di)).toBeLessThan(1e-9);
  });

  it("la velocita' **e'** il modulo, non viene da una formula", () => {
    // Per l'onda la velocita' si ricava da c = g T / 2 pi perche' il dato da' il
    // periodo e non la celerita'. Qui il dato E' la velocita': inventarla
    // mostrerebbe velocita' relative false, cioe' un gradiente che non c'e'.
    const lento = velocitaInCelle(correnteUniforme(0.1, 0), 4, 3)!;
    const veloce = velocitaInCelle(correnteUniforme(0.4, 0), 4, 3)!;
    expect(veloce.di / lento.di).toBeCloseTo(4, 6);
  });

  it("corregge la deformazione di Mercatore, come per l'onda", () => {
    // Un metro di mappa vale cos(latitudine) metri di mare: senza correzione la
    // stessa corrente correrebbe piu' veloce a nord che a sud, cioe'
    // l'animazione mostrerebbe un gradiente che nel mare non c'e'.
    const c = correnteUniforme(0.5, 0);
    const sud = velocitaInCelle(c, 4, 0)!;
    const nord = velocitaInCelle(c, 4, 5)!;
    expect(Math.abs(nord.di)).not.toBeCloseTo(Math.abs(sud.di), 9);
  });

  it("dove il dato non c'e' non inventa una rotta", () => {
    const senza = correnteUniforme(0.5, 0);
    (senza as { u: Float32Array }).u[3 * 8 + 4] = NaN;
    expect(velocitaInCelle(senza, 4, 3)).toBeNull();
    expect(velocitaInCelle(correnteUniforme(0.5, 0), -1, 3)).toBeNull();
    expect(velocitaInCelle(correnteUniforme(0, 0), 4, 3)).toBeNull();
  });

  it("la cresta funziona anche su una corrente, che e' geometria e non fisica", () => {
    // `cresta` prende il verso da `velocitaInCelle`, quindi non deve sapere da
    // che sorgente arriva. Il disegno a scia o a cresta lo decide il livello.
    const punti = cresta(correnteUniforme(0.5, 0), 4, 3, 2, 0.3)!;
    expect(punti).toHaveLength(10);
  });
});

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
    (c as { sin: Float32Array; cos: Float32Array }).sin[0] = NaN;
    (c as { sin: Float32Array; cos: Float32Array }).cos[0] = NaN;
    expect(velocitaInCelle(c, 0, 0)).toBeNull();
    expect(velocitaInCelle(campi(180), -1, 3)).toBeNull();
    expect(velocitaInCelle(campi(180), 99, 3)).toBeNull();
  });

  it("scarta un seno e coseno che non stanno su un cerchio unitario", () => {
    // Succede dove l'interpolazione fra due ore ha mescolato una cella con dato
    // e una senza: il risultato non e' una direzione, e' una media di niente.
    const c = campi(180);
    (c as { sin: Float32Array; cos: Float32Array }).sin[0] = 0.1;
    (c as { sin: Float32Array; cos: Float32Array }).cos[0] = 0.1;
    expect(velocitaInCelle(c, 0, 0)).toBeNull();
  });

  it("una particella su un buco rinasce, non resta ferma", () => {
    // Una particella immobile disegna un punto fisso, che si legge come "qui il
    // mare sta fermo" invece che come "qui non so".
    const c = campi(180);
    (c as { sin: Float32Array; cos: Float32Array }).sin.fill(NaN);
    (c as { sin: Float32Array; cos: Float32Array }).cos.fill(NaN);
    const p: Particella[] = [{ i: 4, j: 3, vita: 100 }];
    let n = 0;
    avanza(p, c, 1, () => ((n = (n + 0.37) % 1), n), 50);
    expect(p[0].i === 4 && p[0].j === 3).toBe(false);
  });

  it("una particella che ha esaurito la vita rinasce anche se il campo c'e'", () => {
    // Senza ricambio le particelle si accumulano dove il campo converge e le
    // zone di uscita restano vuote: la densita' racconterebbe da quanto tempo
    // guardi, non com'e' il mare.
    const p: Particella[] = [{ i: 4, j: 3, vita: 0 }];
    // 0,9 e non 0,5: con 0,5 nasci() cade su (4, 3), cioe' esattamente dov'era,
    // e il test sarebbe verde anche se la particella non fosse rinata affatto.
    avanza(p, campi(180), 1, () => 0.9, 50);
    expect(p[0].vita).toBeGreaterThan(0);
    expect(p[0].i === 4 && p[0].j === 3).toBe(false);
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

describe("la cresta, che e' la forma in cui un'onda si disegna", () => {
  // Un punto che striscia e' l'idioma del vento, e li' e' giusto: l'aria
  // percorre davvero quella traiettoria. In un'onda no: l'acqua non viaggia,
  // viaggia la cresta, e la cresta e' una linea **trasversale** al moto. La
  // geometria sta qui e non nel disegno per la stessa ragione delle altre tre
  // cose di questo file: dentro un contesto grafico produrrebbe un'animazione
  // bellissima e falsa senza che nessun test se ne accorga.

  /** Il verso di propagazione, normalizzato, come lo vede la griglia. */
  function verso(gradiDaCui: number): { ui: number; uj: number } {
    const v = velocitaInCelle(campi(gradiDaCui), 4, 3)!;
    const m = Math.hypot(v.di, v.dj);
    return { ui: v.di / m, uj: v.dj / m };
  }

  it("la corda e' perpendicolare al verso in cui l'onda va", () => {
    // E' la proprieta' che distingue una cresta da una scia: se fosse parallela
    // avremmo disegnato di nuovo il vento, con piu' codice.
    for (const gradi of [0, 45, 90, 137, 180, 250, 315]) {
      const punti = cresta(campi(gradi), 4, 3, 2, 0.3)!;
      const { ui, uj } = verso(gradi);
      const cordaI = punti[punti.length - 2] - punti[0];
      const cordaJ = punti[punti.length - 1] - punti[1];
      expect(cordaI * ui + cordaJ * uj, `${gradi} gradi`).toBeCloseTo(0, 9);
    }
  });

  it("la corda e' lunga quanto le e' stato chiesto", () => {
    // Il disegno converte pixel in celle e passa la semilunghezza: se questa
    // non fosse rispettata, le creste cambierebbero taglia con lo zoom senza
    // che nessuno lo veda arrivare.
    const punti = cresta(campi(137), 4, 3, 2.5, 0.3)!;
    const lunghezza = Math.hypot(
      punti[punti.length - 2] - punti[0], punti[punti.length - 1] - punti[1],
    );
    expect(lunghezza).toBeCloseTo(5, 9);
  });

  it("la bombatura punta avanti, che e' cio' che porta il verso a tempo fermo", () => {
    // Senza la scia che sbiadisce, una cresta simmetrica non dice piu' da che
    // parte va: la convessita' e' l'unica cosa che lo dice anche su un
    // fotogramma fermo. Non e' fisica, e' resa.
    const punti = cresta(campi(180), 4, 3, 2, 0.3)!;
    const { ui, uj } = verso(180);
    const mezzo = (punti.length / 2 - 1) / 2 * 2;
    const centroI = (punti[0] + punti[punti.length - 2]) / 2;
    const centroJ = (punti[1] + punti[punti.length - 1]) / 2;
    expect((punti[mezzo] - centroI) * ui + (punti[mezzo + 1] - centroJ) * uj)
      .toBeGreaterThan(0);
  });

  it("due direzioni opposte danno la stessa corda e la bombatura da parti opposte", () => {
    // La corda **deve** coincidere: una cresta perpendicolare al moto e' la
    // stessa linea sia che l'onda vada a nord sia che vada a sud. Quello che
    // cambia e' da che parte gonfia, ed e' per questo che la bombatura esiste.
    const a = cresta(campi(0), 4, 3, 2, 0.3)!;
    const b = cresta(campi(180), 4, 3, 2, 0.3)!;
    const mezzo = (a.length / 2 - 1) / 2 * 2;
    const centro = (p: number[], k: number) => (p[k] + p[p.length - 2 + k]) / 2;
    expect(centro(a, 0)).toBeCloseTo(centro(b, 0), 9);
    expect(centro(a, 1)).toBeCloseTo(centro(b, 1), 9);
    // gonfiano in j da parti opposte rispetto al centro
    const gonfioA = a[mezzo + 1] - centro(a, 1);
    const gonfioB = b[mezzo + 1] - centro(b, 1);
    expect(Math.sign(gonfioA)).toBe(-Math.sign(gonfioB));
    expect(Math.abs(gonfioA)).toBeCloseTo(Math.abs(gonfioB), 9);
  });

  it("i capi sono simmetrici rispetto alla particella", () => {
    const punti = cresta(campi(45), 4, 3, 2, 0.3)!;
    expect((punti[0] + punti[punti.length - 2]) / 2).toBeCloseTo(4, 9);
    expect((punti[1] + punti[punti.length - 1]) / 2).toBeCloseTo(3, 9);
  });

  it("una bombatura nulla da' un segmento retto, non un caso speciale", () => {
    const punti = cresta(campi(90), 4, 3, 2, 0)!;
    const { ui, uj } = verso(90);
    for (let k = 0; k < punti.length; k += 2) {
      // ogni punto sta sulla retta per la particella perpendicolare al verso
      expect((punti[k] - 4) * ui + (punti[k + 1] - 3) * uj).toBeCloseTo(0, 9);
    }
  });

  it("dove il dato non c'e' non disegna una cresta inventata", () => {
    // Stessa regola per cui una particella su un buco rinasce invece di restare
    // ferma: un arco su una cella senza dato afferma una direzione che non c'e'.
    const senza = campi(180);
    (senza as { sin: Float32Array }).sin[3 * 8 + 4] = NaN;
    expect(cresta(senza, 4, 3, 2, 0.3)).toBeNull();
    expect(cresta(campi(180), -1, 3, 2, 0.3)).toBeNull();
    expect(cresta(campi(180), 99, 3, 2, 0.3)).toBeNull();
  });
});
