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
 *
 * Sopra a quello c'e' uno strozzamento a INTERVALLO_MINIMO_MS: "vince
 * l'ultima" limita il lavoro del worker, non quello del thread principale, che
 * a ogni risultato deve ritilare tutto il GeoJSON.
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

/**
 * Ogni quanto, al massimo, si ricalcolano le isolinee.
 *
 * Il campo scorre a 60 fotogrammi al secondo perche' lo disegna la scheda
 * grafica interpolando due texture; le isolinee no: ogni aggiornamento e' un
 * marching squares nel worker **piu'** una ritilatura di tutto il GeoJSON da
 * parte di MapLibre, sul thread principale. Misurato durante un trascinamento
 * continuo del cursore del tempo: lo stesso gesto dura 5,8 secondi con le
 * isolinee a schermo e 3,4 senza, cioe' il 70 per cento in piu', e la mano che
 * trascina lo sente.
 *
 * Cinque volte al secondo le linee seguono il campo senza scatti visibili (una
 * isolinea si sposta di poco in 200 ms) e il costo si dimezza. La coda tiene
 * comunque l'ultimo stato: quello che si vede quando ci si ferma e' il tempo
 * su cui ci si e' fermati, non l'ultimo che e' passato dal filtro.
 */
const INTERVALLO_MINIMO_MS = 200;

export class Isolinee {
  private worker: Worker;
  private conosciuti = new Set<string>();
  private inCorso = false;
  private inAttesa: Richiesta | null = null;
  private prossimoId = 1;
  private ultimoConsegnato = 0;
  private ultimoInvio = 0;
  private accese = true;
  private sveglia: ReturnType<typeof setTimeout> | null = null;
  private vivo = true;

