import { describe, expect, it } from "vitest";
import { attendiCaricamento, primoLivelloSimboli, ZOOM_MASSIMO } from "../src/map/mappa";

/**
 * Un emettitore finto con solo "once" e "off": basta a esercitare
 * attendiCaricamento senza una mappa vera, che richiederebbe un
 * WebGLRenderingContext.
 */
function creaEmettitoreFinto() {
  // Il tipo dell'ascoltatore e' "any" apposta: attendiCaricamento lo chiama
  // con un ErrorEvent vero, questo finto lo tratta come un contenitore
  // generico, e alla firma di EmettitoreCiclo interessa solo che once/off
  // accettino "load" o "error", non la varianza esatta del payload.
  const ascoltatori = new Map<string, ((evento?: any) => void)[]>();
  return {
    once(tipo: string, ascoltatore: (evento?: any) => void) {
      const lista = ascoltatori.get(tipo) ?? [];
      lista.push(ascoltatore);
      ascoltatori.set(tipo, lista);
    },
    off(tipo: string, ascoltatore: (evento?: any) => void) {
      const lista = ascoltatori.get(tipo) ?? [];
      ascoltatori.set(
        tipo,
        lista.filter((f) => f !== ascoltatore),
      );
    },
    emetti(tipo: string, evento?: unknown) {
      // "once" vero: gli ascoltatori si consumano all'emissione, come in
      // MapLibre, altrimenti il conteggio dopo la vittoria di un evento
      // include ancora l'ascoltatore che ha appena sparato.
      const lista = ascoltatori.get(tipo) ?? [];
      ascoltatori.set(tipo, []);
      for (const f of lista) f(evento);
    },
    contaAscoltatori(tipo: string) {
      return (ascoltatori.get(tipo) ?? []).length;
    },
  };
}

describe("ordine dei livelli", () => {
  it("il campo va prima del primo livello di simboli", () => {
    const stile = {
      layers: [
        { id: "sfondo", type: "background" },
        { id: "acqua", type: "fill" },
        { id: "strade", type: "line" },
        { id: "etichette_luoghi", type: "symbol" },
        { id: "etichette_strade", type: "symbol" },
      ],
    };
    expect(primoLivelloSimboli(stile)).toBe("etichette_luoghi");
  });

  it("uno stile senza simboli non fa saltare niente", () => {
    // in quel caso il campo va in cima, che e' il comportamento predefinito di
    // addLayer senza beforeId
    expect(primoLivelloSimboli({ layers: [{ id: "sfondo", type: "background" }] }))
      .toBeUndefined();
  });
});

describe("tetto di zoom", () => {
  it("e' 15, dove una cella del modello vale 353 pixel", () => {
    expect(ZOOM_MASSIMO).toBe(15);
  });
});

describe("attendiCaricamento", () => {
  it("risolve quando arriva load", async () => {
    const finto = creaEmettitoreFinto();
    const attesa = attendiCaricamento(finto);
    finto.emetti("load");
    await expect(attesa).resolves.toBeUndefined();
  });

  it("rifiuta quando arriva error, invece di restare sospesa per sempre", async () => {
    const finto = creaEmettitoreFinto();
    const attesa = attendiCaricamento(finto);
    finto.emetti("error", { error: new Error("stile non raggiungibile: HTTP 404") });
    await expect(attesa).rejects.toThrow(/basemap non e' ancora pubblicata/);
    await expect(attesa).rejects.toThrow(/stile non raggiungibile: HTTP 404/);
  });

  it("rifiuta con un messaggio leggibile anche senza un errore originale", async () => {
    const finto = creaEmettitoreFinto();
    const attesa = attendiCaricamento(finto);
    finto.emetti("error");
    await expect(attesa).rejects.toThrow(/caricamento dello stile/);
  });

  it("non lascia ascoltatori appesi dopo che load ha vinto", async () => {
    const finto = creaEmettitoreFinto();
    const attesa = attendiCaricamento(finto);
    finto.emetti("load");
    await attesa;
    expect(finto.contaAscoltatori("load")).toBe(0);
    expect(finto.contaAscoltatori("error")).toBe(0);
  });

  it("non lascia ascoltatori appesi dopo che error ha vinto", async () => {
    const finto = creaEmettitoreFinto();
    const attesa = attendiCaricamento(finto);
    finto.emetti("error", { error: new Error("boom") });
    await attesa.catch(() => {});
    expect(finto.contaAscoltatori("load")).toBe(0);
    expect(finto.contaAscoltatori("error")).toBe(0);
  });
});
