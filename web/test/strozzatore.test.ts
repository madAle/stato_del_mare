import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creaStrozzatore } from "../src/map/strozzatore";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("strozzatore", () => {
  it("il primo valore arriva subito", () => {
    const consegnati: number[] = [];
    const s = creaStrozzatore<number>((v) => consegnati.push(v), 100);
    s.invia(1);
    expect(consegnati).toEqual([1]);
  });

  it("dentro la finestra i valori intermedi si perdono, ma l'ultimo arriva sempre alla chiusura", () => {
    const consegnati: number[] = [];
    const s = creaStrozzatore<number>((v) => consegnati.push(v), 100);

    s.invia(1); // consegnato subito
    s.invia(2); // dentro la finestra, va in coda
    s.invia(3); // sostituisce il 2 in coda: se si strozzasse solo in entrata,
                // questo (l'ultima posizione del mouse) non arriverebbe mai
    expect(consegnati).toEqual([1]);

    vi.advanceTimersByTime(100);
    expect(consegnati).toEqual([1, 3]);
  });

  it("dopo la finestra un nuovo invio torna a essere immediato", () => {
    const consegnati: number[] = [];
    const s = creaStrozzatore<number>((v) => consegnati.push(v), 100);
    s.invia(1);
    vi.advanceTimersByTime(150);
    s.invia(2);
    expect(consegnati).toEqual([1, 2]);
  });

  it("distruggi annulla una consegna in coda", () => {
    const consegnati: number[] = [];
    const s = creaStrozzatore<number>((v) => consegnati.push(v), 100);
    s.invia(1);
    s.invia(2); // in coda
    s.distruggi();
    vi.advanceTimersByTime(200);
    expect(consegnati).toEqual([1]);
  });

  it("una raffica fitta (piu' di dieci al secondo) consegna al massimo un valore ogni cento millisecondi", () => {
    const consegnati: number[] = [];
    const s = creaStrozzatore<number>((v) => consegnati.push(v), 100);
    // 50 invii ogni 5 ms, cioe' 200 al secondo: molto piu' fitto del passo,
    // come un mousemove non aggregato su uno schermo ad alto refresh
    for (let i = 0; i < 50; i++) {
      s.invia(i);
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(100);

    // il primo arriva subito, poi una consegna ogni finestra di 100 ms, e
    // l'ultima e' sempre il valore piu' recente, mai uno intermedio
    expect(consegnati).toEqual([0, 19, 39, 49]);
  });
});
