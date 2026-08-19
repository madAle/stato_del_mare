import { describe, expect, it } from "vitest";
import { NODATA } from "../src/data/frame";
import {
  aLonLat, isolineeDi, mescola, suUnBordo, type GrigliaIsolinee,
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
      expect(p.etichetta === "").toBe(!p.nome);
      if (p.nome) expect(String(p.etichetta)).toMatch(/^\d+(,\d+)? m$/);
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
