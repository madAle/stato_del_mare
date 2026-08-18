import type { Griglia } from "../data/catalogo";
import { NODATA } from "../data/frame";

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
  const colonna = Math.floor((p.x - nw.x) / griglia.risoluzioneM);
  const riga = Math.floor((nw.y - p.y) / griglia.risoluzioneM);
  if (colonna < 0 || riga < 0 || colonna >= griglia.larghezza || riga >= griglia.altezza) {
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
