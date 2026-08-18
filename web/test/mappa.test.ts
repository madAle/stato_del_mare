import { describe, expect, it } from "vitest";
import { attendiCaricamento, primoLivelloSimboli, vistaEffettiva, ZOOM_MASSIMO } from "../src/map/mappa";
import type { Griglia } from "../src/data/catalogo";

const GRIGLIA: Griglia = {
  larghezza: 858,
  altezza: 844,
  risoluzioneM: 1200,
  boundsLonLat: { ovest: 10.8437, sud: 39.7559, est: 20.0928, nord: 46.3916 },
};

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

describe("vista iniziale", () => {
  it("senza vista dall'URL, il centro geometrico della griglia e zoom 6", () => {
    expect(vistaEffettiva(GRIGLIA)).toEqual({
      centro: [(10.8437 + 20.0928) / 2, (39.7559 + 46.3916) / 2],
      zoom: 6,
    });
  });

  it("con centro e zoom dall'URL, li usa entrambi", () => {
    // Il centro dell'URL e' [lat, lon] (statoUrl.ts), MapLibre vuole [lng,
    // lat]: e' il punto che un link condiviso non raggiungeva mai, perche'
    // nessuno faceva questa conversione prima di passarla a creaMappa.
    expect(vistaEffettiva(GRIGLIA, { centro: [44.2, 12.6], zoom: 9 }))
      .toEqual({ centro: [12.6, 44.2], zoom: 9 });
  });

  it("solo lo zoom dall'URL: il centro resta quello predefinito", () => {
    const v = vistaEffettiva(GRIGLIA, { centro: null, zoom: 11 });
    expect(v.zoom).toBe(11);
    expect(v.centro).toEqual([(10.8437 + 20.0928) / 2, (39.7559 + 46.3916) / 2]);
  });

  it("solo il centro dall'URL: lo zoom resta il predefinito 6", () => {
    const v = vistaEffettiva(GRIGLIA, { centro: [44.2247, 12.4772], zoom: null });
    expect(v.zoom).toBe(6);
    expect(v.centro).toEqual([12.4772, 44.2247]);
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
