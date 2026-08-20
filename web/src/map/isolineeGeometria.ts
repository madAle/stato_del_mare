import { contours } from "d3-contour";
import { NODATA } from "../data/frame";
import type { Soglia } from "./soglie";
import { etichettaSoglia } from "./soglie";

/**
 * Il calcolo delle isolinee, come funzione pura: array dentro, GeoJSON fuori.
 *
 * Sta separato dal worker per la stessa ragione per cui `campo_con_segno` sta
 * separato da `main()` lato strumenti: dentro il worker non c'e' modo di
 * provarlo senza aprire un browser, e un calcolo che nessuno prova e' un
 * calcolo che nasconde una fascia di venti chilometri (vedi il difetto delle
 * Tremiti, 2026-08-19).
 */

const R = 6378137.0;

export type GrigliaIsolinee = {
  larghezza: number;
  altezza: number;
  risoluzioneM: number;
  /** Angolo nord-ovest in metri Web Mercator: la riga 0 e' quella a nord. */
  xMin: number;
  yMax: number;
};

/**
 * Il campo che lo shader sta disegnando: due ore mescolate, con la stessa
 * regola sui buchi (se una delle due non ha dato qui si usa l'altra, invece di
 * mediare con zero, che sarebbe un'onda che sprofonda e risale a ogni ora).
 *
 * `NaN` dove non c'e' dato. d3-contour confronta con `>=`, e ogni confronto con
 * NaN e' falso: quelle celle contano come "sotto soglia", ed e' il motivo per
 * cui il bordo del dato genera una linea spuria, tagliata piu' sotto.
 */
export function mescola(
  a: Int16Array,
  b: Int16Array | null,
  frazione: number,
  scala: number,
  offset: number,
): Float64Array {
  const fuori = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b ? b[i] : NODATA;
    let grezzo: number;
    if (va === NODATA && vb === NODATA) {
      fuori[i] = NaN;
      continue;
    } else if (va === NODATA) grezzo = vb;
    else if (vb === NODATA || !b) grezzo = va;
    else grezzo = va + (vb - va) * frazione;
    fuori[i] = grezzo * scala + offset;
  }
  return fuori;
}

/** Vero se il vertice non e' un punto valido, o tocca una cella senza dato. */
export function suUnBordo(
  campo: Float64Array, g: GrigliaIsolinee, gx: number, gy: number,
): boolean {
  // d3-contour calcola dove passa la linea interpolando fra i due valori che la
  // attraversano: con NaN da un lato, la coordinata stessa esce NaN. Senza
  // questa riga il ciclo qui sotto non verrebbe nemmeno eseguito (ogni
  // confronto con NaN e' falso), la funzione direbbe "non e' un bordo" e nel
  // GeoJSON finirebbero vertici NaN, che sono peggio di una linea sbagliata:
  // una geometria invalida che MapLibre non disegna e nessuno segnala.
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return true;
  // Tre celle per lato e non due: un vertice puo' cadere esattamente sul centro
  // di una cella, e li' il blocco 2x2 a valle non comprende la cella senza dato
  // che sta dall'altra parte. Misurato: con il blocco 2x2 sopravviveva un
  // tratto di 26 punti che passava per i centri delle celle piu' esterne del
  // dato, cioe' esattamente il bordo che si voleva togliere.
  //
  // La conseguenza voluta e' che le linee si fermano una cella prima del buco,
  // cioe' 1,2 km dalla costa: e' lo stesso ordine di grandezza con cui il campo
  // sfuma, e una linea che arriva a toccare la riva starebbe comunque dentro
  // l'estrapolazione.
  const ic = Math.round(gx - 0.5);
  const jc = Math.round(gy - 0.5);
  for (let j = jc - 1; j <= jc + 1; j++) {
    for (let i = ic - 1; i <= ic + 1; i++) {
      if (i < 0 || j < 0 || i >= g.larghezza || j >= g.altezza) return true;
      if (Number.isNaN(campo[j * g.larghezza + i])) return true;
    }
  }
  return false;
}

