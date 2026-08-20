import { describe, expect, it } from "vitest";
import type { Variabile } from "../../src/data/catalogo";
import { grandezzeDi } from "../../src/ui/grandezze";

const campo = (id: string, unita: string): Variabile => ({
  id, unita, scala: 1, offset: 0, colormap: "deep",
  tipi: { an: { mesi: [] }, fc: { mesi: [] } },
});

/** I sette campi che il catalogo pubblica davvero, nel loro ordine. */
const CATALOGO = [
  campo("hwave", "m"), campo("pwave", "s"),
  campo("dwave_sin", "1"), campo("dwave_cos", "1"),
  campo("ubar", "m s-1"), campo("vbar", "m s-1"),
  campo("sealevel", "m"),
];

describe("le grandezze da mettere in un menu", () => {
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
