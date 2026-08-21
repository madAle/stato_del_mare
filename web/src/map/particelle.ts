import { NODATA } from "../data/frame";

/**
 * Il moto delle particelle che mostrano la direzione dell'onda.
 *
 * Sta qui, fuori dal livello WebGL, per la stessa ragione del marching squares e
 * del campo di distanza: dentro un contesto grafico non c'e' modo di provarlo
 * senza aprire un browser, e questo pezzo contiene **tre cose che possono essere
 * sbagliate in silenzio** (la convenzione dell'angolo, la deformazione di
 * Mercatore e la fisica della velocita'), ognuna delle quali produrrebbe
 * un'animazione bellissima e falsa.
 *
 * Le tre, per esteso:
 *
 * 1. `Dwave` e' la direzione **da cui** l'onda viene, in gradi orari da nord
 *    (convenzione nautica). Il file NetCDF non lo dichiara: e' stato ricavato
 *    dal dato, confrontando l'angolo con il verso in cui cresce l'altezza
 *    d'onda, su quattro istanti (scarto 150-177 gradi, cioe' mezzo giro).
 *    Le particelle vanno dove l'onda **va**, quindi mezzo giro piu' in la'.
 *
 * 2. La griglia e' in metri di Mercatore, dove un metro sulla mappa vale
 *    `cos(latitudine)` metri di mare. Fra Bari e Trieste il fattore passa da
 *    0,75 a 0,69: senza correzione le particelle correrebbero il 9 per cento
 *    piu' veloci a nord che a sud, cioe' l'animazione mostrerebbe un gradiente
 *    che nel mare non c'e'.
 *
 * 3. La velocita' non e' inventata: in acqua profonda un'onda di periodo `T`
 *    viaggia a `c = g T / 2 pi`, cioe' circa 1,56 T metri al secondo. Con i
 *    periodi misurati in archivio (da 1,0 a 7,4 s) sono da 1,6 a 11,5 m/s, una
 *    differenza che si vede. Una velocita' costante avrebbe mostrato un moto
 *    uniforme che nel mare non esiste.
 */

/** g / 2 pi, in metri al secondo per secondo di periodo. */
export const VELOCITA_PER_SECONDO_DI_PERIODO = 9.81 / (2 * Math.PI);

/** La geometria comune, uguale per qualunque campo di moto. */
export type Geometria = {
  larghezza: number;
  altezza: number;
  /** Metri di Mercatore per cella. */
  risoluzioneM: number;
  /** Coordinata y di Mercatore del bordo nord, per ricavare la latitudine. */
  yMax: number;
};

/**
 * Un campo da cui ricavare un moto, in due forme.
 *
 * **Onda**: seno e coseno della direzione da cui viene, piu' il periodo, da cui
 * la celerita' `c = g T / 2 pi`. Il verso e' mezzo giro rispetto all'angolo.
 *
 * **Corrente**: le due componenti della velocita'. Il verso e' quello delle
 * componenti, **senza** mezzo giro, e la velocita' e' il loro modulo: qui il
 * dato e' la velocita', non un periodo da cui ricavarla.
 *
 * Sono un'unione discriminata e non due funzioni separate perche' tutto quello
 * che sta a valle (la cresta, il ricambio delle particelle, la correzione di
 * Mercatore) e' identico: separarle vorrebbe dire due copie di quella roba, che
 * e' il modo in cui fra sei mesi divergono.
 */
export type CampiMoto =
  | ({ tipo: "onda"; sin: Float32Array; cos: Float32Array; periodo: Float32Array } & Geometria)
  | ({ tipo: "corrente"; u: Float32Array; v: Float32Array } & Geometria);

const R = 6378137.0;

/** Latitudine, in radianti, della riga `j` della griglia. */
export function latitudineDi(campi: CampiMoto, j: number): number {
  const y = campi.yMax - (j + 0.5) * campi.risoluzioneM;
  return 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2;
}

/**
 * Lo spostamento di una particella in un secondo, in celle di griglia.
 *
 * Restituisce null dove il dato non c'e': la particella va fatta rinascere
 * altrove, non lasciata ferma. Una particella immobile su un buco disegna un
 * punto fisso, che si legge come "qui il mare sta fermo" invece che come "qui
 * non so".
 */
