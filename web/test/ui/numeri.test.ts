import { describe, expect, it } from "vitest";
import { GRADI, SOGLIE, etichettaSoglia, statoDelMare } from "../../src/map/soglie";
import { scriviValore, scriviValoreEStato } from "../../src/ui/numeri";

describe("lo stato del mare secondo Douglas", () => {
  it("il confine appartiene al grado che apre", () => {
    // A 0,50 m esatti il mare e' mosso, non poco mosso: e' la convenzione della
    // scala (0,10-0,50 poi 0,50-1,25) ed e' l'unica coerente con le isolinee,
    // dove la linea a 0,5 m e' il posto dove "mosso" comincia. Sbagliare verso
    // vorrebbe dire che la linea e il numero sotto il dito si contraddicono
    // proprio dove la linea passa.
    expect(statoDelMare(0.5)).toBe("mosso");
    expect(statoDelMare(0.4999)).toBe("poco mosso");
    expect(statoDelMare(0.1)).toBe("poco mosso");
    expect(statoDelMare(0.0999)).toBe("quasi calmo");
    expect(statoDelMare(1.25)).toBe("molto mosso");
  });

  it("copre tutta la scala, dal mare piatto alla tempesta", () => {
    expect(statoDelMare(0)).toBe("quasi calmo");
    expect(statoDelMare(2.5)).toBe("agitato");
    expect(statoDelMare(4)).toBe("molto agitato");
    expect(statoDelMare(6)).toBe("grosso");
    expect(statoDelMare(9)).toBe("molto grosso");
    expect(statoDelMare(14)).toBe("tempestoso");
    expect(statoDelMare(30)).toBe("tempestoso");
  });

  it("ogni isolinea e' un confine fra due gradi, e nessun grado ne resta senza", () => {
    // E' l'invariante della decisione del 2026-08-20: niente linee che non
    // separino due stati con un nome. Se qualcuno rimettesse una soglia
    // intermedia questo test la trova.
    expect(SOGLIE.map((s) => s.valore)).toEqual(GRADI.filter((g) => g.da > 0).map((g) => g.da));
    for (const s of SOGLIE) expect(s.nome).toBe(true);
  });

  it("sulla linea va solo l'altezza: il nome del grado sta accanto al valore misurato", () => {
    // La corsa lungo una curva e' il posto piu' stretto dell'interfaccia: una
    // etichetta lunga il triplo si scavalla con la vicina o non compare
    // affatto. Il nome sta dove c'e' spazio per dirlo.
    expect(etichettaSoglia(0.5)).toBe("0,5 m");
    expect(etichettaSoglia(1.25)).toBe("1,25 m");
    for (const s of SOGLIE) expect(etichettaSoglia(s.valore)).not.toContain(statoDelMare(s.valore));
  });

  it("ma il valore misurato **sulla** linea dice il grado che quella linea apre", () => {
    // E' l'aggancio fra i due: chi appoggia il dito sulla linea da 0,5 m legge
    // "mosso", cioe' il grado che quella linea comincia. Se il confine
    // appartenesse al grado che chiude, la linea e il dito direbbero cose
    // diverse nello stesso punto.
    for (const s of SOGLIE) {
      expect(scriviValoreEStato(s.valore, "m", "hwave")).toContain(statoDelMare(s.valore));
    }
    expect(scriviValoreEStato(0.5, "m", "hwave")).toBe("0,50 m · mosso");
  });
});

describe("il valore scritto a schermo", () => {
  it("porta lo stato del mare accanto all'altezza d'onda", () => {
    expect(scriviValoreEStato(0.42, "m", "hwave")).toBe("0,42 m · poco mosso");
    expect(scriviValoreEStato(0.68, "m", "hwave")).toBe("0,68 m · mosso");
  });

  it("ma non alle altre grandezze, che gradi di Douglas non ne hanno", () => {
    // Un periodo di 4,2 secondi non e' "poco mosso": sarebbe una cosa falsa
    // scritta accanto a un numero vero.
    expect(scriviValoreEStato(4.2, "s", "tpeak")).toBe("4,20 s");
    expect(scriviValoreEStato(180, "gradi", "dirwave")).toBe("180,00 gradi");
  });

  it("senza dato non scrive niente, nemmeno lo stato", () => {
    expect(scriviValoreEStato(null, "m", "hwave")).toBe("");
    expect(scriviValore(null, "m")).toBe("");
  });
});