/**
 * Da coordinate della griglia a longitudine e latitudine.
 *
 * d3-contour mette il centro della cella `(i, j)` a `(i + 0,5, j + 0,5)`:
 * verificato provando una griglia con una sola cella accesa, che produce un
 * rombo centrato li'. Sbagliare questo scarto sposterebbe tutte le linee di
 * mezza cella, cioe' di 600 m, che a zoom alto si vede e a zoom basso no.
 */
export function aLonLat(g: GrigliaIsolinee, gx: number, gy: number): [number, number] {
  const x = g.xMin + gx * g.risoluzioneM;
  const y = g.yMax - gy * g.risoluzioneM;
  return [
    (x / R) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
  ];
}

/**
 * Quanto si puo' spostare un vertice, in celle, semplificando.
 *
 * Il marching squares su celle da 1,2 km restituisce una scaletta con un
 * vertice ogni frazione di cella. A zoom 7 l'Adriatico e' largo settecento
 * pixel per ottocentocinquanta celle, quindi quella scaletta zigzaga sotto il
 * pixel e MapLibre rifiuta di piegarci sopra un'etichetta (misurato: su 102
 * linee disegnate sopravviveva **un solo** numero). Mezza cella e' sotto la
 * risoluzione del dato, quindi non sposta niente che il dato sappia davvero.
 */
const TOLLERANZA_CELLE = 0.5;

/** Distanza di un punto dal segmento, al quadrato: niente radici nel ciclo. */
function distanzaQuadra(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const den = dx * dx + dy * dy;
  let t = den > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx - p[0];
  const qy = a[1] + t * dy - p[1];
  return qx * qx + qy * qy;
}

/**
 * Douglas-Peucker, iterativo: una polilinea di isolinea puo' avere migliaia di
 * vertici e la ricorsione naturale arriverebbe a fondo pila su un caso vero.
 */
export function semplifica(
  punti: [number, number][], tolleranza = TOLLERANZA_CELLE,
): [number, number][] {
  if (punti.length <= 2) return punti;
  const soglia = tolleranza * tolleranza;
  const tenuto = new Uint8Array(punti.length);
  tenuto[0] = 1;
  tenuto[punti.length - 1] = 1;
  const pila: [number, number][] = [[0, punti.length - 1]];
  while (pila.length) {
    const [da, a] = pila.pop()!;
    let peggiore = -1;
    let quanto = soglia;
    for (let i = da + 1; i < a; i++) {
      const d = distanzaQuadra(punti[i], punti[da], punti[a]);
      if (d > quanto) { quanto = d; peggiore = i; }
    }
    if (peggiore >= 0) {
      tenuto[peggiore] = 1;
      pila.push([da, peggiore], [peggiore, a]);
    }
  }
  return punti.filter((_, i) => tenuto[i] === 1);
}

/**
 * Quanto puo' spostarsi una linea quando la si smussa, in celle.
 *
 * Il marching squares restituisce spigoli veri: misurato sul campo del
 * 20/08/2026, l'angolo fra due segmenti adiacenti arriva a 130 gradi. Sono
 * spigoli dell'algoritmo, non del mare, ma soprattutto MapLibre rifiuta di
 * piegare un'etichetta oltre `text-max-angle`, quindi sulle isolinee chiuse
 * (le "bolle" al largo) il numero non compariva mai: 220 linee con nome, 3
 * numeri a schermo.
 *
 * Mezza cella e' 600 m, sotto la risoluzione del dato: lo smusso non puo'
 * spostare la linea piu' di quanto il dato sappia dire dove sta.
 */
const RAGGIO_SMUSSO_CELLE = 0.5;

/** Quante volte si taglia l'angolo. Ogni passata lo dimezza. */
const PASSATE_SMUSSO = 3;

function unaPassata(
  p: [number, number][], chiusa: boolean, raggio: number,
): [number, number][] {
  const fuori: [number, number][] = [];
  const n = p.length;
  if (!chiusa) fuori.push(p[0]);
  for (let i = 0; i < (chiusa ? n : n - 1); i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lung = Math.hypot(dx, dy);
    // Chaikin taglia sempre a un quarto; qui il taglio si ferma a `raggio`,
    // se no un segmento lungo verrebbe spostato di meta' della sua lunghezza e
    // la linea si allontanerebbe dal dato invece di rappresentarlo meglio.
    const t = lung > 0 ? Math.min(0.25, raggio / lung) : 0;
    fuori.push([a[0] + dx * t, a[1] + dy * t]);
    fuori.push([b[0] - dx * t, b[1] - dy * t]);
  }
  if (!chiusa) fuori.push(p[n - 1]);
  return fuori;
}

