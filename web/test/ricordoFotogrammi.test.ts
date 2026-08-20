import { describe, expect, it } from "vitest";
import { Ricordo } from "../src/map/ricordoFotogrammi";

const dati = (n: number) => Int16Array.from([n]);

describe("il ricordo dei fotogrammi", () => {
  it("dice quali fotogrammi butta via, invece di lasciarlo scoprire fallendo", () => {
    // E' la meta' che mancava: il thread principale teneva un elenco di cosa il
    // worker conosce e non lo sfoltiva mai, quindi dopo un po' di scorrimento
    // ogni richiesta tornava "manca" e le isolinee smettevano di aggiornarsi.
    const r = new Ricordo(2);
    expect(r.metti("a", dati(1))).toEqual([]);
    expect(r.metti("b", dati(2))).toEqual([]);
    expect(r.metti("c", dati(3))).toEqual(["a"]);
    expect(r.prendi("a")).toBeNull();
  });

  it("usare un fotogramma lo rende recente, se no si sfratta quello a schermo", () => {
    // Le due ore che si stanno guardando restano ferme mentre attorno scorrono
    // le altre: senza questa regola sarebbero le prime a essere buttate.
    const r = new Ricordo(2);
    r.metti("a", dati(1));
    r.metti("b", dati(2));
    expect(r.prendi("a")).not.toBeNull();   // "a" torna la piu' recente
    expect(r.metti("c", dati(3))).toEqual(["b"]);
    expect(r.prendi("a")).not.toBeNull();
  });

  it("rimettere lo stesso fotogramma non ne butta un altro", () => {
    const r = new Ricordo(2);
    r.metti("a", dati(1));
    r.metti("b", dati(2));
    expect(r.metti("a", dati(9))).toEqual([]);
    expect(r.quanti).toBe(2);
    expect(Array.from(r.prendi("a")!)).toEqual([9]);
  });

  it("svuotare butta tutto", () => {
    const r = new Ricordo(4);
    r.metti("a", dati(1));
    r.svuota();
    expect(r.quanti).toBe(0);
  });
});
