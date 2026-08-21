import { describe, expect, it } from "vitest";
import type { Griglia } from "../src/data/catalogo";
import { NODATA } from "../src/data/frame";
import type { Ora } from "../src/data/indice";
import { valoreCorrente } from "../src/map/proiezione";

/**
 * Il numero sotto il cursore deve appartenere all'istante che la mappa sta
 * disegnando.
 *
 * La mappa fonde due ore con una frazione continua (vedi lo shader), quindi a
 * meta' fra le 09:00 e le 10:00 mostra la meta' esatta fra i due campi. Il
 * numero, che sta accanto all'ora scritta a schermo, deve dire la stessa cosa:
 * se prendesse solo l'ora precedente, il pannello affermerebbe un istante e
 * mostrerebbe il valore di un altro.
 */
const GRIGLIA: Griglia = {
  larghezza: 858, altezza: 844, risoluzioneM: 1200,
  boundsLonLat: {
    ovest: 10.843700499983923, sud: 39.75586866390025,
    est: 20.092754665278516, nord: 46.39161194148169,
  },
};

const ORE: Ora[] = [
  { istante: Date.UTC(2026, 7, 16, 9), tipo: "an", riferimento: "20260817" },
  { istante: Date.UTC(2026, 7, 16, 10), tipo: "an", riferimento: "20260817" },
];

/** Due frame costanti, cosi' il punto scelto non conta. */
function frameCostante(valore: number): Int16Array {
  return new Int16Array(858 * 844).fill(valore);
}

const LON = 12.9;
const LAT = 44.2;

function leggi(
  istante: number, a: Int16Array, b: Int16Array, dissolvenza = true,
): number | null {
  const frame = new Map<number, Int16Array>([[ORE[0].istante, a], [ORE[1].istante, b]]);
  return valoreCorrente(
    GRIGLIA, ORE, istante, (ora) => frame.get(ora.istante),
    LON, LAT, 0.001, 0, dissolvenza,
  );
}

describe("valore sotto il cursore", () => {
  it("su un'ora esatta vale quell'ora", () => {
    expect(leggi(ORE[0].istante, frameCostante(1000), frameCostante(3000))).toBeCloseTo(1.0, 6);
  });

  it("a meta' fra due ore vale la meta', come il campo disegnato", () => {
    expect(leggi(ORE[0].istante + 1_800_000, frameCostante(1000), frameCostante(3000)))
      .toBeCloseTo(2.0, 6);
  });

  it("a tre quarti pesa di piu' l'ora dopo", () => {
    expect(leggi(ORE[0].istante + 2_700_000, frameCostante(1000), frameCostante(3000)))
      .toBeCloseTo(2.5, 6);
  });

  it("se l'ora dopo non ha dato in quel punto, si usa quella prima invece di mediare con niente", () => {
    // stessa regola dello shader: fondere con un nodata farebbe sprofondare
    // l'onda a ogni ora, che sarebbe un'oscillazione inventata
    expect(leggi(ORE[0].istante + 1_800_000, frameCostante(1000), frameCostante(NODATA)))
      .toBeCloseTo(1.0, 6);
  });

  it("se nessuna delle due ha dato, non c'e' valore", () => {
    expect(leggi(ORE[0].istante + 1_800_000, frameCostante(NODATA), frameCostante(NODATA)))
      .toBeNull();
  });
});

describe("valore sotto il cursore, per le grandezze che non si dissolvono", () => {
  // Il periodo dell'onda prende i 17 valori della griglia delle frequenze di
  // SWAN e non si interpola: fondere 3,48 con 3,95 darebbe 3,71 s, che il
  // modello non produce. La regola sta in `oraPiuVicina`, che ha i suoi test,
  // ma il ramo di `valoreCorrente` che la chiama non era provato da nessuno:
  // lo copriva solo un test end to end, che dal 2026-08-21 e' cieco, perche'
  // il periodo si scrive al mezzo secondo e un valore interpolato arrotondato
  // cade sullo stesso numero di quello vero. Qui non c'e' arrotondamento in
  // mezzo, quindi la differenza si vede: 1 e 3 danno 3, non 2.
  it("a meta' fra due ore vale l'ora dopo, non la media", () => {
    expect(leggi(ORE[0].istante + 1_800_000, frameCostante(1000), frameCostante(3000), false))
      .toBeCloseTo(3.0, 6);
  });

  it("appena prima della meta' vale ancora l'ora prima", () => {
    expect(leggi(ORE[0].istante + 1_799_000, frameCostante(1000), frameCostante(3000), false))
      .toBeCloseTo(1.0, 6);
  });
});