/**
 * Smussa gli spigoli tagliandoli, alla Chaikin ma con il taglio limitato.
 *
 * Un anello chiuso si smussa in cerchio: trattarlo come una spezzata aperta
 * lascerebbe uno spigolo nella cucitura, cioe' esattamente dove non si vede
 * che c'e' un inizio.
 */
export function liscia(
  punti: [number, number][],
  passate = PASSATE_SMUSSO,
  raggio = RAGGIO_SMUSSO_CELLE,
): [number, number][] {
  if (punti.length < 3) return punti;
  const ultimo = punti[punti.length - 1];
  const chiusa = punti[0][0] === ultimo[0] && punti[0][1] === ultimo[1];
  let corrente = chiusa ? punti.slice(0, -1) : punti;
  if (corrente.length < 3) return punti;
  for (let i = 0; i < passate; i++) corrente = unaPassata(corrente, chiusa, raggio);
  return chiusa ? [...corrente, corrente[0]] : corrente;
}

/**
 * Toglie i punti rimasti allineati dopo lo smusso.
 *
 * La tolleranza e' due ordini di grandezza sotto il raggio dello smusso, e
 * dev'esserlo: sull'arco di un angolo smussato lo scarto fra punti vicini vale
 * qualche millesimo di cella, quindi una tolleranza generosa **ributterebbe lo
 * spigolo dentro**, cioe' disferebbe il lavoro appena fatto. Qui si tolgono i
 * punti in mezzo ai tratti dritti, dove il taglio limitato non ha cambiato
 * niente ma ha comunque raddoppiato i vertici a ogni passata.
 */
function ripulisci(punti: [number, number][]): [number, number][] {
  return semplifica(punti, 0.001);
}

function comeLinea(punti: [number, number][], soglia: Soglia): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: punti },
    properties: {
      valore: soglia.valore,
      nome: soglia.nome,
      etichetta: soglia.nome ? etichettaSoglia(soglia.valore) : "",
    },
  };
}

/**
 * Sotto questa lunghezza (in celle) una linea non porta il numero.
 *
 * Misurato sul campo del 20/08/2026 a zoom 7: 201 delle 228 linee con nome
 * erano piu' corte di 40 pixel, cioe' schegge da pochi punti. Un numero su una
 * scheggia e' una cifra che galleggia, non un'etichetta.
 */
const LUNGHEZZA_MINIMA_CELLE = 20;

/**
 * Dove mettere il numero su una linea, e con che inclinazione.
 *
 * Il punto e' a meta' della lunghezza, non a meta' dei vertici: dopo lo smusso
 * i vertici sono fitti dove la linea gira e radi dove va dritta, quindi
 * contarli metterebbe il numero sistematicamente nelle curve.
 *
 * L'inclinazione si prende su una finestra larga (un decimo della linea) e non
 * fra due vertici adiacenti: fra due vertici vicini l'angolo e' rumore.
 */
