import { layers, namedFlavor } from "@protomaps/basemaps";
import maplibregl, {
  type ErrorEvent,
  type Map as MappaLibre,
  type StyleSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { ORIGINE } from "../data/urls";
import type { Griglia } from "../data/catalogo";

/**
 * Oltre questo zoom la mappa promette una precisione che il dato non ha.
 *
 * A zoom 15 una cella del modello vale 353 pixel di schermo, quindi il campo
 * smette di risolvere sotto gli occhi di chi guarda: e' il modo onesto di dire
 * che li' c'e' un numero solo. Un tetto piu' basso nasconderebbe il limite
 * invece di mostrarlo, e impedirebbe la domanda per cui la mappa esiste, cioe'
 * com'e' il mare alla propria spiaggia.
 */
export const ZOOM_MASSIMO = 15;

const BASEMAP = `${ORIGINE}/basemap`;

/**
 * L'id del primo livello di simboli dello stile.
 *
 * Il campo si inserisce PRIMA di questo, cosi' i nomi di luoghi e porti restano
 * sopra e leggibili. E' l'unico motivo per cui la basemap deve essere
 * vettoriale: sotto una tile raster non c'e' niente sotto cui infilarsi, e il
 * problema delle scritte coperte non si risolve allontanando il campo dalla
 * costa, perche' le scritte sul mare non stanno vicino alla costa.
 */
export function primoLivelloSimboli(
  stile: { layers: { id: string; type: string }[] },
): string | undefined {
  return stile.layers.find((l) => l.type === "symbol")?.id;
}

/** Lo stile con la basemap vettoriale pmtiles, usato quando il chiamante non ne passa uno suo. */
function stileBasemap(): StyleSpecification {
  return {
    version: 8,
    // Font e sprite stanno nel nostro bucket, non sul dominio di terzi: se no
    // la promessa di non avere dipendenze di esecuzione sarebbe finta.
    glyphs: `${BASEMAP}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${BASEMAP}/sprites/light`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${BASEMAP}/adriatico.pmtiles`,
        attribution: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers("protomaps", namedFlavor("light"), { lang: "it" }),
  };
}

/**
 * Il poco che serve dalla mappa per aspettarne il caricamento: solo "once" e
 * "off", cosi' la funzione si puo' esercitare con un oggetto finto nei test,
 * senza dover creare un WebGLRenderingContext vero.
 */
type EmettitoreCiclo = {
  once(tipo: "load" | "error", ascoltatore: (evento?: ErrorEvent) => void): unknown;
  off(tipo: "load" | "error", ascoltatore: (evento?: ErrorEvent) => void): unknown;
};

/**
 * Aspetta che la mappa finisca di caricare lo stile, e rifiuta se fallisce.
 *
 * Senza un ascoltatore su "error" che rifiuta la promessa, un caricamento
 * fallito (stile, sprite, glifi o archivio pmtiles irraggiungibili) non
 * diventa un errore: MapLibre, quando "error" non ha ascoltatori propri, si
 * limita a un console.error interno e non lancia niente, quindi la promessa
 * resterebbe sospesa per sempre, e chi apre l'app vede un caricamento che non
 * finisce mai senza niente da leggere sul perche'. E' il caso di oggi: la
 * basemap non e' ancora pubblicata sul bucket, quindi questo ramo si
 * esercita per davvero finche' qualcuno non esegue strumenti/asset.sh.
 *
 * I due ascoltatori si tolgono a vicenda appena uno dei due vince, cosi' non
 * restano appesi sulla mappa dopo che la promessa si e' gia' decisa.
 */
export function attendiCaricamento(mappa: EmettitoreCiclo): Promise<void> {
  return new Promise<void>((risolvi, rifiuta) => {
    const suCaricato = () => {
      mappa.off("error", suErrore);
      risolvi();
    };
    const suErrore = (evento?: ErrorEvent) => {
      mappa.off("load", suCaricato);
      const causa = evento?.error ? `: ${evento.error.message}` : "";
      rifiuta(
        new Error(
          "la mappa non ha completato il caricamento dello stile. Causa piu' probabile: " +
            "la basemap non e' ancora pubblicata sul bucket (vedi strumenti/asset.sh)" +
            causa,
        ),
      );
    };
    mappa.once("load", suCaricato);
    mappa.once("error", suErrore);
  });
}

export async function creaMappa(
  contenitore: HTMLElement,
  griglia: Griglia,
  // Opzionale: se assente si costruisce lo stile con la basemap pmtiles qui
  // sotto. La basemap non e' ancora pubblicata sul bucket (702 MB: caricarla
  // e' una decisione dell'utente, non nostra), quindi il test di resa passa
  // qui uno stile minimo locale invece di dipendere da un asset che potrebbe
  // non esserci.
  stile?: StyleSpecification,
): Promise<MappaLibre> {
  // pmtiles si registra come protocollo: da qui in poi un URL pmtiles:// e' una
  // sorgente come un'altra, e il browser legge il file a richieste di
  // intervallo invece di scaricare 702 MB.
  const protocollo = new Protocol();
  maplibregl.addProtocol("pmtiles", protocollo.tile);

  const b = griglia.boundsLonLat;
  const mappa = new maplibregl.Map({
    container: contenitore,
    style: stile ?? stileBasemap(),
    center: [(b.ovest + b.est) / 2, (b.sud + b.nord) / 2],
    zoom: 6,
    maxZoom: ZOOM_MASSIMO,
    maxBounds: [
      [b.ovest - 1, b.sud - 1],
      [b.est + 1, b.nord + 1],
    ],
  });

  await attendiCaricamento(mappa);
  return mappa;
}
