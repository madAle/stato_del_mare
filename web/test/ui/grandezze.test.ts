import { describe, expect, it } from "vitest";
import type { Variabile } from "../../src/data/catalogo";
import { grandezzeDi, scaleCoerenti } from "../../src/ui/grandezze";

/**
 * Scala di default 1: fedele al catalogo solo per i campi a cui non importa
 * (le altre asserzioni guardano id e unita', non la scala). Dove la scala
 * conta davvero (ubar/vbar, sotto) si passa quella vera.
 */
const campo = (id: string, unita: string, scala = 1): Variabile => ({
  id, unita, scala, offset: 0, colormap: "deep",
  tipi: { an: { mesi: [] }, fc: { mesi: [] } },
});

/**
 * I sette campi che il catalogo pubblica davvero, nel loro ordine, con le
 * scale vere di ubar e vbar (0,001, verificato nel catalogo il 2026-08-21):
 * un test sulla coerenza delle due scale non direbbe niente su una fabbrica
 * che le inventa uguali per comodo.
 */
const CATALOGO = [
  campo("hwave", "m"), campo("pwave", "s"),
  campo("dwave_sin", "1"), campo("dwave_cos", "1"),
  campo("ubar", "m s-1", 0.001), campo("vbar", "m s-1", 0.001),
  campo("sealevel", "m"),
];

describe("le grandezze da mettere in un menu", () => {
  it("una sola ha un comando suo, e non e' 'disegnabile' con un altro nome", () => {
    // `disegnabile` vuol dire "la mappa la sa disegnare **come campo
    // selezionato**", e per la direzione resta falso: le creste sono una
    // sovrapposizione sopra un altro campo, non un campo. E' anche cio' che fa
    // ricadere `?var=dwave` sull'altezza d'onda invece di lasciare la legenda
    // su un'unita' e la mappa su un'altra.
    //
    // `comandoSuo` dice un'altra cosa: "si raggiunge da un comando proprio,
    // quindi nel selettore non ci va". Tenerli separati e' il punto: la
    // corrente non si disegna e **resta** nel menu, perche' senza di esso non
    // avrebbe nessun modo di comparire.
    const g = grandezzeDi(CATALOGO);
    expect(g.filter((x) => x.comandoSuo).map((x) => x.id)).toEqual(["dwave"]);
    expect(g.find((x) => x.id === "corrente")!.disegnabile).toBe(false);
    expect(g.find((x) => x.id === "corrente")!.comandoSuo).toBe(false);
  });

  it("uniscono le componenti in una voce sola", () => {
    // Nessuno vuole vedere il seno di una direzione: le componenti esistono
    // perche' un angolo non si interpola, che e' una scelta di archiviazione.
    const g = grandezzeDi(CATALOGO);
    expect(g.map((x) => x.id)).toEqual(["hwave", "pwave", "dwave", "corrente", "sealevel"]);
    expect(g.find((x) => x.id === "dwave")!.campi).toEqual(["dwave_sin", "dwave_cos"]);
    expect(g.find((x) => x.id === "corrente")!.campi).toEqual(["ubar", "vbar"]);
  });

  it("danno alla grandezza la sua unita', non quella delle componenti", () => {
    // seno e coseno sono adimensionali: una direzione si legge in gradi
    const g = grandezzeDi(CATALOGO);
    expect(g.find((x) => x.id === "dwave")!.unita).toBe("gradi");
    expect(g.find((x) => x.id === "corrente")!.unita).toBe("m/s");
  });

  it("tengono l'ordine del catalogo, non uno deciso qui", () => {
    const invertito = grandezzeDi([...CATALOGO].reverse());
    expect(invertito.map((x) => x.id)).toEqual(["sealevel", "corrente", "dwave", "pwave", "hwave"]);
  });

  it("un campo sconosciuto compare lo stesso, col suo id", () => {
    // E' la regola che tiene in piedi il principio per cui l'elenco viene dal
    // catalogo: aggiungere una variabile deve costare un run dell'ingestore,
    // non una modifica a questa tabella. Se sparisse, nessuno la cercherebbe,
    // perche' nessuno cerca quello che non sa che c'e'.
    const g = grandezzeDi([...CATALOGO, campo("temperatura", "degC")]);
    const nuova = g.find((x) => x.id === "temperatura")!;
    expect(nuova.nome).toBe("temperatura");
    expect(nuova.unita).toBe("degC");
    expect(nuova.campi).toEqual(["temperatura"]);
  });

  it("una grandezza a cui manca una componente compare con quella che c'e'", () => {
    // Un catalogo a meta' e' un problema di chi la disegnera', non un motivo
    // per nascondere che quel dato esiste.
    const g = grandezzeDi([campo("hwave", "m"), campo("ubar", "m s-1")]);
    expect(g.map((x) => x.id)).toEqual(["hwave", "corrente"]);
    expect(g.find((x) => x.id === "corrente")!.campi).toEqual(["ubar"]);
  });

  it("un catalogo vuoto non produce voci inventate", () => {
    expect(grandezzeDi([])).toEqual([]);
  });
});

