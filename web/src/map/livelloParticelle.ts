import type { CustomLayerInterface, Map as MappaLibre } from "maplibre-gl";
import type { Griglia } from "../data/catalogo";
import {
  avanza, cresta, mescolaCampo, nasci,
  type CampiDirezione, type Particella,
} from "./particelle";
import { quadroGriglia } from "./proiezione";

/**
 * L'animazione della direzione dell'onda: creste che avanzano.
 *
 * Il moto vero sta in `particelle.ts`, che si prova senza aprire un browser.
 * Qui c'e' solo il disegno.
 *
 * **Le particelle si muovono anche a tempo fermo**, ed e' voluto: servono a
 * leggere una direzione, e una direzione ferma non si legge. Quindi il loro
 * tempo non e' quello del mare. Le velocita' **relative** pero' sono fisiche
 * (un'onda di periodo doppio corre il doppio, vedi `velocitaInCelle`): quello
 * che e' una scelta di resa e' solo il fattore comune, scelto perche' il moto
 * sia leggibile.
 *
 * Il fattore si ricalcola col livello di zoom. Se fosse fisso, le particelle
 * andrebbero a un pixel al secondo su tutto l'Adriatico e a duecento dentro un
 * porto: la stessa animazione sarebbe illeggibile a un capo e inguardabile
 * all'altro.
 */

/**
 * Quanti pixel al secondo deve percorrere un'onda di periodo tipico (3,5 s).
 *
 * **Venti e non quarantacinque, e il numero sta insieme alla taglia della
 * cresta.** Quarantacinque erano stati scelti quando la marca era una scia lunga
 * una quarantina di pixel: un oggetto cosi' a quella velocita' avanza 1,13 volte
 * la propria lunghezza al secondo, quindi si sovrappone sempre a dov'era, e il
 * moto si legge come scorrimento. La cresta ha perso l'estensione **lungo il
 * moto** (18 px in largo, 2,7 di gobba in lungo), e gli stessi 45 px/s sono
 * diventati 2,5 larghezze al secondo: velocita' vera identica (misurata sulla
 * mappa, mediana 48,5 px/s) e velocita' apparente piu' che doppia. Segnalato
 * guardando la mappa il 2026-08-21, con le creste appena messe.
 *
 * Venti riporta il rapporto a 1,11 larghezze al secondo, cioe' la stessa cifra
 * delle scie, che nessuno aveva trovato veloce. Il legame fra i due numeri e'
 * tenuto da `test/velocitaCreste.test.ts`, se no la prossima volta che la cresta
 * cambia taglia la velocita' apparente cambia di nuovo in silenzio.
 *
 * Resta una scelta di resa: le velocita' **relative** sono fisiche (un'onda di
 * periodo doppio corre il doppio), e questo e' solo il fattore comune.
 */
export const VELOCITA_A_SCHERMO_PX_S = 20;
const PERIODO_TIPICO_S = 3.5;

/**
 * Quante creste.
 *
 * Giudicato a occhio il 2026-08-21, sulla mappa vera a zoom 8: seicento (il
 * primo tentativo, un terzo delle duemila particelle di prima) davano marche
 * sparse invece di una direzione, milleduecento si leggevano a zone.
 * Milleottocento e' inchiostro paragonabile alle duemila scie di prima, e a
 * quella densita' il **disegno** del campo si legge, cioe' la curvatura delle
 * creste che si allineano avvicinandosi alla costa.
 *
 * Da rivedere se le creste cambiano taglia: la densita' che conta e' quanta
 * parte dello schermo coprono, non quante sono.
 */
const QUANTE = 1800;

