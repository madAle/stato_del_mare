import { describe, expect, it } from "vitest";
import type { Griglia } from "../src/data/catalogo";
import { leggiFrame, NODATA } from "../src/data/frame";

const GRIGLIA: Griglia = {
  larghezza: 4, altezza: 3, risoluzioneM: 1200,
  boundsLonLat: { ovest: 10, sud: 40, est: 20, nord: 46 },
};

function rispostaBinaria(valori: number[]): typeof fetch {
  const a = Int16Array.from(valori);
  return (async () => new Response(a.buffer, { status: 200 })) as unknown as typeof fetch;
}

describe("frame", () => {
  it("decodifica un buffer little endian con un nodata dentro", async () => {
    const dato = await leggiFrame("http://x/f.bin", GRIGLIA,
      rispostaBinaria([0, 1200, NODATA, 32767, -5, 7, 8, 9, 10, 11, 12, 13]));
    expect(dato.length).toBe(12);
    expect(dato[1]).toBe(1200);
    expect(dato[2]).toBe(NODATA);
    expect(dato[3]).toBe(32767);
  });

  it("una lunghezza sbagliata si ferma invece di disegnare mezzo campo", async () => {
    // un frame troncato disegnerebbe una mappa plausibile e sbagliata: meta'
    // Adriatico con dati e meta' con quello che c'era prima in memoria
    await expect(
      leggiFrame("http://x/f.bin", GRIGLIA, rispostaBinaria([1, 2, 3])),
    ).rejects.toThrow(/24 byte/);
  });

  it("un errore HTTP porta l'URL nel messaggio", async () => {
    const ko = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(leggiFrame("http://x/f.bin", GRIGLIA, ko)).rejects.toThrow(/404/);
  });
});
