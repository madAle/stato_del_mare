import { beforeEach, describe, expect, it, vi } from "vitest";
import { CacheFrame } from "../src/data/cache";
import type { Ora } from "../src/data/indice";
import { Prefetcher } from "../src/data/prefetch";
import { Animazione } from "../src/map/animazione";

const asse: Ora[] = Array.from({ length: 24 }, (_, i) => ({
  istante: Date.UTC(2026, 7, 15, i),
  tipo: "an" as const,
  riferimento: "20260815",
}));

/** Un finto livello che registra cosa gli e' stato chiesto di disegnare. */
function livelloFinto() {
  const chiamate: { frazione: number; haB: boolean }[] = [];
  return {
    chiamate,
    imposta(_a: Int16Array, b: Int16Array | null, frazione: number) {
      chiamate.push({ frazione, haB: b !== null });
    },
  };
}

let adesso = 0;
let attivita: FrameRequestCallback[] = [];

beforeEach(() => {
  adesso = 0;
  attivita = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    attivita.push(cb);
    return attivita.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => adesso });
});

/** Fa passare il tempo simulando fotogrammi a 60 Hz. */
function avanza(ms: number) {
  const passi = Math.round(ms / 16.67);
  for (let i = 0; i < passi; i++) {
    adesso += 16.67;
    const daEseguire = attivita;
    attivita = [];
    for (const cb of daEseguire) cb(adesso);
  }
}

describe("animazione", () => {
  it("riporta il tempo al massimo dieci volte al secondo", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, async () => new Int16Array(10), 12);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const riportati: number[] = [];

    const a = new Animazione(livello as never, { asse, prefetcher: p, cache });
    a.alTempo = (istante) => riportati.push(istante);
    a.vaiA(asse[0].istante);
    a.impostaVelocita(1);
    a.riproduci();
    avanza(1000);

    // a 60 fotogrammi al secondo il ciclo gira circa 60 volte, ma chi ascolta
    // sente al massimo 10 volte: e' la riga che tiene React fuori dai 60 fps
    expect(riportati.length).toBeLessThanOrEqual(11);
    expect(riportati.length).toBeGreaterThan(5);
    expect(livello.chiamate.length).toBeGreaterThan(30);
  });

  it("si mette in attesa invece di saltare fotogrammi", async () => {
    const cache = new CacheFrame();
    // solo le prime due ore sono caricabili
    const p = new Prefetcher(cache, async (ora: Ora) => {
      if (ora.istante > asse[1].istante) throw new Error("non disponibile");
      return new Int16Array(10);
    }, 2);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const stati: string[] = [];

    const a = new Animazione(livello as never, { asse, prefetcher: p, cache });
    a.alTempo = (_i, stato) => stati.push(stato);
    a.vaiA(asse[0].istante);
    a.impostaVelocita(4);
    a.riproduci();
    avanza(2000);

    // Saltare fotogrammi su un'animazione meteorologica falsa la percezione del
    // fenomeno; una pausa breve si legge per quello che e'.
    expect(stati).toContain("in attesa di dati");
    expect(stati).not.toContain("ferma");
  });

  it("dentro un buco non chiede l'interpolazione", async () => {
    const bucato: Ora[] = [asse[0], asse[1], { ...asse[10] }];
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, async () => new Int16Array(10), 5);
    await p.assicura(bucato, 0, 1);
    const livello = livelloFinto();

    const a = new Animazione(livello as never, { asse: bucato, prefetcher: p, cache });
    a.vaiA(bucato[1].istante + 1_800_000); // mezz'ora dentro il buco
    expect(livello.chiamate.at(-1)).toEqual({ frazione: 0, haB: false });
  });
});
