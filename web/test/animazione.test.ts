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

  it("il rapporto strozzato in vaiA arriva comunque, in coda", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, async () => new Int16Array(10), 5);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const riportati: number[] = [];

    const a = new Animazione(livello as never, { asse, prefetcher: p, cache });
    a.alTempo = (istante) => riportati.push(istante);
    a.vaiA(asse[0].istante);
    a.vaiA(asse[1].istante); // seconda chiamata nella stessa finestra di 100 ms

    // senza una coda, questo rapporto si perderebbe per sempre: da fermi non
    // gira nessun ciclo rAF che lo recuperi, e l'etichetta dell'ora resterebbe
    // quella vecchia a tempo indefinito
    expect(riportati).toEqual([]);
    avanza(150);

    expect(riportati).toEqual([asse[1].istante]);
  });

  it("pausa() chiamata da dentro alTempo ferma davvero il ciclo", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, async () => new Int16Array(10), 12);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    let chiamate = 0;

    // passoRapportoMs a zero: ogni rapporto passa subito, cosi' il conteggio
    // misura solo se il ciclo rAF si ferma davvero, senza l'interferenza
    // della coda dei rapporti strozzati.
    const a = new Animazione(livello as never, {
      asse, prefetcher: p, cache, passoRapportoMs: 0,
    });
    // pausa() forza a sua volta un rapporto: senza il controllo sullo stato
    // qui, quel rapporto rientrerebbe in questa stessa funzione all'infinito.
    // Il caso vero che si vuole coprire e' un solo pausa() richiamato da
    // dentro un rapporto di riproduzione in corso, non una chiamata ricorsiva
    // a se stessa.
    a.alTempo = (_i, stato) => {
      chiamate++;
      if (stato === "in riproduzione") a.pausa();
    };
    a.vaiA(asse[0].istante);
    a.impostaVelocita(1);
    a.riproduci();
    avanza(1000);

    // senza la guardia su richiesta, passo() rischedula comunque: in un
    // secondo simulato il ciclo girerebbe circa 60 volte, con pausa()
    // richiamata a ogni giro, anche se il primo pausa() dovrebbe averlo
    // fermato per sempre
    expect(chiamate).toBeLessThanOrEqual(6);
  });

  it("il riavvolgimento controlla la prontezza del fotogramma 0 prima di dichiararsi in riproduzione", async () => {
    const corto: Ora[] = [asse[0], asse[1]];
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, async (ora: Ora) => {
      if (ora.istante === corto[0].istante) throw new Error("fotogramma 0 non disponibile");
      return new Int16Array(10);
    }, 5);
    await p.assicura(corto, 1, 1); // si carica solo l'ultimo fotogramma
    const livello = livelloFinto();
    const stati: string[] = [];

    const a = new Animazione(livello as never, {
      asse: corto, prefetcher: p, cache, passoRapportoMs: 0,
    });
    a.alTempo = (_i, stato) => stati.push(stato);
    a.vaiA(corto[1].istante);
    a.impostaVelocita(1);
    a.riproduci();
    avanza(20);

    expect(stati).toContain("in attesa di dati");
    expect(stati).not.toContain("in riproduzione");
  });
});