  constructor(private readonly mappa: MappaLibre, private readonly griglia: Griglia, primaDi?: string) {
    this.worker = new Worker(new URL("./isolinee.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => this.risposta(e.data);

    // `tolerance: 0` non e' un dettaglio: la sorgente GeoJSON di MapLibre passa
    // per geojson-vt, che **risemplifica** la geometria mentre la ritila (per
    // difetto 0,375 unita' di tile). Sulle isolinee quella seconda passata
    // rimetteva gli spigoli che noi avevamo appena smussato, e i numeri
    // continuavano a non comparire. La semplificazione la facciamo noi, in
    // celle di griglia, dove il numero significa qualcosa.
    mappa.addSource(SORGENTE, { type: "geojson", data: VUOTO, tolerance: 0 });
    mappa.addLayer({
      id: STRATO_LINEE,
      type: "line",
      source: SORGENTE,
      filter: ["==", ["geometry-type"], "LineString"],
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
      // I numeri sono punti calcolati da noi, non simboli piazzati da MapLibre
      // lungo la linea: vedi `ancoraggio` in isolineeGeometria.ts. Con
      // `symbol-placement: line` la libreria ne metteva uno per linea e solo
      // dove le tornava, e sulle isolinee chiuse al largo nessuno.
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": ["get", "etichetta"],
        // il numero e' inclinato come la linea e ruota con la mappa, come su
        // una carta nautica
        "text-rotate": ["get", "gradi"],
        "text-rotation-alignment": "map",
        "text-pitch-alignment": "map",
        "text-font": ["Noto Sans Medium"],
        "text-size": 11,
        // Le linee sono tante e vicine: senza questo, due numeri di soglie
        // diverse si sovrappongono e diventano illeggibili entrambi.
        "text-allow-overlap": false,
        "text-padding": 4,
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
    if (!this.vivo || !this.accese) return;
    this.inAttesa = r;
    this.forse();
  }

  /**
   * Manda la richiesta in attesa se si puo': se il worker e' libero e
   * dall'ultimo invio e' passato abbastanza tempo. Se e' troppo presto mette
   * una sveglia, che e' la parte che rende onesto lo strozzamento: senza,
   * l'ultimo stato (quello su cui chi guarda si e' fermato) resterebbe in coda
   * per sempre e le linee mostrerebbero un istante che nessuno ha chiesto.
   */
  private forse(): void {
    if (!this.vivo || !this.accese || this.inCorso || !this.inAttesa) return;
    const manca = INTERVALLO_MINIMO_MS - (performance.now() - this.ultimoInvio);
    if (manca > 0) {
      if (this.sveglia === null) {
        this.sveglia = setTimeout(() => { this.sveglia = null; this.forse(); }, manca);
      }
      return;
    }
    const r = this.inAttesa;
    this.inAttesa = null;
    this.spedisci(r);
  }

  private spedisci(r: Richiesta): void {
    // I fotogrammi si mandano qui e non appena arrivano: sono 1,4 MB copiati
    // ognuno, e mandarli per uno stato che lo strozzamento sta per buttare via
    // sarebbe copiare per niente. Durante un trascinamento veloce era la meta'
    // del traffico verso il worker.
    for (const [chiave, dati] of [[r.chiaveA, r.datiA], [r.chiaveB, r.datiB]] as const) {
      if (chiave && dati && !this.conosciuti.has(chiave)) {
        this.worker.postMessage({ tipo: "fotogramma", chiave, dati });
        this.conosciuti.add(chiave);
      }
    }
    this.ultimoInvio = performance.now();
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
    if (m.tipo === "dimenticato") {
      // Il worker ha buttato via un fotogramma per far posto: da qui in poi
      // questo lato sa di doverlo rimandare. E' la meta' che mancava, ed e' il
      // motivo per cui le isolinee smettevano di aggiornarsi scorrendo il
      // tempo: i due elenchi divergevano e nessuno se ne accorgeva.
      if (m.chiave) this.conosciuti.delete(m.chiave);
      return;
    }
    this.inCorso = false;

    if (m.tipo === "manca" && m.chiave) {
      // Rete di sicurezza: il worker dovrebbe avvertire quando butta via un
      // fotogramma (messaggio "dimenticato"), quindi arrivare qui vuol dire che
      // i due elenchi si sono comunque scollati. Si sfoltisce e si riprova.
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

    this.forse();
  }

  /**
   * Accende o spegne le isolinee.
   *
   * Spegnerle non e' solo nasconderle: si smette di calcolarle e il worker
   * butta via gli undici megabyte di fotogrammi che teneva da parte. Un
   * comando che nasconde una cosa lasciandola calcolare sarebbe un comando
   * che non fa quello che dice, e chi lo usa lo usa proprio per togliere
   * lavoro alla macchina.
   *
   * `conosciuti` si svuota insieme al ricordo del worker: sono i due lati
   * della stessa contabilita', e lasciarli scollati e' il difetto per cui le
   * isolinee smettevano di aggiornarsi (decisione 67).
   */
  mostra(accese: boolean): void {
    if (!this.vivo || accese === this.accese) return;
    this.accese = accese;
    for (const strato of [STRATO_LINEE, STRATO_NUMERI]) {
      if (this.mappa.getLayer(strato)) {
        this.mappa.setLayoutProperty(strato, "visibility", accese ? "visible" : "none");
      }
    }
    if (accese) return;
    this.inAttesa = null;
    if (this.sveglia !== null) clearTimeout(this.sveglia);
    this.sveglia = null;
    this.worker.postMessage({ tipo: "dimentica" });
    this.conosciuti.clear();
    const sorgente = this.mappa.getSource(SORGENTE);
    if (sorgente && "setData" in sorgente) {
      (sorgente as { setData(d: GeoJSON.FeatureCollection): void }).setData(VUOTO);
    }
  }

  distruggi(): void {
    this.vivo = false;
    if (this.sveglia !== null) clearTimeout(this.sveglia);
    this.sveglia = null;
    this.worker.terminate();
  }
}