export function velocitaInCelle(
  campi: CampiMoto, i: number, j: number,
): { di: number; dj: number } | null {
  const ii = Math.floor(i);
  const jj = Math.floor(j);
  if (ii < 0 || jj < 0 || ii >= campi.larghezza || jj >= campi.altezza) return null;
  const k = jj * campi.larghezza + ii;

  let est: number;
  let nord: number;
  let metriAlSecondo: number;

  if (campi.tipo === "onda") {
    const s = campi.sin[k];
    const c = campi.cos[k];
    const t = campi.periodo[k];
    if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
    // Un seno e un coseno che non stanno su un cerchio unitario non sono una
    // direzione: succede dove l'interpolazione fra due ore ha mescolato una
    // cella con dato e una senza. Meglio far rinascere la particella che
    // disegnare una rotta inventata.
    const modulo = Math.hypot(s, c);
    if (modulo < 0.5) return null;
    // Dove l'onda **va**: mezzo giro rispetto a dove viene. Con l'angolo in
    // convenzione nautica, est = sin e nord = cos, quindi il mezzo giro e' un
    // cambio di segno su entrambe le componenti.
    est = -s / modulo;
    nord = -c / modulo;
    metriAlSecondo = VELOCITA_PER_SECONDO_DI_PERIODO * t;
  } else {
    const u = campi.u[k];
    const v = campi.v[k];
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    // La velocita' **e'** il modulo, e il verso e' quello delle componenti:
    // niente mezzo giro, perche' u e v dicono gia' dove l'acqua va.
    //
    // Math.hypot(u, v) qui e' un'affermazione di fisica, non un calcolo con
    // conseguenze osservabili fuori da questa riga: viene diviso in est/nord
    // e ri-moltiplicato in celleAlSecondo qui sotto, quindi si elide sempre
    // dal risultato finale, qualunque formula non negativa ci si scriva
    // (somma dei valori assoluti, una costante, il doppio del vero), purche'
    // sia la STESSA usata in entrambi i passaggi. Misurato sostituendo a mano
    // tre formule diverse: nessuna cambia (di, dj), ne' su una corrente
    // diagonale. L'unico effetto osservabile e' sulla guardia qui sotto (zero
    // solo se u = v = 0), gia' provata da "dove il dato non c'e'". Non
    // semplificare in `est = u; nord = v` pensando che sia equivalente: lo e'
    // nel risultato, ma smette di dire che la velocita' di una corrente **e'**
    // il modulo delle sue componenti, che e' il motivo per cui questo ramo
    // esiste. Il difetto vero che questa forma previene e' un fattore spurio:
    // se una riga come quella dell'onda (`* VELOCITA_PER_SECONDO_DI_PERIODO`)
    // finisse per sbaglio solo su un lato della divisione, la cancellazione si
    // rompe e il modulo esce sbagliato di quel fattore (misurato: 0,780655
    // invece di 0,5 su una corrente 0,3/0,4). Vedi il test
    // "compone u e v come un vettore unico" in particelle.test.ts.
    metriAlSecondo = Math.hypot(u, v);
    if (metriAlSecondo <= 0) return null;
    est = u / metriAlSecondo;
    nord = v / metriAlSecondo;
  }

  // Da metri di mare a metri di Mercatore, e da metri di Mercatore a celle.
  const celleAlSecondo = metriAlSecondo / (Math.cos(latitudineDi(campi, jj)) * campi.risoluzioneM);
  // La riga cresce verso sud, quindi il nord e' meno j.
  return { di: est * celleAlSecondo, dj: -nord * celleAlSecondo };
}

