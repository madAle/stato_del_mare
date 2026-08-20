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

  it("l'etichetta della linea dice lo stesso nome del numero sotto il dito", () => {
    // Due formattatori diversi sono il modo in cui la linea e la barra di stato
    // cominciano a contraddirsi: la linea a 0,5 m non puo' dire "mosso" mentre
    // il valore misurato li' sopra dice "poco mosso".
    for (const s of SOGLIE) {
      expect(etichettaSoglia(s.valore)).toContain(statoDelMare(s.valore));
    }
    expect(etichettaSoglia(0.5)).toBe("0,5 m · mosso");
    expect(etichettaSoglia(1.25)).toBe("1,25 m · molto mosso");
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
