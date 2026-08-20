import { describe, expect, it } from "vitest";
import { NODATA } from "../src/data/frame";
import {
  aLonLat, isolineeDi, liscia, mescola, suUnBordo, type GrigliaIsolinee,
} from "../src/map/isolineeGeometria";
import { SOGLIE } from "../src/map/soglie";

const G: GrigliaIsolinee = {
  larghezza: 20, altezza: 16, risoluzioneM: 1200,
  // angolo nord-ovest inventato ma coerente: quel che conta e' il giro completo
  xMin: 1_200_000, yMax: 5_600_000,
};

/** Mare uniforme, con una cornice di celle senza dato tutt'attorno. */
function mareConCornice(valore: number, spessore = 2): Float64Array {
  const c = new Float64Array(G.larghezza * G.altezza).fill(NaN);
  for (let j = spessore; j < G.altezza - spessore; j++) {
    for (let i = spessore; i < G.larghezza - spessore; i++) c[j * G.larghezza + i] = valore;
  }
  return c;
}

describe("il campo mescolato", () => {
  it("interpola fra le due ore come lo shader", () => {
    const a = Int16Array.from([100, 200]);
    const b = Int16Array.from([300, 400]);
    const c = mescola(a, b, 0.5, 0.001, 0);
    expect(Array.from(c)).toEqual([0.2, 0.3]);
  });

  it("se una delle due ore non ha dato usa l'altra, non media con zero", () => {
    // mediare con zero sarebbe un'onda che sprofonda e risale a ogni ora
    const a = Int16Array.from([NODATA, 200]);
    const b = Int16Array.from([300, NODATA]);
    const c = mescola(a, b, 0.5, 0.001, 0);
    expect(Array.from(c)).toEqual([0.3, 0.2]);
  });

  it("dove non ha dato nessuna delle due mette NaN", () => {
    const a = Int16Array.from([NODATA]);
    const b = Int16Array.from([NODATA]);
    expect(Number.isNaN(mescola(a, b, 0.5, 0.001, 0)[0])).toBe(true);
  });
});

describe("il taglio sul bordo del dato", () => {
  it("un mare uniforme circondato da buchi non produce nessuna linea", () => {
    // E' il difetto che il taglio esiste per evitare: senza, ogni costa
    // porterebbe una falsa isolinea di 0,1 m che e' solo il contorno del
    // dominio. Misurato con d3-contour: quella situazione produce un anello.
    const campo = mareConCornice(0.3);
    const fc = isolineeDi(campo, G, SOGLIE);
    expect(fc.features).toHaveLength(0);
  });

  it("ma senza il taglio quell'anello ci sarebbe, quindi il test discrimina", () => {
    // stessa forma, senza buchi: la cornice vale 0 invece di NaN, e la soglia
    // piu' bassa trova un confine vero
    const campo = mareConCornice(0.3);
    for (let i = 0; i < campo.length; i++) if (Number.isNaN(campo[i])) campo[i] = 0;
    const fc = isolineeDi(campo, G, SOGLIE);
    expect(fc.features.length).toBeGreaterThan(0);
    expect(fc.features.every((f) => f.properties!.valore === 0.1)).toBe(true);
  });

  it("un vertice accanto a una cella senza dato sta su un bordo", () => {
    const campo = mareConCornice(0.3);
    // il centro della prima cella con dato confina con una cella senza dato,
    // quindi conta come bordo: e' il caso che il blocco 2x2 si perdeva
    expect(suUnBordo(campo, G, 2.5, 2.5)).toBe(true);
    // e ovviamente il confine fra la cella 1 (senza dato) e la 2, che sta a 2,0
    expect(suUnBordo(campo, G, 2.0, 5.0)).toBe(true);
    // una cella piu' dentro invece no
    expect(suUnBordo(campo, G, 4.5, 5.5)).toBe(false);
    expect(suUnBordo(campo, G, 10.5, 8.5)).toBe(false);  // in mezzo al mare
    expect(suUnBordo(campo, G, -1, 5)).toBe(true);       // fuori dalla griglia
    // e un vertice NaN, che d3-contour produce interpolando contro un buco
    expect(suUnBordo(campo, G, NaN, 5)).toBe(true);
  });
});

