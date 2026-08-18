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

  it("prendi() sfratta il frame corrente, ha() sfratta il lontano", async () => {
    // Test che discrimina fra ha() e prendi() verificando quale frame viene
    // sfrattato quando la cache si riempie. La chiave è che il controllo di
    // esistenza (prendi o ha) è SINCRONO, quindi se tutti i frame della finestra
    // sono gia' in cache, non c'e' parallelismo e l'ordine di recenza dopo
    // assicura e' completamente deterministico.
    //
    // Ricetta: cache che tiene esattamente 4 frame, riempi in ordine inverso
    // rispetto a quello in cui la finestra li tocchera', poi assicura che tocca
    // solo frame presenti (determinismo garantito), poi forza uno sfratto e
    // verifica quale frame viene sacrificato.

    const cache = new CacheFrame(80); // esattamente 4 frame: 4 * 20 byte
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, carica, 3);

    // Riempi cache in ordine **inverso** rispetto a quello che assicura tocchera':
    // metti asse[3], asse[2], asse[1], asse[0] in questo ordine.
    // Ordine di recenza iniziale: 3 (meno recente), 2, 1, 0 (piu' recente).
    cache.metti(p.chiave(asse[3]), new Int16Array(10));
    cache.metti(p.chiave(asse[2]), new Int16Array(10));
    cache.metti(p.chiave(asse[1]), new Int16Array(10));
    cache.metti(p.chiave(asse[0]), new Int16Array(10));
    expect(cache.quanti).toBe(4);
    expect(carica).toHaveBeenCalledTimes(0); // nessun caricamento

    // Chiama assicura(asse, 0, 1) con avanti=3: tocca asse[0], asse[1], asse[2], asse[3]
    // Tutti sono gia' presenti, quindi nessun caricamento, nessun parallelismo.
    // Con prendi(): ogni controllo sposta in coda
    //   - Tocca 0: cache [3, 2, 1, 0]
    //   - Tocca 1: cache [3, 2, 0, 1]
    //   - Tocca 2: cache [3, 0, 1, 2]
    //   - Tocca 3: cache [0, 1, 2, 3]  --> 0 e' il piu' vecchio (il CORRENTE!)
    // Con ha(): niente si tocca
    //   - Cache rimane [3, 2, 1, 0] --> 3 e' il piu' vecchio (il LONTANO)
    await p.assicura(asse, 0, 1);
    expect(carica).toHaveBeenCalledTimes(0); // ancora nessun caricamento

    // Forza uno sfratto aggiungendo un quinto frame:
    // la cache ha 4 frame (80 bytes), aggiungiamo 1 (20 bytes) = 100 > 80,
    // quindi sfratta il piu' vecchio.
    // Con prendi(): sfratta asse[0] (il corrente, che e' diventato piu' vecchio)
    // Con ha(): sfratta asse[3] (il lontano, che rimane piu' vecchio)
    cache.metti("frame-nuovo", new Int16Array(10));

    // Verifica quale frame e' stato sfrattato:
    // Con ha(): asse[0] deve essere ancora in cache (il piu' recente fra quelli rimasti)
    // Con prendi(): asse[0] dovrebbe essere stato sfrattato (il piu' vecchio)
    expect(p.pronto(asse[0])).toBe(true);
    expect(p.pronto(asse[3])).toBe(false); // asse[3] e' stato sfrattato con ha()
  });
});
