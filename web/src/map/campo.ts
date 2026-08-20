import type { CustomLayerInterface, Map as MappaLibre } from "maplibre-gl";
import type { Griglia } from "../data/catalogo";
import { paletteDi } from "./colormap";
import { quadroGriglia } from "./proiezione";
import { FRAMMENTO, VERTICE } from "./shader";

/**
 * Quanto il campo sta lontano dalla riva, in metri.
 *
 * In metri e non in pixel di schermo: quello che il campo copre a riva sono
 * moli, porti e dighe foranee, che sono oggetti geografici. Un margine in pixel
 * vale sempre meno metri man mano che si ingrandisce, quindi la struttura resta
 * coperta proprio allo zoom a cui la si sta guardando.
 */
export const MARGINE_COSTA_M = 250;

export type OpzioniCampo = {
  griglia: Griglia;
  costa: HTMLImageElement;
  maschera: HTMLImageElement;
  limiteCostaM: number;
  limiteDatoM: number;
  palette: string;
  /** Fondoscala basso. Zero per le grandezze positive, negativo per quelle con segno. */
  minimo: number;
  massimo: number;
  scala: number;
  opacita?: number;
};

function compila(gl: WebGL2RenderingContext, tipo: number, sorgente: string): WebGLShader {
  const s = gl.createShader(tipo)!;
  gl.shaderSource(s, sorgente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`shader non compilato: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function texturaR8(gl: WebGL2RenderingContext, immagine: HTMLImageElement): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, immagine);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export class LivelloCampo implements CustomLayerInterface {
  readonly id = "campo";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  /**
   * Chiamato una volta sola, al primo `render()` che disegna davvero con una
   * texture di dati caricata (non al montaggio del livello, non
   * all'arrivo del fotogramma dalla rete): e' l'aggancio che i test end to
   * end usano per sapere che sul canvas c'e' un colore vero da leggere,
   * invece di indovinarlo da fuori con un segnale che significa altro.
   *
   * Prima di questo campo, `web/src/ui/MapView.tsx` alzava `__primoFrame`
   * appena la mappa era montata: un nome che prometteva "il primo
   * fotogramma c'e'" e voleva dire solo "la mappa e' pronta". Nel mezzo,
   * `vaiA()` disegna subito con quello che trova in cache (spesso niente) e
   * chiede il resto in modo asincrono: fra il montaggio e l'arrivo del
   * fotogramma vero, il livello disegna con una texture allocata ma mai
   * popolata (vedi `texturaDato`, che non chiama `texImage2D` finche' non
   * arriva un dato vero), che su un renderer software si legge come un
   * colore casuale invece che come nodata trasparente. Un test che
   * aspettava quel segnale non aspettava niente di preciso, e diventava
   * intermittente sulle macchine lente.
   */
  alPrimoDisegno?: () => void;

  private programma: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private texA: WebGLTexture | null = null;
  private texB: WebGLTexture | null = null;
  private texCosta: WebGLTexture | null = null;
  private texMaschera: WebGLTexture | null = null;
  private texPalette: WebGLTexture | null = null;
  private frazione = 0;
  private haB = false;
  private haDatoCaricato = false;
  private primoDisegnoSegnalato = false;
  // Le chiavi (vedi Prefetcher.chiave) dei due fotogrammi gia' caricati nelle
  // texture: imposta() le confronta prima di richiamare texImage2D, che senza
  // questo controllo viene chiamato a ogni fotogramma di rAF (fino a 60 volte
  // al secondo) anche quando i due frame da disegnare sono ancora gli stessi
  // e solo la frazione di interpolazione e' cambiata. Su una griglia di
  // 858x844 int16 sono circa 1,4 MB per texture: a 60 fps e due texture, quasi
  // 174 MB al secondo verso la GPU per aggiornare un dato che in realta'
  // cambia quattro volte al secondo.
  private chiaveA: string | null = null;
  private chiaveB: string | null = null;
  private quad = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private mappa: MappaLibre | null = null;
  // Salvato da onAdd, che e' l'unico modo pubblico di avere il contesto: MapLibre
  // lo passa gia' come parametro. Frugare dentro campi interni non documentati
  // (per esempio painter.context.gl) degrada in silenzio se una versione futura
  // li rinomina o li sposta: il livello smetterebbe di aggiornare le texture
  // senza sollevare niente, e il difetto sembrerebbe stare nel ciclo di
  // animazione invece che qui.
  private gl: WebGL2RenderingContext | null = null;

  constructor(private opzioni: OpzioniCampo) {}

  onAdd(mappa: MappaLibre, gl: WebGL2RenderingContext): void {
    this.mappa = mappa;
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new Error(
        "contesto WebGL1: il campo ha bisogno di WebGL2 per le texture intere. " +
          "Con WebGL1 non esiste isampler2D e il nodata non si potrebbe distinguere.",
      );
    }
    this.gl = gl;

    this.programma = gl.createProgram()!;
    gl.attachShader(this.programma, compila(gl, gl.VERTEX_SHADER, VERTICE));
    gl.attachShader(this.programma, compila(gl, gl.FRAGMENT_SHADER, FRAMMENTO));
    gl.linkProgram(this.programma);
    if (!gl.getProgramParameter(this.programma, gl.LINK_STATUS)) {
      throw new Error(`programma non collegato: ${gl.getProgramInfoLog(this.programma)}`);
    }

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.texA = this.texturaDato(gl);
    this.texB = this.texturaDato(gl);
    this.texCosta = texturaR8(gl, this.opzioni.costa);
    this.texMaschera = texturaR8(gl, this.opzioni.maschera);
    this.texPalette = this.texturaPalette(gl, this.opzioni.palette);

    // Il quadrilatero in coordinate mercatore normalizzate di MapLibre. La y
    // cresce verso sud, quindi il nord ha la y piu' PICCOLA: scriverlo al
    // contrario disegna il campo capovolto senza nessun errore.
    this.quad = quadroGriglia(this.opzioni.griglia.boundsLonLat);
  }

  onRemove(_mappa: MappaLibre, gl: WebGL2RenderingContext): void {
    for (const t of [this.texA, this.texB, this.texCosta, this.texMaschera, this.texPalette]) {
      if (t) gl.deleteTexture(t);
    }
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.programma) gl.deleteProgram(this.programma);
    this.gl = null;
  }

  /**
   * Il campo da disegnare: l'ora t (chiave chiaveA), l'ora t+1 se c'e' (chiave
   * chiaveB), e quanto si e' dentro.
   *
   * Le chiavi sono quelle che Prefetcher.chiave() gia' costruisce per
   * indicizzare la cache: chi chiama (Animazione.disegna) le ha gia' in mano,
   * quindi passarle qui non costa una scelta di identita' in piu'. Servono
   * solo a riconoscere "e' lo stesso fotogramma di prima": la texture non si
   * ricarica se la chiave non e' cambiata, u_frazione resta un uniform e la
   * fusione fra i due fotogrammi continua a funzionare a ogni chiamata.
   */
  imposta(a: Int16Array, chiaveA: string, b: Int16Array | null, chiaveB: string | null, frazione: number): void {
    if (!this.gl) return;
    if (chiaveA !== this.chiaveA) {
      this.carica(this.gl, this.texA!, a);
      this.chiaveA = chiaveA;
    }
    this.haB = b !== null;
    if (b && chiaveB !== this.chiaveB) {
      this.carica(this.gl, this.texB!, b);
    }
    this.chiaveB = b ? chiaveB : null;
    this.frazione = frazione;
    // Da qui in poi le texture contengono un fotogramma vero: il prossimo
    // render() e' quello che alPrimoDisegno aspetta.
    this.haDatoCaricato = true;
    this.mappa?.triggerRepaint();
  }

  impostaEstremi(minimo: number, massimo: number): void {
    this.opzioni = { ...this.opzioni, minimo, massimo };
    this.mappa?.triggerRepaint();
  }

  /**
   * Cambia il fattore di scala dei valori grezzi.
   *
   * Serve quando cambia la grandezza disegnata: l'altezza d'onda e' archiviata
   * a millesimi di metro, il periodo a centesimi di secondo. Senza questo, il
   * livello resterebbe con la scala della grandezza con cui e' stato costruito
   * e disegnerebbe un campo dieci volte sbagliato: non si vede come un errore,
   * si vede come un mare diverso.
   */
  impostaScala(scala: number): void {
    this.opzioni = { ...this.opzioni, scala };
    this.mappa?.triggerRepaint();
  }

  impostaPalette(nome: string): void {
    if (this.gl && this.texPalette) this.gl.deleteTexture(this.texPalette);
    if (this.gl) this.texPalette = this.texturaPalette(this.gl, nome);
    this.opzioni = { ...this.opzioni, palette: nome };
    this.mappa?.triggerRepaint();
  }

  // Il tipo dell'interfaccia dichiara `render` come proprieta' (non come
  // metodo), quindi TypeScript controlla il parametro `gl` in modo rigido:
  // va accettato esattamente WebGLRenderingContext | WebGL2RenderingContext,
  // non solo il secondo, anche se qui si usa sempre e solo un contesto
  // WebGL2 (lo garantisce onAdd). E' uno scostamento dal brief, spiegato nel
  // rapporto: con la 5.24 installata `gl: WebGL2RenderingContext` da solo
  // non compila.
  render(gl: WebGLRenderingContext | WebGL2RenderingContext, arg: unknown): void {
    // La firma cambia fra le versioni: MapLibre 4 passa la matrice, la 5 passa
    // un oggetto. Accettare entrambe costa tre righe e evita che un
    // aggiornamento minore smetta di disegnare senza dire niente.
    const matrice = Array.isArray(arg) || ArrayBuffer.isView(arg)
      ? (arg as Float32Array)
      : (arg as { defaultProjectionData?: { mainMatrix?: Float32Array } })
          ?.defaultProjectionData?.mainMatrix;
    if (!matrice || !this.programma) return;

    gl.useProgram(this.programma);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const posizione = gl.getAttribLocation(this.programma, "a_pos");
    gl.enableVertexAttribArray(posizione);
    gl.vertexAttribPointer(posizione, 2, gl.FLOAT, false, 0, 0);

    const u = (nome: string) => gl.getUniformLocation(this.programma!, nome);
    gl.uniformMatrix4fv(u("u_matrice"), false, matrice);
    gl.uniform4f(u("u_quad"), this.quad.x0, this.quad.y0, this.quad.x1, this.quad.y1);
    gl.uniform2f(u("u_dim"), this.opzioni.griglia.larghezza, this.opzioni.griglia.altezza);
    gl.uniform1f(u("u_scala"), this.opzioni.scala);
    gl.uniform1f(u("u_minimo"), this.opzioni.minimo);
    gl.uniform1f(u("u_massimo"), this.opzioni.massimo);
    gl.uniform1f(u("u_limiteCosta"), this.opzioni.limiteCostaM);
    gl.uniform1f(u("u_limiteDato"), this.opzioni.limiteDatoM);
    gl.uniform1f(u("u_margine"), MARGINE_COSTA_M);
    gl.uniform1f(u("u_frazione"), this.frazione);
    gl.uniform1i(u("u_haB"), this.haB ? 1 : 0);
    gl.uniform1f(u("u_opacita"), this.opzioni.opacita ?? 0.88);

    const unita: [WebGLTexture | null, string][] = [
      [this.texA, "u_a"], [this.texB, "u_b"], [this.texCosta, "u_costa"],
      [this.texMaschera, "u_maschera"], [this.texPalette, "u_palette"],
    ];
    unita.forEach(([tex, nome], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u(nome), i);
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Il momento vero, non al montaggio ne' all'arrivo dalla rete: qui si e'
    // appena disegnato usando una texture che imposta() ha davvero
    // popolato. Una volta sola, altrimenti ogni fotogramma successivo
    // richiamerebbe l'aggancio dei test.
    if (this.haDatoCaricato && !this.primoDisegnoSegnalato) {
      this.primoDisegnoSegnalato = true;
      this.alPrimoDisegno?.();
    }
  }

  private texturaDato(gl: WebGL2RenderingContext): WebGLTexture {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private carica(gl: WebGL2RenderingContext, tex: WebGLTexture, dato: Int16Array): void {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    // R16I e non R16UI: il dato e' int16 con segno, e con una texture senza
    // segno il confronto col nodata diventerebbe un numero magico diverso da
    // quello scritto nel formato.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, this.opzioni.griglia.larghezza,
                  this.opzioni.griglia.altezza, 0, gl.RED_INTEGER, gl.SHORT, dato);
  }

  private texturaPalette(gl: WebGL2RenderingContext, nome: string): WebGLTexture {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                  paletteDi(nome));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
}

