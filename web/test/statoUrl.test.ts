import { describe, expect, it } from "vitest";
import { leggiStatoUrl, scriviStatoUrl } from "../src/ui/statoUrl";

describe("stato nell'URL", () => {
  it("legge il formato della spec", () => {
    const s = leggiStatoUrl("?t=2026-08-13T14:00Z&var=hwave&z=8&c=44.21,12.48");
    expect(s.istante).toBe(Date.parse("2026-08-13T14:00Z"));
    expect(s.variabile).toBe("hwave");
    expect(s.zoom).toBe(8);
    expect(s.centro).toEqual([44.21, 12.48]);
  });

  it("un URL vuoto non inventa valori", () => {
    expect(leggiStatoUrl("")).toEqual({ istante: null, variabile: null, palette: null, zoom: null, centro: null, punto: null, isolinee: null, direzione: null });
  });

  it("un URL rotto non fa saltare l'applicazione", () => {
    // un link vecchio o troncato deve aprire l'app sulle impostazioni
    // predefinite, non su una pagina bianca
    const s = leggiStatoUrl("?t=domani&z=molto&c=cosi");
    expect(s).toEqual({ istante: null, variabile: null, palette: null, zoom: null, centro: null, punto: null, isolinee: null, direzione: null });
  });

  it("scrive e rilegge senza perdere niente", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:00:00Z"),
      variabile: "hwave", palette: null, zoom: 8, centro: [44.21, 12.48] as [number, number], punto: null, isolinee: null, direzione: null,
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("lo zoom frazionario (naturale di MapLibre) si conserva", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:00:00Z"),
      variabile: "hwave", palette: null, zoom: 10.4, centro: [44.21, 12.48] as [number, number], punto: null, isolinee: null, direzione: null,
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("le coordinate negative si conservano", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:00:00Z"),
      variabile: "hwave", palette: null, zoom: 8, centro: [44.21, -12.48] as [number, number], punto: null, isolinee: null, direzione: null,
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("l'istante con minuti diversi da zero si conserva", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:23:45Z"),
      variabile: "hwave", palette: null, zoom: 8, centro: [44.21, 12.48] as [number, number], punto: null, isolinee: null, direzione: null,
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("la variabile vuota diventa null, non stringa vuota", () => {
    const s = leggiStatoUrl("?var=");
    expect(s.variabile).toBeNull();
  });
});

describe("la tavolozza nell'URL", () => {
  it("si legge e si riscrive, se no il primo aggiornamento la cancella", () => {
    // e' il difetto che si voleva evitare: un parametro letto da qualcuno e non
    // scritto da chi riscrive l'URL sparisce appena il tempo avanza, e il
    // selettore sembra funzionare finche' non si guarda la barra degli indirizzi
    const stato = {
      istante: Date.parse("2026-08-19T09:00:00Z"),
      variabile: "hwave", palette: "dense", zoom: 9, centro: [44.2, 12.6] as [number, number], punto: null, isolinee: null, direzione: null,
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("senza il parametro resta null, cosi' vale quella del catalogo", () => {
    expect(leggiStatoUrl("?t=2026-08-19T09:00Z").palette).toBeNull();
    expect(leggiStatoUrl("?palette=").palette).toBeNull();
  });
});

describe("il punto osservato nell'URL", () => {
  it("si legge e si riscrive, come tutto il resto dello stato", () => {
    const stato = {
      istante: Date.parse("2026-08-19T14:00:00Z"),
      variabile: "hwave", palette: null, zoom: 9,
      centro: [44.2, 12.6] as [number, number],
      punto: [44.31, 12.55] as [number, number], isolinee: null, direzione: null,
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("non si confonde con il centro: sono due coordinate diverse", () => {
    // il centro e' dove guarda la mappa, il punto e' dove si misura. Un link
    // che li scambiasse manderebbe a vedere il posto giusto con il numero di
    // un altro.
    const s = leggiStatoUrl("?c=44.2,12.6&p=45.1,13.4");
    expect(s.centro).toEqual([44.2, 12.6]);
    expect(s.punto).toEqual([45.1, 13.4]);
  });

  it("un punto rotto non fa saltare l'applicazione", () => {
    expect(leggiStatoUrl("?p=quilato").punto).toBeNull();
    expect(leggiStatoUrl("?p=1").punto).toBeNull();
    expect(leggiStatoUrl("?p=").punto).toBeNull();
  });
});

describe("le isolinee accese o spente viaggiano nell'URL", () => {
  const base = {
    istante: null, variabile: null, palette: null, zoom: null, centro: null, punto: null,
    direzione: null,
  };

  it("fa il giro completo in tutti e due i versi", () => {
    for (const iso of [true, false]) {
      const stato = { ...base, isolinee: iso };
      expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
    }
  });

  it("un valore che non e' 1 o 0 vale 'non detto', non 'vero'", () => {
    // Un link storto non deve accendere o spegnere le linee a caso: senza
    // questa regola, "iso=si" o "iso=" verrebbero letti come veri e
    // cambierebbero l'impostazione di casa senza che nessuno l'abbia chiesto.
    expect(leggiStatoUrl("?iso=si").isolinee).toBeNull();
    expect(leggiStatoUrl("?iso=").isolinee).toBeNull();
    expect(leggiStatoUrl("?iso=true").isolinee).toBeNull();
    expect(leggiStatoUrl("").isolinee).toBeNull();
  });
});