describe("il nodo dell'id verso il bucket", () => {
  it("la variabile del catalogo si cerca col **primo campo**, non con l'id della grandezza", () => {
    // E' il vincolo che STATO.md chiamava "da sciogliere prima della corrente":
    // per le grandezze a un campo solo i due id coincidono, per la corrente no,
    // e cercare per id della grandezza darebbe undefined, cioe' l'app ferma sul
    // ramo di caricamento con un catalogo perfetto.
    const g = grandezzeDi(CATALOGO);
    const corrente = g.find((x) => x.id === "corrente")!;
    expect(corrente.id).not.toBe(corrente.campi[0]);
    expect(CATALOGO.some((v) => v.id === corrente.id)).toBe(false);
    expect(CATALOGO.some((v) => v.id === corrente.campi[0])).toBe(true);
  });

  it("le due componenti della corrente hanno la stessa scala, che il modulo grezzo richiede", () => {
    // Lo shader prende il modulo sui valori grezzi e scala dopo: con due scale
    // diverse darebbe una velocita' sbagliata di un fattore, cioe' un numero
    // plausibile e falso. Verificato nel catalogo vero il 2026-08-21 (0,001 e
    // 0,001), fissato qui perche' il giorno che ARPAE ne cambiasse una lo si
    // sappia da un test e non da uno screenshot.
    const g = grandezzeDi(CATALOGO);
    const corrente = g.find((x) => x.id === "corrente")!;
    const scale = corrente.campi.map((c) => CATALOGO.find((v) => v.id === c)!.scala);
    expect(new Set(scale).size).toBe(1);
  });
});

describe("scaleCoerenti", () => {
  it("e' vera per una grandezza a un campo solo: non c'e' una seconda scala da confrontare", () => {
    const g = grandezzeDi(CATALOGO).find((x) => x.id === "hwave")!;
    expect(scaleCoerenti(g, CATALOGO)).toBe(true);
  });

  it("e' vera quando le componenti condividono la scala (il catalogo vero, oggi)", () => {
    const g = grandezzeDi(CATALOGO).find((x) => x.id === "corrente")!;
    expect(scaleCoerenti(g, CATALOGO)).toBe(true);
  });

  it("e' falsa quando le scale divergono: il modulo grezzo le mischierebbe di un fattore", () => {
    // Questo e' il controllo a runtime richiesto in App.tsx (non solo un test
    // sulla fabbrica dei test qui sopra): deve accorgersi di un catalogo VERO
    // che cambia, non solo di un campione che lo simula. Se ARPAE pubblicasse
    // ubar e vbar con scale diverse, un modulo preso sui valori grezzi e
    // scalato con un solo fattore darebbe una velocita' plausibile e falsa:
    // il costo di sbagliare qui e' un numero che sembra una misura e non lo e'.
    const divergente = [
      ...CATALOGO.filter((v) => v.id !== "ubar" && v.id !== "vbar"),
      { ...CATALOGO.find((v) => v.id === "ubar")!, scala: 0.001 },
      { ...CATALOGO.find((v) => v.id === "vbar")!, scala: 0.002 },
    ];
    const g = grandezzeDi(divergente).find((x) => x.id === "corrente")!;
    expect(scaleCoerenti(g, divergente)).toBe(false);
  });
});
