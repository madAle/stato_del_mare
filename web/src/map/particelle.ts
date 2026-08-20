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

/**
 * Quanti punti di scia si ricordano, e ogni quanti fotogrammi se ne prende uno.
 *
 * Non uno per fotogramma: a una velocita' leggibile (una quarantina di pixel al
 * secondo) un fotogramma vale meno di un pixel, quindi una scia di otto passi e'
 * lunga sei pixel. Misurato: a schermo non erano strisce ma una **polvere
 * bianca uniforme**, che invece di mostrare il moto sbiadiva il campo sotto.
 * Campionando un fotogramma su sei, dodici punti coprono un secondo di moto,
 * cioe' una quarantina di pixel: quella si legge come una scia.
 */
export const PUNTI_SCIA = 12;
export const FOTOGRAMMI_PER_PUNTO = 6;

export type CampiDirezione = {
  /** Seno della direzione da cui viene l'onda, gia' in unita' fisiche. */
  sin: Float32Array;
  cos: Float32Array;
  /** Periodo in secondi. */
  periodo: Float32Array;
  larghezza: number;
  altezza: number;
  /** Metri di Mercatore per cella. */
  risoluzioneM: number;
  /** Coordinata y di Mercatore del bordo nord, per ricavare la latitudine. */
  yMax: number;
};

const R = 6378137.0;

/** Latitudine, in radianti, della riga `j` della griglia. */
export function latitudineDi(campi: CampiDirezione, j: number): number {
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
  campi: CampiDirezione, i: number, j: number,
): { di: number; dj: number } | null {
  const ii = Math.floor(i);
  const jj = Math.floor(j);
  if (ii < 0 || jj < 0 || ii >= campi.larghezza || jj >= campi.altezza) return null;
  const k = jj * campi.larghezza + ii;
  const s = campi.sin[k];
  const c = campi.cos[k];
  const t = campi.periodo[k];
  if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
  // Un seno e un coseno che non stanno su un cerchio unitario non sono una
  // direzione: succede dove l'interpolazione fra due ore ha mescolato una cella
  // con dato e una senza. Meglio far rinascere la particella che disegnare una
  // rotta inventata.
  const modulo = Math.hypot(s, c);
  if (modulo < 0.5) return null;

  // Dove l'onda **va**: mezzo giro rispetto a dove viene. Con l'angolo in
  // convenzione nautica, est = sin e nord = cos, quindi il mezzo giro e' un
  // cambio di segno su entrambe le componenti.
  const est = -s / modulo;
  const nord = -c / modulo;

  const metriAlSecondo = VELOCITA_PER_SECONDO_DI_PERIODO * t;
  // Da metri di mare a metri di Mercatore, e da metri di Mercatore a celle.
  const celleAlSecondo = metriAlSecondo / (Math.cos(latitudineDi(campi, jj)) * campi.risoluzioneM);
  // La riga cresce verso sud, quindi il nord e' meno j.
  return { di: est * celleAlSecondo, dj: -nord * celleAlSecondo };
}

export type Particella = {
  i: number;
  j: number;
  /** Le ultime posizioni, dalla piu' vecchia alla piu' recente. */
  scia: number[];
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
  campi: CampiDirezione, caso: () => number, vitaMassima: number,
): Particella {
  const i = caso() * campi.larghezza;
  const j = caso() * campi.altezza;
  return { i, j, scia: [], vita: 1 + Math.floor(caso() * vitaMassima) };
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
  campi: CampiDirezione,
  dt: number,
  caso: () => number,
  vitaMassima: number,
  /** Se aggiungere un punto alla scia in questo fotogramma. */
  registraScia = true,
): void {
  for (let n = 0; n < particelle.length; n++) {
    const p = particelle[n];
    const v = velocitaInCelle(campi, p.i, p.j);
    if (!v || p.vita <= 0) {
      particelle[n] = nasci(campi, caso, vitaMassima);
      continue;
    }
    if (registraScia) {
      p.scia.push(p.i, p.j);
      if (p.scia.length > PUNTI_SCIA * 2) p.scia.splice(0, 2);
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