function ancoraggio(
  punti: [number, number][],
): { punto: [number, number]; gradi: number; lunghezza: number } | null {
  const cumulata = [0];
  for (let i = 1; i < punti.length; i++) {
    cumulata.push(cumulata[i - 1] + Math.hypot(punti[i][0] - punti[i - 1][0], punti[i][1] - punti[i - 1][1]));
  }
  const totale = cumulata[cumulata.length - 1];
  if (totale <= 0) return null;

  const meta = totale / 2;
  let i = 1;
  while (i < cumulata.length - 1 && cumulata[i] < meta) i++;
  const passo = cumulata[i] - cumulata[i - 1];
  const f = passo > 0 ? (meta - cumulata[i - 1]) / passo : 0;
  const punto: [number, number] = [
    punti[i - 1][0] + (punti[i][0] - punti[i - 1][0]) * f,
    punti[i - 1][1] + (punti[i][1] - punti[i - 1][1]) * f,
  ];

  const finestra = Math.max(1, Math.round((punti.length - 1) / 10));
  const a = punti[Math.max(0, i - 1 - finestra)];
  const b = punti[Math.min(punti.length - 1, i + finestra)];
  // y cresce verso sud nelle coordinate di griglia, quindi il segno si ribalta
  // per ottenere gradi che girano come li vuole MapLibre (orario da nord).
  let gradi = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI - 90;
  gradi = ((gradi % 360) + 360) % 360;
  // Un numero non si legge a testa in giu': si gira di mezzo giro, la linea
  // e' la stessa da percorrere in un verso o nell'altro.
  if (gradi > 90 && gradi < 270) gradi -= 180;
  return { punto, gradi, lunghezza: totale };
}

/** L'ancora del numero: un punto con la sua inclinazione. */
function comeNumero(
  dove: [number, number], gradi: number, soglia: Soglia,
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: dove },
    properties: {
      valore: soglia.valore,
      nome: soglia.nome,
      etichetta: etichettaSoglia(soglia.valore),
      gradi,
    },
  };
}

/** Le isolinee del campo, gia' in longitudine e latitudine. */
export function isolineeDi(
  campo: Float64Array, g: GrigliaIsolinee, soglie: readonly Soglia[],
): GeoJSON.FeatureCollection {
  const calcolatore = contours().size([g.larghezza, g.altezza]);
  const linee: GeoJSON.Feature[] = [];

  for (const soglia of soglie) {
    const poligoni = calcolatore.contour(campo as unknown as number[], soglia.valore);
    for (const anello of poligoni.coordinates.flat()) {
      // Il contorno del dato non e' un'isolinea: e' il bordo del dominio, e
      // senza tagliarlo ogni costa avrebbe una falsa linea di 0,1 m (misurato:
      // un mare uniforme a 0,3 circondato da NODATA produce un anello alla
      // soglia piu' bassa, che e' solo il bordo). Si spezza l'anello nei tratti
      // lontani dai buchi invece di scartarlo intero, perche' un'isolinea vera
      // puo' benissimo arrivare a toccare la costa a un capo.
      // Si semplifica in coordinate di griglia e si converte dopo: la
      // tolleranza e' in celle, e li' e' un numero che significa qualcosa.
      const chiudi = (t: [number, number][]) => {
        if (t.length < 2) return;
        // Tre passi, in quest'ordine: si toglie la scaletta (Douglas-Peucker),
        // si smussano gli spigoli rimasti, e si ributtano via i punti che lo
        // smusso ha lasciato allineati. L'ultimo passo e' quello che tiene il
        // conto dei vertici: il taglio limitato aggiunge punti solo vicino agli
        // angoli, quindi in mezzo ai tratti dritti sono tutti collineari.
        const s = ripulisci(liscia(semplifica(t)));
        if (s.length < 2) return;
        linee.push(comeLinea(s.map(([x, y]) => aLonLat(g, x, y)), soglia));
        // Il numero non lo lascia piazzare a MapLibre lungo la linea: con
        // `symbol-placement: line` la libreria ne mette al piu' uno per linea e
        // solo se le va bene, e sulle isolinee chiuse al largo non ne metteva
        // nessuno (misurato: 228 linee con nome, 6 numeri a schermo). Qui
        // l'ancora la scegliamo noi, e ogni linea abbastanza lunga ce l'ha.
        if (!soglia.nome) return;
        const a = ancoraggio(s);
        if (a && a.lunghezza >= LUNGHEZZA_MINIMA_CELLE) {
          linee.push(comeNumero(aLonLat(g, a.punto[0], a.punto[1]), a.gradi, soglia));
        }
      };
      let tratto: [number, number][] = [];
      for (const [gx, gy] of anello as [number, number][]) {
        if (suUnBordo(campo, g, gx, gy)) {
          chiudi(tratto);
          tratto = [];
        } else {
          tratto.push([gx, gy]);
        }
      }
      chiudi(tratto);
    }
  }
  return { type: "FeatureCollection", features: linee };
}
