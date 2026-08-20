export const VERTICE = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform mat4 u_matrice;
uniform vec4 u_quad;      // xmin, ymin, xmax, ymax in coordinate mercatore [0,1]
void main() {
  vec2 m = mix(u_quad.xy, u_quad.zw, a_pos);
  v_uv = a_pos;
  gl_Position = u_matrice * vec4(m, 0.0, 1.0);
}`;

export const FRAMMENTO = `#version 300 es
precision highp float;
precision highp isampler2D;
in vec2 v_uv;
out vec4 fragColor;

uniform isampler2D u_a;        // frame all'ora t
uniform isampler2D u_b;        // frame all'ora t+1
uniform float u_frazione;      // quanto si e' dentro l'ora
uniform bool u_haB;            // false dentro un buco: non si interpola
uniform sampler2D u_costa;     // distanza con segno dalla costa, positiva in mare
uniform sampler2D u_maschera;  // distanza con segno dal bordo del dato
uniform sampler2D u_palette;   // 256 x 1, RGB
uniform float u_limiteCosta;   // fondoscala della distanza dalla costa, in metri
uniform float u_limiteDato;    // fondoscala della distanza dal dato, in metri
uniform float u_margine;       // quanto stare lontani dalla riva, in metri
uniform vec2 u_dim;            // larghezza, altezza in celle
uniform float u_scala;         // da intero a unita' fisica
uniform float u_minimo;        // fondoscala basso della colorazione
uniform float u_massimo;       // fondoscala alto della colorazione
uniform float u_opacita;

const int NODATA = -32768;

/** Media pesata dei soli campioni validi entro due celle. */
float media(isampler2D tex, vec2 p, out float peso) {
  // La finestra si centra con round e non con floor: con floor scivola di una
  // cella nel momento in cui il frammento attraversa un confine, e i campioni
  // ai margini entrano e escono di colpo, il che si vede.
  ivec2 centro = ivec2(round(p));
  ivec2 ultimo = ivec2(u_dim) - 1;
  float somma = 0.0;
  peso = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 c = centro + ivec2(dx, dy);
      if (c.x < 0 || c.y < 0 || c.x > ultimo.x || c.y > ultimo.y) continue;
      int grezzo = texelFetch(tex, c, 0).r;
      if (grezzo == NODATA) continue;
      // nucleo continuo che si annulla con derivata nulla al proprio bordo:
      // nessun campione entra o esce di colpo
      float w = max(0.0, 1.0 - 0.5 * length(vec2(c) - p));
      w *= w;
      somma += float(grezzo) * w;
      peso += w;
    }
  }
  return peso > 0.0 ? somma / peso : 0.0;
}

void main() {
  // La riga 0 del frame e' quella a nord, mentre v_uv.y vale 0 sul bordo sud
  // del quadrilatero perche' la y di MapLibre cresce verso sud. Senza questo
  // ribaltamento il campo si disegna capovolto, e sembra plausibile: resta una
  // macchia della forma giusta su un mare.
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 p = vec2(uv.x * u_dim.x - 0.5, uv.y * u_dim.y - 0.5);

  // Ritaglio sulla costa vera, con un margine in METRI e non in pixel di
  // schermo: quello che il campo copre a riva sono moli e porti, che sono
  // oggetti geografici, e un margine in pixel vale sempre meno metri man mano
  // che si ingrandisce, cioe' scopre il molo proprio quando non serve piu'.
  float dCosta = (texture(u_costa, uv).r * 2.0 - 1.0) * u_limiteCosta;
  float passo = max(fwidth(dCosta), 0.001);
  float bordo = clamp((dCosta - u_margine) / passo, 0.0, 1.0);
  if (bordo <= 0.0) { fragColor = vec4(0.0); return; }

  // L'opacita' misura quanto si sta estrapolando, e la misura giusta e' la
  // distanza dal BORDO del dato. La distanza dal campione valido piu' vicino,
  // dentro il dato, e' la distanza dal centro del texel: continua ma periodica,
  // cioe' una scacchiera su tutto il mare aperto.
  float dDato = (texture(u_maschera, uv).r * 2.0 - 1.0) * u_limiteDato;
  float dissolvenza = clamp((dDato + 1800.0) / 1200.0, 0.0, 1.0);
  if (dissolvenza <= 0.0) { fragColor = vec4(0.0); return; }

  float pesoA;
  float va = media(u_a, p, pesoA);
  float valore;
  if (u_haB) {
    float pesoB;
    float vb = media(u_b, p, pesoB);
    // Se una delle due ore non ha dato qui, si usa l'altra invece di mediare
    // con zero, che sarebbe un'onda che sprofonda e risale a ogni ora.
    if (pesoA <= 0.0 && pesoB <= 0.0) { fragColor = vec4(0.0); return; }
    if (pesoA <= 0.0) valore = vb;
    else if (pesoB <= 0.0) valore = va;
    else valore = mix(va, vb, u_frazione);
  } else {
    if (pesoA <= 0.0) { fragColor = vec4(0.0); return; }
    valore = va;
  }

  // Fra minimo e massimo, non fra zero e massimo: il livello del mare ha segno,
  // e con la scala ancorata a zero tutti i valori negativi finivano schiacciati
  // nello stesso colore, cioe' meta' del fenomeno sarebbe stata invisibile.
  float t = clamp((valore * u_scala - u_minimo) / (u_massimo - u_minimo), 0.0, 1.0);
  vec3 colore = texture(u_palette, vec2(t, 0.5)).rgb;
  fragColor = vec4(colore, u_opacita * bordo * dissolvenza);
}`;
