import type { Map as MappaLibre } from "maplibre-gl";
import type { Griglia } from "../data/catalogo";
import { aMercatore } from "./proiezione";
import { SOGLIE } from "./soglie";

/**
 * Le isolinee sul campo: due strati MapLibre sulla stessa sorgente, uno per le
 * linee e uno per i numeri che ci corrono sopra, come le isobate su una carta
 * nautica.
 *
 * Il calcolo sta in un worker (vedi isolinee.worker.ts): 50-63 ms per
 * fotogramma sono troppi per il thread principale, che a 8 ore/s ne riceve otto
 * al secondo.
 *
 * Lo schema e' "vince l'ultima": mentre il worker lavora, una richiesta nuova
 * non si accoda, sostituisce quella in attesa. Accodarle vorrebbe dire che a
 * riproduzione veloce la coda cresce senza fine e le linee arrivano sempre piu'
 * in ritardo rispetto al campo, cioe' mostrano un istante che non e' quello
 * scritto nella barra di stato.
 */

export const SORGENTE = "isolinee";
export const STRATO_LINEE = "isolinee-linee";
export const STRATO_NUMERI = "isolinee-numeri";

type Richiesta = {
  chiaveA: string;
  datiA: Int16Array;
  chiaveB: string | null;
  datiB: Int16Array | null;
  frazione: number;
  scala: number;
  offset: number;
};

const VUOTO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export class Isolinee {
  private worker: Worker;
  private conosciuti = new Set<string>();
  private inCorso = false;
  private inAttesa: Richiesta | null = null;
  private prossimoId = 1;
  private ultimoConsegnato = 0;
  private vivo = true;

  constructor(private readonly mappa: MappaLibre, private readonly griglia: Griglia, primaDi?: string) {
    this.worker = new Worker(new URL("./isolinee.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => this.risposta(e.data);

    mappa.addSource(SORGENTE, { type: "geojson", data: VUOTO });
    mappa.addLayer({
      id: STRATO_LINEE,
      type: "line",
      source: SORGENTE,
      paint: {
        // Le soglie WMO portano il numero e corrono spesse, le intermedie di
        // ARPAE sottili e mute: il numero compare dove ha un nome, non a ogni
        // gradino (spec, sezione 1).
        "line-width": ["case", ["get", "nome"], 1.6, 0.8],
        "line-color": "rgba(20, 24, 28, 0.55)",
      },
    }, primaDi);
    mappa.addLayer({
      id: STRATO_NUMERI,
      type: "symbol",
      source: SORGENTE,
      filter: ["get", "nome"],
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "etichetta"],
        // il numero segue la linea e ruota con la mappa, come su una carta
        "text-rotation-alignment": "map",
        "text-pitch-alignment": "map",
        "text-font": ["Noto Sans Medium"],
        "text-size": 11,
        "symbol-spacing": 180,
        // Un'isolinea gira piu' di una strada: con l'angolo massimo predefinito
        // MapLibre scarta quasi tutte le posizioni candidate e il numero non
        // compare (misurato: un solo numero su 102 linee disegnate).
        "text-max-angle": 60,
        // Le linee sono tante e vicine: senza questo, due numeri di soglie
        // diverse si rifiutano a vicenda e resta il piu' fortunato.
        "text-allow-overlap": false,
        "text-padding": 2,
      },
      paint: {
        "text-color": "rgba(20, 24, 28, 0.9)",
        "text-halo-color": "rgba(255, 255, 255, 0.85)",
        "text-halo-width": 1.2,
      },
    }, primaDi);
  }

  /**
   * Chiede le isolinee del campo che si sta disegnando adesso.
   *
   * I fotogrammi si mandano al worker una volta sola: rimandarli a ogni
   * richiesta sarebbe 1,4 MB copiati dieci volte al secondo. Trasferirli
   * (senza copia) non si puo': la stessa griglia serve allo shader e al valore
   * sotto il punto.
   */
  aggiorna(r: Richiesta): void {
    if (!this.vivo) return;
    for (const [chiave, dati] of [[r.chiaveA, r.datiA], [r.chiaveB, r.datiB]] as const) {
      if (chiave && dati && !this.conosciuti.has(chiave)) {
        this.worker.postMessage({ tipo: "fotogramma", chiave, dati });
        this.conosciuti.add(chiave);
      }
    }
    if (this.inCorso) {
      this.inAttesa = r;
      return;
    }
    this.spedisci(r);
  }

  private spedisci(r: Richiesta): void {
    this.inCorso = true;
    this.worker.postMessage({
      tipo: "calcola",
      id: this.prossimoId++,
      idA: r.chiaveA,
      idB: r.chiaveB,
      frazione: r.frazione,
      scala: r.scala,
      offset: r.offset,
      soglie: SOGLIE,
      griglia: {
        larghezza: this.griglia.larghezza,
        altezza: this.griglia.altezza,
        risoluzioneM: this.griglia.risoluzioneM,
        ...this.angoloNordOvest(),
      },
    });
  }

  private angoloNordOvest(): { xMin: number; yMax: number } {
    const b = this.griglia.boundsLonLat;
    const nw = aMercatore(b.ovest, b.nord);
    return { xMin: nw.x, yMax: nw.y };
  }

  private risposta(m: { tipo: string; id?: number; chiave?: string; geojson?: GeoJSON.FeatureCollection }): void {
    if (m.tipo === "ricevuto") return;
    this.inCorso = false;

    if (m.tipo === "manca" && m.chiave) {
      // Il worker ha dimenticato un fotogramma (la sua memoria e' piccola):
      // si toglie dai conosciuti, cosi' la prossima richiesta lo rimanda.
      this.conosciuti.delete(m.chiave);
    } else if (m.tipo === "isolinee" && m.geojson && m.id && m.id > this.ultimoConsegnato) {
      // Un risultato piu' vecchio dell'ultimo consegnato si butta: arriverebbe
      // dopo, e riporterebbe indietro le linee a un istante gia' passato.
      this.ultimoConsegnato = m.id;
      if (this.vivo) {
        const sorgente = this.mappa.getSource(SORGENTE);
        if (sorgente && "setData" in sorgente) {
          (sorgente as { setData(d: GeoJSON.FeatureCollection): void }).setData(m.geojson);
        }
      }
    }

    const dopo = this.inAttesa;
    this.inAttesa = null;
    if (dopo && this.vivo) this.spedisci(dopo);
  }

  distruggi(): void {
    this.vivo = false;
    this.worker.terminate();
  }
}
