import type { Griglia } from "./catalogo";

/** Il valore che l'ingestore scrive dove il modello non ha mare. */
export const NODATA = -32768;

/**
 * Un frame come Int16Array, riga 0 a nord.
 *
 * Nessun codice di decompressione: il bucket serve i frame con
 * `Content-Encoding: gzip` e il browser li decomprime da solo. Verificato sul
 * bucket vero: 152.935 byte in rete, 1.448.304 decodificati.
 */
export async function leggiFrame(
  url: string,
  griglia: Griglia,
  recupera: typeof fetch = fetch,
): Promise<Int16Array> {
  const risposta = await recupera(url);
  if (!risposta.ok) throw new Error(`frame ${url}: HTTP ${risposta.status}`);
  const buffer = await risposta.arrayBuffer();

  // Un frame troncato non deve diventare una mappa: disegnerebbe meta'
  // Adriatico con il dato nuovo e meta' con quello che c'era prima, e sarebbe
  // plausibile a vedersi.
  const attesi = griglia.larghezza * griglia.altezza * 2;
  if (buffer.byteLength !== attesi) {
    throw new Error(
      `frame ${url}: attesi ${attesi} byte, ricevuti ${buffer.byteLength}`,
    );
  }
  return new Int16Array(buffer);
}