/**
 * Mezza cresta, in pixel di schermo.
 *
 * In pixel e non in metri di mare, per la stessa ragione del fattore di
 * velocita': a zoom 7 una cella e' un pixel e a zoom 15 sono 349, quindi una
 * lunghezza fisica sarebbe invisibile a un capo e ingombrante all'altro. La
 * lunghezza d'onda **vera** non e' un'opzione: in acqua profonda vale
 * `g T al quadrato / 2 pi`, cioe' 85 m col periodo piu' lungo dell'archivio
 * (7,37 s), che a zoom 11 sono 1,5 pixel. Sopra, dove si vedrebbe, una cella
 * del modello e' larga 349 pixel: si disegnerebbero quattordici creste dentro
 * una cella, cioe' una tessitura che promette una risoluzione che il dato non
 * ha. Il periodo continua a parlare **con la velocita'**, dove e' onesto.
 */
export const SEMI_CRESTA_PX = 9;

/**
 * Quanto l'arco gonfia in avanti, in frazione della semilunghezza.
 *
 * Due decimi e non tre, scelto a occhio il 2026-08-21 confrontando le due
 * schermate: con tre la marca si legge come un gabbiano invece che come una
 * cresta, e insieme ai capi sfumati sembrava piu' corta dei suoi diciotto
 * pixel. Con due la cresta si legge come una **linea**, che e' cio' che una
 * cresta e', e la gobba basta ancora a dire da che parte va (vedi `cresta`,
 * dove sta scritto perche' la gobba esiste e perche' non e' fisica).
 */
const BOMBATURA = 0.2;

/** In quanti segmenti si spezza l'arco. Quattro bastano per 18 pixel. */
const SEGMENTI = 4;

/** Dopo quanti fotogrammi una particella rinasce comunque. */
const VITA_MASSIMA = 180;

const VERTICE = `#version 300 es
in vec2 a_pos;
in float a_peso;
uniform mat4 u_matrice;
out float v_peso;
void main() {
  v_peso = a_peso;
  gl_Position = u_matrice * vec4(a_pos, 0.0, 1.0);
}`;

const FRAMMENTO = `#version 300 es
precision highp float;
in float v_peso;
out vec4 fragColor;
uniform vec3 u_colore;
uniform float u_opacita;
void main() {
  // La cresta sfuma **verso i capi**, non verso la coda: mille e ottocento archi
  // tutti a piena opacita' si leggono come un tartan e non come un mare. Il
  // verso non lo porta piu' la sbiadita ma la convessita' dell'arco, che vale
  // anche a riproduzione ferma (vedi cresta() in particelle.ts).
  //
  // Parte da 0,55 e non da 0,35: con 0,35 i capi svanivano e la cresta si
  // leggeva piu' corta di quello che e'. Guardato a schermo il 2026-08-21.
  fragColor = vec4(u_colore, u_opacita * (0.55 + 0.45 * v_peso));
}`;