describe("le linee prodotte", () => {
  /** Una rampa che attraversa piu' soglie, senza buchi. */
  function rampa(): Float64Array {
    const c = new Float64Array(G.larghezza * G.altezza);
    for (let j = 0; j < G.altezza; j++) {
      for (let i = 0; i < G.larghezza; i++) c[j * G.larghezza + i] = (i / (G.larghezza - 1)) * 3;
    }
    return c;
  }

  it("attraversa solo le soglie dichiarate", () => {
    const fc = isolineeDi(rampa(), G, SOGLIE);
    const valori = [...new Set(fc.features.map((f) => f.properties!.valore as number))];
    expect(valori.length).toBeGreaterThan(0);
    for (const v of valori) expect(SOGLIE.map((s) => s.valore)).toContain(v);
    // la rampa arriva a 3: sopra quel valore non ci puo' essere niente
    expect(Math.max(...valori)).toBeLessThanOrEqual(2.5);
  });

  it("il numero c'e' se e solo se la soglia ha un nome", () => {
    const fc = isolineeDi(rampa(), G, SOGLIE);
    for (const f of fc.features) {
      const p = f.properties!;
      // ogni soglia e' un confine di classe Douglas, quindi porta sempre il
      // numero; il nome del grado sta accanto al valore misurato, non qui
      expect(p.nome).toBe(true);
      expect(String(p.etichetta)).toMatch(/^\d+(,\d+)? m$/);
    }
  });

  it("le coordinate sono longitudine e latitudine, non indici di griglia", () => {
    const fc = isolineeDi(rampa(), G, SOGLIE);
    for (const f of fc.features) {
      for (const [lon, lat] of (f.geometry as GeoJSON.LineString).coordinates as [number, number][]) {
        expect(lon).toBeGreaterThan(-180);
        expect(lon).toBeLessThan(180);
        expect(lat).toBeGreaterThan(-85);
        expect(lat).toBeLessThan(85);
      }
    }
  });
});

describe("la conversione dalla griglia", () => {
  it("il centro della prima cella cade dove lo mette d3-contour", () => {
    // d3-contour mette il centro della cella (i, j) a (i + 0,5, j + 0,5):
    // verificato con una griglia a una sola cella accesa. Sbagliare lo scarto
    // sposterebbe ogni linea di mezza cella, cioe' 600 m.
    const [lon0, lat0] = aLonLat(G, 0.5, 0.5);
    const [lon1] = aLonLat(G, 1.5, 0.5);
    const passoLon = lon1 - lon0;
    // mezza cella a est dell'angolo, e il passo vale una cella
    expect(passoLon).toBeGreaterThan(0);
    expect(lat0).toBeLessThan(aLonLat(G, 0.5, -0.5)[1]);   // la riga 0 e' a nord
  });
});

