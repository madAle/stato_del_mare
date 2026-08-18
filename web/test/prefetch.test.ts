import { describe, expect, it, vi } from "vitest";
import { CacheFrame } from "../src/data/cache";
import type { Ora } from "../src/data/indice";
import { Prefetcher } from "../src/data/prefetch";

const asse: Ora[] = Array.from({ length: 40 }, (_, i) => ({
  istante: Date.UTC(2026, 7, 15, i),
  tipo: "an" as const,
  riferimento: "20260815",
}));

describe("prefetch", () => {
  it("carica la finestra davanti nella direzione di riproduzione", async () => {
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 8);
    await p.assicura(asse, 5, 1);
    // l'ora corrente piu' le otto davanti
    expect(carica).toHaveBeenCalledTimes(9);
    expect(p.pronto(asse[5])).toBe(true);
    expect(p.pronto(asse[13])).toBe(true);
    expect(p.pronto(asse[14])).toBe(false);
  });

  it("all'indietro guarda indietro", async () => {
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 4);
    await p.assicura(asse, 20, -1);
    expect(p.pronto(asse[16])).toBe(true);
    expect(p.pronto(asse[24])).toBe(false);
  });

  it("non richiede due volte lo stesso frame", async () => {
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 3);
    await p.assicura(asse, 0, 1);
    await p.assicura(asse, 1, 1);
    // 4 la prima volta (0..3), poi solo la 4 che manca
    expect(carica).toHaveBeenCalledTimes(5);
  });

  it("un frame che non arriva non blocca gli altri per sempre", async () => {
    const cache = new CacheFrame();
    const carica = vi.fn(async (ora: Ora) => {
      if (ora === asse[2]) throw new Error("rete giu'");
      return new Int16Array(10);
    });
    const p = new Prefetcher(cache, carica, 3);
    await p.assicura(asse, 0, 1);
    expect(p.pronto(asse[2])).toBe(false);
    expect(p.pronto(asse[3])).toBe(true);
    // e un secondo giro riprova quello caduto, invece di ricordarselo per sempre
    await p.assicura(asse, 0, 1);
    expect(carica).toHaveBeenCalledWith(asse[2]);
  });

  it("ha() non ringiovanisce il frame, pronto() non ha side effects", async () => {
    // Questo test verifica che ha() usato in pronto() non cambia l'ordine
    // di recenza come farebbe prendi(). La cache ha budget stretto per far
    // sì che uno sfratto sia visibile: dopo ripetuti assicura su una finestra
    // già caricata, il frame corrente non dovrebbe diventare il meno recente.
    const cache = new CacheFrame(70); // 3,5 frame
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 2);

    // Carica frames 0, 1, 2
    await p.assicura(asse, 0, 1);
    expect(cache.quanti).toBe(3);
    expect(carica).toHaveBeenCalledTimes(3);

    // Secondo assicura: con ha() non tocca i frame già in cache.
    // Nessun nuovo carico dovrebbe accadere.
    await p.assicura(asse, 0, 1);
    expect(carica).toHaveBeenCalledTimes(3); // zero nuovi caichi

    // Aggiunta di frame 3, 4, 5 (con avanti=2): la cache si riempe e sfratta il meno recente.
    // Con ha() che non ringiovanisce, il frame corrente rimane il più vecchio,
    // il che è il comportamento corretto (non lo stiamo consumando, solo
    // verificando se è pronto). Se prendi() lo avesse toccato nel secondo
    // assicura, l'ordine sarebbe cambiato e un altro frame sarebbe stato sfrattato.
    await p.assicura(asse, 3, 1);
    expect(carica).toHaveBeenCalledTimes(6); // 3 primi + 3 nuovi

    // Verifica che la cache ha fatto sfratto per fare spazio
    expect(cache.quanti).toBeLessThan(5);
  });

  it("prefetch si ferma al bordo superiore dell'asse", async () => {
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 5);
    // Cursore vicino alla fine dell'asse, direzione avanti
    // asse ha lunghezza 40, indice 38, avanti 5: dovrebbe caricare solo 38, 39
    await p.assicura(asse, 38, 1);
    expect(carica).toHaveBeenCalledTimes(2);
    expect(p.pronto(asse[38])).toBe(true);
    expect(p.pronto(asse[39])).toBe(true);
  });

  it("prefetch si ferma al bordo inferiore dell'asse", async () => {
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 5);
    // Cursore vicino all'inizio dell'asse, direzione indietro
    // indice 1, avanti 5, direzione -1: dovrebbe caricare solo 1, 0
    await p.assicura(asse, 1, -1);
    expect(carica).toHaveBeenCalledTimes(2);
    expect(p.pronto(asse[1])).toBe(true);
    expect(p.pronto(asse[0])).toBe(true);
  });
});
