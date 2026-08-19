import type { Griglia } from "../data/catalogo";
import { NODATA } from "../data/frame";
import type { Ora } from "../data/indice";
import { inquadra } from "../data/sorgente";

const R = 6378137.0;

export function aMercatore(lon: number, lat: number): { x: number; y: number } {
  const f = Math.min(Math.max(lat, -85), 85);
  return {
    x: (lon * Math.PI) / 180 * R,
    y: R * Math.log(Math.tan(Math.PI / 4 + (f * Math.PI) / 360)),
  };
}

/**
 * La cella che contiene un punto, o null se il punto e' fuori dal dominio.
 *
 * La riga 0 e' quella a NORD: e' la convenzione del frame, e questo e' l'unico
 * posto della SPA in cui viene tradotta in un indice. Nello shader lo stesso
 * fatto ricompare come un ribaltamento della coordinata di texture, ed e' li'
 * che aveva gia' prodotto un Adriatico disegnato da Belgrado a Napoli.
 */
export function cellaDi(
  griglia: Griglia,
  lon: number,
  lat: number,
): { colonna: number; riga: number } | null {
  const b = griglia.boundsLonLat;
  if (lon < b.ovest || lon > b.est || lat < b.sud || lat > b.nord) return null;

  const p = aMercatore(lon, lat);
  const nw = aMercatore(b.ovest, b.nord);
  // Sul bordo esatto la divisione da' esattamente il numero di celle. Senza il
  // riporto un punto legittimo sul confine del dominio verrebbe respinto.
  const colonna = Math.min(Math.floor((p.x - nw.x) / griglia.risoluzioneM), griglia.larghezza - 1);
  const riga = Math.min(Math.floor((nw.y - p.y) / griglia.risoluzioneM), griglia.altezza - 1);
  if (colonna < 0 || riga < 0) {
    return null;
  }
  return { colonna, riga };
}

/**
 * Il valore fisico sotto un punto, letto dall'Int16Array gia' in memoria.
 *
 * Mai `readPixels`: leggere dalla GPU costa una sincronizzazione della pipeline
 * a ogni movimento del mouse, e restituirebbe comunque il colore invece del
 * numero.
 */
export function valoreA(
  griglia: Griglia,
  dato: Int16Array,
  lon: number,
  lat: number,
  scala: number,
  offset: number,
): number | null {
  const c = cellaDi(griglia, lon, lat);
  if (!c) return null;
  const grezzo = dato[c.riga * griglia.larghezza + c.colonna];
  // Senza questo controllo il nodata diventerebbe -32,768 m di onda: un numero
  // perfettamente stampabile e completamente falso.
  if (grezzo === NODATA) return null;
  return grezzo * scala + offset;
}

/**
 * Il valore sotto un punto per il fotogramma davvero a schermo a un istante,
 * non per un fotogramma qualunque dell'asse.
 *
 * Presa una funzione `prendiFrame` invece di una CacheFrame concreta apposta:
 * questa funzione resta pura (nessuna rete, nessuna cache, nessun oggetto
 * mutabile) e si prova con un dizionario finto, senza dover costruire una
 * cache vera solo per il test.
 *
 * Estratta da MapView dopo un difetto: leggere sempre `asse[0]` invece del
 * fotogramma all'istante corrente avrebbe mostrato il valore di un'ora che il
 * mouse non sta guardando, per esempio quella di 48 ore prima con la finestra
 * iniziale predefinita.
 */
export function valoreCorrente(
  griglia: Griglia,
  asse: Ora[],
  istante: number,
  prendiFrame: (ora: Ora) => Int16Array | undefined,
  lon: number,
  lat: number,
  scala: number,
  offset: number,
): number | null {
  const q = inquadra(asse, istante);
  if (!q) return null;
  const dato = prendiFrame(q.prima);
  if (!dato) return null;
  return valoreA(griglia, dato, lon, lat, scala, offset);
}