describe("lo smusso degli spigoli", () => {
  /** Una L: due tratti lunghi e uno spigolo di 90 gradi in mezzo. */
  const elle: [number, number][] = [[0, 0], [10, 0], [10, 10]];

  /** L'angolo piu' grande fra due segmenti adiacenti, in gradi. */
  function angoloMassimo(p: [number, number][]): number {
    let massimo = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]);
      const b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
      const d = Math.abs((((b - a) * 180) / Math.PI + 540) % 360 - 180);
      if (d > massimo) massimo = d;
    }
    return massimo;
  }

  /** Quanto si e' spostata la linea: distanza massima dai segmenti di partenza. */
  function scostamento(prima: [number, number][], dopo: [number, number][]): number {
    let massimo = 0;
    for (const q of dopo) {
      let vicino = Infinity;
      for (let i = 1; i < prima.length; i++) {
        vicino = Math.min(vicino, Math.sqrt(distanzaDaSegmento(q, prima[i - 1], prima[i])));
      }
      massimo = Math.max(massimo, vicino);
    }
    return massimo;
  }

  function distanzaDaSegmento(p: [number, number], a: [number, number], b: [number, number]): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const den = dx * dx + dy * dy;
    let t = den > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
    return qx * qx + qy * qy;
  }

  it("abbatte l'angolo, che e' il motivo per cui esiste", () => {
    // MapLibre non piega un'etichetta oltre 60 gradi: sopra quella soglia il
    // numero non compare. Misurato sul campo vero: spigoli fino a 130 gradi.
    expect(angoloMassimo(elle)).toBe(90);
    expect(angoloMassimo(liscia(elle))).toBeLessThan(30);
  });

  it("non sposta la linea piu' di mezza cella, cioe' meno di quanto il dato sappia", () => {
    expect(scostamento(elle, liscia(elle))).toBeLessThanOrEqual(0.5);
  });

  it("su un segmento lungo il taglio si ferma al raggio invece di prendersene un quarto", () => {
    // Chaikin puro qui sposterebbe i punti di 2,5 unita': su un'isolinea vera
    // vorrebbe dire spostarla di chilometri per smussare un angolo.
    const lunga: [number, number][] = [[0, 0], [10, 0], [20, 0.001]];
    expect(scostamento(lunga, liscia(lunga))).toBeLessThanOrEqual(0.5);
  });

  it("un anello resta chiuso e non tiene lo spigolo della cucitura", () => {
    // Un quadrato chiuso: senza il giro in cerchio, il punto di partenza
    // resterebbe uno spigolo di 90 gradi, cioe' proprio dove nessuno si
    // aspetta che l'anello cominci.
    const quadrato: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const liscio = liscia(quadrato);
    expect(liscio[0]).toEqual(liscio[liscio.length - 1]);
    const ciclico = [...liscio, liscio[1], liscio[2]];
    expect(angoloMassimo(ciclico)).toBeLessThan(30);
  });

  it("una linea di due punti resta com'e'", () => {
    expect(liscia([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });
});

describe("il numero sulle isolinee", () => {
  /** Una macchia tonda sopra soglia in mezzo al mare: e' la "bolla" al largo. */
  function bolla(raggio: number): Float64Array {
    const c = new Float64Array(G.larghezza * G.altezza).fill(0.3);
    const ci = G.larghezza / 2, cj = G.altezza / 2;
    for (let j = 0; j < G.altezza; j++) {
      for (let i = 0; i < G.larghezza; i++) {
        if (Math.hypot(i - ci, j - cj) <= raggio) c[j * G.larghezza + i] = 0.7;
      }
    }
    return c;
  }

  it("un anello chiuso porta il suo numero, che e' il caso che non funzionava", () => {
    // Con `symbol-placement: line` MapLibre decideva lei dove mettere il
    // numero, e sugli anelli chiusi al largo non lo metteva: misurato sul campo
    // del 20/08/2026, 228 linee con nome e 6 numeri a schermo. L'ancora adesso
    // la calcoliamo noi, quindi il caso e' verificabile qui.
    const fc = isolineeDi(bolla(5), G, SOGLIE);
    const linee = fc.features.filter((f) => f.geometry.type === "LineString");
    const numeri = fc.features.filter((f) => f.geometry.type === "Point");
    expect(linee.length).toBeGreaterThan(0);
    const anello = linee[0].geometry as GeoJSON.LineString;
    expect(anello.coordinates[0]).toEqual(anello.coordinates[anello.coordinates.length - 1]);
    expect(numeri).toHaveLength(1);
    expect(numeri[0].properties!.etichetta).toBe("0,5 m");
    expect(numeri[0].properties!.valore).toBe(0.5);
    expect(Number.isFinite(numeri[0].properties!.gradi as number)).toBe(true);
  });

  it("una macchia piccola non porta nessun numero", () => {
    // Un numero su una scheggia da pochi punti e' una cifra che galleggia:
    // sotto la lunghezza minima si disegna la linea e basta.
    const fc = isolineeDi(bolla(1), G, SOGLIE);
    expect(fc.features.filter((f) => f.geometry.type === "LineString").length).toBeGreaterThan(0);
    expect(fc.features.filter((f) => f.geometry.type === "Point")).toHaveLength(0);
  });

  it("il numero sta sulla linea, non accanto", () => {
    const fc = isolineeDi(bolla(5), G, SOGLIE);
    const linea = (fc.features.find((f) => f.geometry.type === "LineString")!
      .geometry as GeoJSON.LineString).coordinates as [number, number][];
    const p = (fc.features.find((f) => f.geometry.type === "Point")!
      .geometry as GeoJSON.Point).coordinates as [number, number];
    let vicino = Infinity;
    for (const [x, y] of linea) vicino = Math.min(vicino, Math.hypot(x - p[0], y - p[1]));
    // in gradi: una cella vale circa 0,015 di longitudine a questa latitudine
    expect(vicino).toBeLessThan(0.02);
  });
});