/**
 * I punti di una cresta d'onda, in coordinate di cella.
 *
 * **La forma in cui un'onda si disegna, e non e' quella del vento.** Un punto
 * che striscia lasciando una scia e' l'idioma delle mappe di vento, e li' e'
 * corretto: l'aria percorre davvero quella traiettoria. In un'onda no. L'acqua
 * non viaggia: viaggia la cresta, e la cresta e' una linea **trasversale** alla
 * direzione di propagazione. Disegnare l'onda come un flusso e' un'affermazione
 * sbagliata sulla fisica, oltre che una confusione con un'altra grandezza.
 *
 * La perpendicolare si prende nel piano delle celle, che e' isotropo (una cella
 * vale `risoluzioneM` metri di Mercatore in entrambi i versi) e conforme:
 * perpendicolare qui vuol dire perpendicolare **anche a schermo**, a ogni zoom e
 * a ogni latitudine, senza correzioni.
 *
 * `bombatura` e' quanto l'arco gonfia in avanti, in frazione della
 * semilunghezza. **Non e' fisica**: le creste vere sono rette, o incurvate dalla
 * rifrazione dove il fondo sale, senza nessuna convessita' sistematica nel verso
 * del moto. E' l'unica cosa che porta il verso su un fotogramma **fermo**, ora
 * che la scia che sbiadiva non c'e' piu': una cresta simmetrica non dice se
 * l'onda va a nord o a sud. Chi la legge come un dato la sta leggendo male, e
 * per questo sta scritto qui.
 *
 * `null` dove non c'e' direzione, per la stessa ragione per cui una particella
 * su un buco rinasce invece di restare ferma: un arco su una cella senza dato
 * afferma un verso che non esiste.
 */
export function cresta(
  campi: CampiMoto, i: number, j: number,
  semiCelle: number, bombatura: number, segmenti = 4,
): number[] | null {
  const v = velocitaInCelle(campi, i, j);
  if (!v) return null;
  const modulo = Math.hypot(v.di, v.dj);
  if (!(modulo > 0)) return null;
  // Il verso in cui l'onda va, e la sua perpendicolare: un quarto di giro.
  const ui = v.di / modulo;
  const uj = v.dj / modulo;
  const ni = -uj;
  const nj = ui;

  const punti: number[] = [];
  for (let k = 0; k <= segmenti; k++) {
    // Da un capo all'altro: la parabola (1 - s al quadrato) e' nulla ai capi,
    // quindi la corda resta esattamente perpendicolare e lunga il doppio della
    // semilunghezza, qualunque bombatura si scelga.
    const s = -1 + (2 * k) / segmenti;
    const gonfio = bombatura * semiCelle * (1 - s * s);
    punti.push(
      i + ni * s * semiCelle + ui * gonfio,
      j + nj * s * semiCelle + uj * gonfio,
    );
  }
  return punti;
}

export type Particella = {
  i: number;
  j: number;
  /** Fotogrammi rimasti prima di rinascere comunque. */
  vita: number;
};

/**
 * Fa nascere una particella in un punto a caso della griglia.
 *
 * `caso` e' iniettata invece di usare Math.random direttamente: un moto che non
 * si puo' riprodurre non si puo' nemmeno provare.
 */
export function nasci(
  campi: CampiMoto, caso: () => number, vitaMassima: number,
): Particella {
  const i = caso() * campi.larghezza;
  const j = caso() * campi.altezza;
  return { i, j, vita: 1 + Math.floor(caso() * vitaMassima) };
}

/**
 * Avanza tutte le particelle di `dt` secondi di tempo del mare.
 *
 * Chi esce dalla griglia, chi finisce su un buco e chi ha esaurito la vita
 * rinasce altrove. Il ricambio non e' cosmetico: senza, le particelle si
 * accumulano dove il campo converge e le zone di uscita restano vuote, cioe'
 * l'animazione mostrerebbe una densita' che dipende da quanto tempo e' passato
 * invece che dal mare.
 */
export function avanza(
  particelle: Particella[],
  campi: CampiMoto,
  dt: number,
  caso: () => number,
  vitaMassima: number,
): void {
  for (let n = 0; n < particelle.length; n++) {
    const p = particelle[n];
    const v = velocitaInCelle(campi, p.i, p.j);
    if (!v || p.vita <= 0) {
      particelle[n] = nasci(campi, caso, vitaMassima);
      continue;
    }
    p.i += v.di * dt;
    p.j += v.dj * dt;
    p.vita--;
  }
}

/** Il campo fisico a partire dai due fotogrammi grezzi, come fa lo shader. */
export function mescolaCampo(
  a: Int16Array, b: Int16Array | null, frazione: number, scala: number,
): Float32Array {
  const fuori = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b ? b[i] : NODATA;
    if (va === NODATA && vb === NODATA) { fuori[i] = NaN; continue; }
    if (va === NODATA) fuori[i] = vb * scala;
    else if (vb === NODATA || !b) fuori[i] = va * scala;
    else fuori[i] = (va + (vb - va) * frazione) * scala;
  }
  return fuori;
}