function compila(gl: WebGL2RenderingContext, tipo: number, sorgente: string): WebGLShader {
  const s = gl.createShader(tipo)!;
  gl.shaderSource(s, sorgente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`shader particelle: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

export class LivelloParticelle implements CustomLayerInterface {
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  private programma: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private mappa: MappaLibre | null = null;
  private particelle: Particella[] = [];
  private campi: CampiDirezione | null = null;
  private quad = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private ultimoTempo = 0;
  private fotogramma = 0;
  // Ogni cresta sono SEGMENTI linee, cioe' due vertici per segmento, tre
  // float per vertice (x, y, peso).
  private vertici = new Float32Array(QUANTE * SEGMENTI * 2 * 3);
  private caso = Math.random;
  /**
   * Quello che l'ultimo fotogramma ha davvero disegnato.
   *
   * Non e' avanzo di debug: un'animazione che non si vede puo' essere spenta
   * per cinque ragioni diverse (campi assenti, particelle non nate, vertici
   * degeneri, fattore nullo, zoom senza pixel per cella) e a schermo sono tutte
   * identiche, cioe' niente. Trovare la ragione giusta e' costato un'ora la
   * prima volta; questi cinque numeri la danno in un colpo, e il test end to
   * end li legge invece di guardare i pixel.
   */
  diagnosi = { campi: false, particelle: 0, vertici: 0, fattore: 0, pixelPerCella: 0 };

  constructor(readonly id: string, private griglia: Griglia) {}

  onAdd(mappa: MappaLibre, glGrezzo: WebGLRenderingContext | WebGL2RenderingContext): void {
    const gl = glGrezzo as WebGL2RenderingContext;
    this.mappa = mappa;
    this.quad = quadroGriglia(this.griglia.boundsLonLat);
    const p = gl.createProgram()!;
    gl.attachShader(p, compila(gl, gl.VERTEX_SHADER, VERTICE));
    gl.attachShader(p, compila(gl, gl.FRAGMENT_SHADER, FRAMMENTO));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`programma particelle: ${gl.getProgramInfoLog(p)}`);
    }
    this.programma = p;
    this.buffer = gl.createBuffer();
  }

  onRemove(_mappa: MappaLibre, glGrezzo: WebGLRenderingContext | WebGL2RenderingContext): void {
    const gl = glGrezzo as WebGL2RenderingContext;
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.programma) gl.deleteProgram(this.programma);
    this.buffer = null;
    this.programma = null;
  }

  /** I tre campi dell'istante disegnato, gia' mescolati fra le due ore. */
  imposta(
    sinA: Int16Array, sinB: Int16Array | null,
    cosA: Int16Array, cosB: Int16Array | null,
    perA: Int16Array, perB: Int16Array | null,
    frazione: number, scalaAngolo: number, scalaPeriodo: number,
  ): void {
    this.campi = {
      sin: mescolaCampo(sinA, sinB, frazione, scalaAngolo),
      cos: mescolaCampo(cosA, cosB, frazione, scalaAngolo),
      periodo: mescolaCampo(perA, perB, frazione, scalaPeriodo),
      larghezza: this.griglia.larghezza,
      altezza: this.griglia.altezza,
      risoluzioneM: this.griglia.risoluzioneM,
      yMax: 0,
    };
    this.campi.yMax = quadroA_yMaxMercatore(this.griglia);
    if (this.particelle.length === 0) {
      this.particelle = Array.from({ length: QUANTE }, () => nasci(this.campi!, this.caso, VITA_MASSIMA));
    }
    this.mappa?.triggerRepaint();
  }

  /** Toglie il campo: le particelle spariscono invece di restare su un dato vecchio. */
  svuota(): void {
    this.campi = null;
    this.particelle = [];
    // La diagnosi va azzerata insieme: `render` esce subito quando non c'e'
    // campo, quindi senza questa riga continuerebbe a dichiarare i vertici
    // dell'ultimo fotogramma disegnato, cioe' affermerebbe di star disegnando
    // qualcosa che non disegna piu'.
    this.diagnosi = { campi: false, particelle: 0, vertici: 0, fattore: 0, pixelPerCella: 0 };
  }

  private aMappa(i: number, j: number): [number, number] {
    return [
      this.quad.x0 + (i / this.griglia.larghezza) * (this.quad.x1 - this.quad.x0),
      this.quad.y1 + (j / this.griglia.altezza) * (this.quad.y0 - this.quad.y1),
    ];
  }

  // Stessa firma larga del livello del campo: con MapLibre 5.24 il tipo
  // dichiarato ammette anche WebGL1, e restringerlo qui non compila.
  render(glGrezzo: WebGLRenderingContext | WebGL2RenderingContext, arg: unknown): void {
    const gl = glGrezzo as WebGL2RenderingContext;
    if (!this.programma || !this.campi || !this.mappa) return;
    const matrice = Array.isArray(arg) || ArrayBuffer.isView(arg)
      ? (arg as Float32Array | number[])
      : (arg as { defaultProjectionData?: { mainMatrix?: Float32Array } })
        ?.defaultProjectionData?.mainMatrix;
    if (!matrice) return;

    const adesso = performance.now();
    // Il primo fotogramma non ha un "prima": mezzo secondo di scatto iniziale
    // sarebbe l'unica cosa che si nota di un'animazione altrimenti continua.
    const dt = this.ultimoTempo === 0 ? 0 : Math.min(0.1, (adesso - this.ultimoTempo) / 1000);
    this.ultimoTempo = adesso;

    // Da celle al secondo a pixel al secondo: una cella vale tanti pixel quanti
    // il livello di zoom decide, e il fattore comune si aggiusta perche' il
    // moto resti leggibile a ogni scala.
    const pixelPerCella = this.pixelPerCella();
    const celleTipicheAlSecondo =
      (1.5613 * PERIODO_TIPICO_S) / (Math.cos(0.77) * this.griglia.risoluzioneM);
    const fattore = pixelPerCella > 0
      ? VELOCITA_A_SCHERMO_PX_S / (pixelPerCella * celleTipicheAlSecondo)
      : 0;
    if (dt > 0 && fattore > 0) {
      this.fotogramma++;
      avanza(this.particelle, this.campi, dt * fattore, this.caso, VITA_MASSIMA);
    }

    this.diagnosi = {
      campi: Boolean(this.campi), particelle: this.particelle.length,
      vertici: 0, fattore, pixelPerCella,
    };
    // La semilunghezza si chiede in pixel e si passa in celle: la geometria
    // della cresta e' pura e non sa niente di zoom.
    const semiCelle = pixelPerCella > 0 ? SEMI_CRESTA_PX / pixelPerCella : 0;
    let n = 0;
    for (const p of this.particelle) {
      const punti = semiCelle > 0
        ? cresta(this.campi, p.i, p.j, semiCelle, BOMBATURA, SEGMENTI)
        : null;
      // Niente cresta dove non c'e' direzione: la particella rinascera' al
      // prossimo giro, e un arco inventato affermerebbe un verso che non c'e'.
      if (!punti) continue;
      const quanti = punti.length / 2;
      for (let k = 1; k < quanti; k++) {
        for (const indice of [k - 1, k]) {
          const [x, y] = this.aMappa(punti[indice * 2], punti[indice * 2 + 1]);
          this.vertici[n++] = x;
          this.vertici[n++] = y;
          // Pieno al centro, spento ai capi: 1 - |s|, con s da -1 a 1.
          this.vertici[n++] = 1 - Math.abs(-1 + (2 * indice) / (quanti - 1));
        }
      }
    }
    this.diagnosi.vertici = n / 3;
    if (n === 0) { this.mappa.triggerRepaint(); return; }

    gl.useProgram(this.programma);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertici.subarray(0, n), gl.DYNAMIC_DRAW);
    const pos = gl.getAttribLocation(this.programma, "a_pos");
    const peso = gl.getAttribLocation(this.programma, "a_peso");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(peso);
    gl.vertexAttribPointer(peso, 1, gl.FLOAT, false, 12, 8);
    const u = (nome: string) => gl.getUniformLocation(this.programma!, nome);
    gl.uniformMatrix4fv(u("u_matrice"), false, matrice);
    // Inchiostro scuro, come le isolinee: il campo estivo e' chiaro, e centinaia
    // di segni bianchi sopra un giallo pallido non si leggono come movimento ma
    // come una foschia che sbiadisce il colore sotto.
    gl.uniform3f(u("u_colore"), 0.08, 0.09, 0.11);
    gl.uniform1f(u("u_opacita"), 0.95);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.drawArrays(gl.LINES, 0, n / 3);

    this.mappa.triggerRepaint();
  }

  /** Quanti pixel di schermo vale una cella della griglia, al centro della vista. */
  private pixelPerCella(): number {
    const m = this.mappa;
    if (!m) return 0;
    const c = m.getCenter();
    const a = m.project([c.lng, c.lat]);
    const gradiPerCella = (this.griglia.boundsLonLat.est - this.griglia.boundsLonLat.ovest)
      / this.griglia.larghezza;
    const b = m.project([c.lng + gradiPerCella, c.lat]);
    return Math.abs(b.x - a.x);
  }
}

/** La y di Mercatore del bordo nord, in metri: serve alla correzione di latitudine. */
function quadroA_yMaxMercatore(griglia: Griglia): number {
  const R = 6378137.0;
  const lat = (griglia.boundsLonLat.nord * Math.PI) / 180;
  return R * Math.log(Math.tan(Math.PI / 4 + lat / 2));
}
