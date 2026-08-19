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
    expect(leggiStatoUrl("")).toEqual({ istante: null, variabile: null, zoom: null, centro: null });
  });

  it("un URL rotto non fa saltare l'applicazione", () => {
    // un link vecchio o troncato deve aprire l'app sulle impostazioni
    // predefinite, non su una pagina bianca
    const s = leggiStatoUrl("?t=domani&z=molto&c=cosi");
    expect(s).toEqual({ istante: null, variabile: null, zoom: null, centro: null });
  });

  it("scrive e rilegge senza perdere niente", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:00:00Z"),
      variabile: "hwave", zoom: 8, centro: [44.21, 12.48] as [number, number],
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("lo zoom frazionario (naturale di MapLibre) si conserva", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:00:00Z"),
      variabile: "hwave", zoom: 10.4, centro: [44.21, 12.48] as [number, number],
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("le coordinate negative si conservano", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:00:00Z"),
      variabile: "hwave", zoom: 8, centro: [44.21, -12.48] as [number, number],
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("l'istante con minuti diversi da zero si conserva", () => {
    const stato = {
      istante: Date.parse("2026-08-13T14:23:45Z"),
      variabile: "hwave", zoom: 8, centro: [44.21, 12.48] as [number, number],
    };
    expect(leggiStatoUrl(scriviStatoUrl(stato))).toEqual(stato);
  });

  it("la variabile vuota diventa null, non stringa vuota", () => {
    const s = leggiStatoUrl("?var=");
    expect(s.variabile).toBeNull();
  });
});
