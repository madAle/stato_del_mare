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
    expect(scriviValoreEStato(0.42, "m", "hwave")).toBe("0,40 m · poco mosso");
    expect(scriviValoreEStato(0.68, "m", "hwave")).toBe("0,70 m · mosso");
  });

  it("ma non alle altre grandezze, che gradi di Douglas non ne hanno", () => {
    // Un periodo di 4,2 secondi non e' "poco mosso": sarebbe una cosa falsa
    // scritta accanto a un numero vero.
    expect(scriviValoreEStato(4.2, "s", "pwave")).toBe("4,0 s");
    expect(scriviValoreEStato(180, "gradi", "dwave")).toBe("180,00 gradi");
  });

  it("senza dato non scrive niente, nemmeno lo stato", () => {
    expect(scriviValoreEStato(null, "m", "hwave")).toBe("");
    expect(scriviValore(null, "m", 0.05)).toBe("");
  });
});

describe("l'arrotondamento dei valori a schermo", () => {
  // Chiesto il 2026-08-21: due decimali sono una precisione che il dato non ha.
  // Il passo di ogni grandezza sta in ui/grandezze.ts, con le altre scelte di
  // resa, e da la' viene anche il numero di decimali: scrivere "4,50 s" con un
  // passo di mezzo secondo prometterebbe centesimi che non possono comparire.

  it("l'altezza d'onda si scrive a cinque centimetri", () => {
    expect(scriviValore(0.4749, "m", 0.05)).toBe("0,45 m");
    expect(scriviValore(0.475, "m", 0.05)).toBe("0,50 m");
    expect(scriviValore(0.62, "m", 0.05)).toBe("0,60 m");
    // Il caso che la formula ingenua (v * 100 / 5) sbaglia per polvere in
    // virgola mobile: 8.325 * 100 / 5 vale 166,4999... e uscirebbe 8,30.
    expect(scriviValore(8.325, "m", 0.05)).toBe("8,35 m");
    // 1,25 e' il confine fra "mosso" e "molto mosso": arrotondato deve restare
    // se stesso, non 1.2500000000000002, se no il nome lo si calcola su un
    // numero che non e' quello scritto.
    expect(scriviValore(1.25, "m", 0.05)).toBe("1,25 m");
  });

  it("il periodo si scrive al mezzo secondo, e con un decimale solo", () => {
    expect(scriviValore(4.2, "s", 0.5)).toBe("4,0 s");
    expect(scriviValore(4.47, "s", 0.5)).toBe("4,5 s");
    expect(scriviValore(7.37, "s", 0.5)).toBe("7,5 s");
  });

  it("il nome del grado si calcola sul valore arrotondato, non su quello grezzo", () => {
    // E' l'invariante che tiene insieme le due meta' della scritta: se il nome
    // venisse dal valore grezzo, un vero 0,49 si leggerebbe "0,50 m · poco
    // mosso", cioe' un numero che dice "mosso" accanto a un nome che lo nega.
    // Una contraddizione a schermo si **vede**, e questa e' la ragione per cui
    // i cinque centimetri sono stati preferiti al decimo di metro.
    expect(scriviValoreEStato(0.49, "m", "hwave")).toBe("0,50 m · mosso");
    expect(scriviValoreEStato(0.4749, "m", "hwave")).toBe("0,45 m · poco mosso");
  });

  it("e non si contraddicono in nessun punto della scala", () => {
    // Il numero a schermo, riletto, deve dare esattamente il nome a schermo.
    // Vale perche' ogni confine Douglas e' multiplo di 5 cm: col decimo di
    // metro 1,25 non lo era e questo test troverebbe la contraddizione.
    for (let cm = 0; cm <= 1600; cm++) {
      const scritta = scriviValoreEStato(cm / 100, "m", "hwave");
      const [numero, nome] = scritta.split(" · ");
      const riletto = Number(numero.replace(" m", "").replace(",", "."));
      expect(statoDelMare(riletto), `${cm} cm si legge "${scritta}"`).toBe(nome);
    }
  });

  it("i confini Douglas sopravvivono all'arrotondamento", () => {
    // La proprieta' su cui poggia il test qui sopra, scritta a parte perche' e'
    // lei che va guardata il giorno in cui qualcuno cambia una soglia.
    for (const s of SOGLIE) {
      expect(scriviValore(s.valore, "m", 0.05)).toBe(`${s.valore.toFixed(2).replace(".", ",")} m`);
    }
  });

  it("il periodo perde cinque livelli su diciassette, ed e' il prezzo", () => {
    // Misurato: i valori possibili sono i 17 della griglia delle frequenze di
    // SWAN, e al mezzo secondo diventano 12. Nella parte bassa della scala,
    // dove sta il mare d'agosto, due stati diversi mostrano lo stesso numero.
    // Non e' un errore, e' il costo della decisione: sta scritto qui perche'
    // chi cambiera' il passo sappia cosa sta comprando.
    const SWAN = [1, 1.13, 1.28, 1.45, 1.65, 1.87, 2.11, 2.4, 2.71, 3.08,
                  3.48, 3.95, 4.47, 5.07, 5.74, 6.5, 7.37];
    const scritti = new Set(SWAN.map((v) => scriviValore(v, "s", 0.5)));
    expect(scritti.size).toBe(12);
  });

  it("le grandezze senza passo restano come sono, a due decimali", () => {
    // Il livello del mare non e' stato chiesto, e un campo che il catalogo
    // pubblica e la tabella non conosce non ha nessun passo da applicargli.
    expect(scriviValoreEStato(-0.6543, "m", "sealevel")).toBe("-0,65 m");
    expect(scriviValore(0.4749, "m", 0)).toBe("0,47 m");
  });
});
