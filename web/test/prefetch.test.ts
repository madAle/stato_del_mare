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
});
