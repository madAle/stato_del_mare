import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { CacheFrame } from "../data/cache";
import type { Catalogo, Variabile } from "../data/catalogo";
import type { Ora } from "../data/indice";
import type { Prefetcher } from "../data/prefetch";
import { Animazione, type StatoRiproduzione } from "../map/animazione";
import { LivelloCampo } from "../map/campo";
import { Isolinee } from "../map/isolinee";
import { creaMappa, primoLivelloSimboli, type VistaIniziale } from "../map/mappa";
import { valoreCorrente } from "../map/proiezione";
import type { Grandezza } from "./grandezze";
import { inquadra as inquadraOre } from "../data/sorgente";
import { Segnaposto } from "../map/segnaposto";
import { haStatoDelMare } from "../map/soglie";
import { creaStrozzatore } from "../map/strozzatore";
import { scriviValoreEStato } from "./numeri";

/** Centro [lat, lon] e zoom letti dalla mappa vera, non dalla vista con cui e' stata aperta. */
export type Vista = { centro: [number, number]; zoom: number };

export type ManiglieMappa = { animazione: Animazione; livello: LivelloCampo };

export function MapView({
  catalogo, variabile, asse, prefetcher, cache, costa, maschera, metaCosta, metaMaschera, stile,
  preserveDrawingBuffer, vistaIniziale, puntoIniziale,
  alTempo, alValore, alPunto, alPronto, alVista, alErrore, isolinee: isolineeAccese, grandezza,
}: {
  catalogo: Catalogo;
  variabile: Variabile;
  asse: Ora[];
  prefetcher: Prefetcher;
  cache: CacheFrame;
  costa: HTMLImageElement;
  maschera: HTMLImageElement;
  metaCosta: { limite_m: number };
  metaMaschera: { limite_m: number };
  // Solo per i test end to end, vedi main.tsx.
  stile?: StyleSpecification;
  // Solo per i test end to end, vedi main.tsx: costa prestazioni, mai in produzione.
  preserveDrawingBuffer?: boolean;
  // Zoom e centro letti dall'URL: solo per il montaggio iniziale, un link
  // condiviso deve aprire la vista che promette, non quella predefinita.
  vistaIniziale?: VistaIniziale;
  alTempo: (istante: number, stato: StatoRiproduzione) => void;
  alValore: (valore: number | null) => void;
  /**
   * Il punto fissato, riportato a chi tiene lo stato perche' finisca nell'URL:
   * un link deve poter dire "guarda l'onda qui", non solo "guarda qui".
   * null quando chi guarda lo toglie.
   */
  alPunto: (punto: { lat: number; lng: number } | null) => void;
  /** Il punto letto dall'URL, piantato al montaggio. */
  puntoIniziale?: { lat: number; lng: number } | null;
  alPronto: (m: ManiglieMappa) => void;
  /**
   * Zoom e centro correnti, letti dalla mappa vera (m.getZoom()/getCenter())
   * al montaggio e a ogni "moveend": senza, chi scrive l'URL non ha altra
   * scelta che scriverci sempre null, e un link condiviso perderebbe vista e
   * zoom appena il tempo si aggiorna.
   */
  alVista: (vista: Vista) => void;
  /**
   * creaMappa puo' rifiutare (per esempio la basemap non ancora pubblicata sul
   * bucket): senza un modo di dirlo a chi monta questo componente, l'errore
   * sparirebbe dentro una promessa mai osservata e la UI resterebbe bloccata
   * su "caricamento" per sempre.
   */
  alErrore: (errore: Error) => void;
  /**
   * Se disegnare le isolinee. Spegnerle non le nasconde soltanto: si smette di
   * calcolarle e il worker butta via i fotogrammi (vedi `Isolinee.mostra`).
   */
  isolinee: boolean;
  /**
   * Come si rende la grandezza scelta: la cima della scala di colore e se fra
   * un'ora e l'altra si puo' interpolare. Non viene dal catalogo (che archivia
   * dati, non scelte di resa) ma dalla tabella in `ui/grandezze.ts`.
   */
  grandezza: Grandezza;
}) {
  const contenitore = useRef<HTMLDivElement>(null);
  // L'istanza delle isolinee vive dentro l'effetto di montaggio (a dipendenze
  // vuote): serve un ref per poterla accendere e spegnere da fuori senza
  // ricostruire la mappa, cioe' senza buttare via il contesto WebGL.
  const isolineeRef = useRef<Isolinee | null>(null);
  const accese = useRef(isolineeAccese);
  accese.current = isolineeAccese;
  // La grandezza serve dentro l'effetto di montaggio (dipendenze vuote) e
  // dentro il ciclo di animazione, che vivono entrambi in una chiusura creata
  // una volta sola: senza il ref vedrebbero per sempre quella del primo render.
  const grandezzaRef = useRef(grandezza);
  grandezzaRef.current = grandezza;
  // La funzione che chiede il ricalcolo vive anche lei dentro l'effetto di
  // montaggio: serve qui fuori per rifare le linee **subito** quando si
  // riaccendono, se no restano vuote fino al prossimo avanzamento del tempo,
  // che a mappa ferma non arriva mai.
  const chiediIsolinee = useRef<() => void>(() => {});
  // L'ultimo istante disegnato: il gestore di mousemove lo legge per mostrare
  // il valore del fotogramma che si vede a schermo, non quello con cui la
  // mappa e' stata montata. Un ref e non uno stato React, perche' alTempo gia'
  // arriva strozzato a 10 Hz dal ciclo di animazione, e uno stato in piu' qui
  // ricreerebbe il gestore di mousemove a ogni rapporto.
  const ultimoIstante = useRef(asse[0]?.istante ?? 0);
  // Dove sta il cursore, o null se e' fuori dalla mappa. Il valore mostrato
  // dipende da DUE cose, la posizione e l'istante, e la seconda cambia da sola
  // mentre la riproduzione scorre: senza ricordare la posizione si potrebbe
  // ricalcolare solo quando si muove il mouse, cioe' mai durante un autoplay.
  const ultimaPosizione = useRef<{ lng: number; lat: number } | null>(null);
  // Il punto fissato, se c'e'. Quando c'e' **vince sul passaggio del mouse**:
  // il valore a schermo e' il suo, e restarci sopra col cursore non lo cambia.
  // La regola alternativa (il passaggio vince finche' dura, poi torna il punto)
  // darebbe due sorgenti a un solo numero, cioe' un valore che cambia mentre
  // chi guarda non ha chiesto niente.
  const puntoFissato = useRef<{ lng: number; lat: number } | null>(null);
  // Le due callback vivono dentro l'effetto a dipendenze vuote: senza un ref
  // vedrebbero per sempre la chiusura del primo render.
  const alPuntoRef = useRef(alPunto);
  alPuntoRef.current = alPunto;

  // asse, prefetcher e variabile aggiornati a ogni render, non solo al
  // montaggio: App li ricrea quando i dati cambiano (per esempio un refetch
  // di React Query), ma l'effetto sotto costruisce la mappa una volta sola.
  // Senza questi ref, l'animazione e il gestore di mousemove avrebbero
  // continuato a lavorare per sempre sui valori del primo montaggio, mentre
  // lo scrubber (che rilegge le prop di App a ogni render) sarebbe passato
  // in silenzio a quelli nuovi: due assi diversi, mai riconciliati.
  const asseRef = useRef(asse);
  asseRef.current = asse;
  const prefetcherRef = useRef(prefetcher);
  prefetcherRef.current = prefetcher;
  const variabileRef = useRef(variabile);
  variabileRef.current = variabile;
  // Il livello vive dentro l'effetto qui sotto (dipendenze vuote): questo ref
  // e' l'unico modo di raggiungerlo da un effetto separato quando cambia
  // variabile, senza ricostruire la mappa.
  const livelloRef = useRef<LivelloCampo | null>(null);

  // La tavolozza segue la variabile corrente anche dopo il montaggio, con lo
  // stesso setter che LivelloCampo espone gia' per questo (impostaPalette):
  // senza, cambiare variabile (o un refetch del catalogo che ne cambia
  // l'identita' senza cambiarne i valori) lascerebbe la mappa colorata con
  // la tavolozza con cui si era aperta.
  useEffect(() => {
    livelloRef.current?.impostaPalette(variabile.colormap);
  }, [variabile.colormap]);

  // Scala e cima della legenda seguono la grandezza, con la stessa logica della
  // tavolozza: il livello si costruisce una volta sola, quindi senza questi due
  // setter cambiare grandezza lascerebbe il campo con la scala di quella prima.
  // L'altezza d'onda e' archiviata a millesimi di metro, il periodo a centesimi
  // di secondo: sbagliarla non si vede come un errore, si vede come un mare
  // diverso.
  useEffect(() => {
    livelloRef.current?.impostaScala(variabile.scala);
    livelloRef.current?.impostaEstremi(grandezza.minimo, grandezza.massimo);
  }, [variabile.scala, grandezza.minimo, grandezza.massimo]);

  // Dipendenze vuote di proposito: la mappa si costruisce una volta sola. Se si
  // ricostruisce a ogni cambio di stato, ogni ora di riproduzione ricreerebbe
  // il contesto WebGL e ricaricherebbe 702 MB di basemap.
  useEffect(() => {
    let vivo = true;
    let animazione: Animazione | null = null;
    let isolinee: Isolinee | null = null;
    let mappa: import("maplibre-gl").Map | null = null;
    // Al massimo dieci consegne al secondo a React, come il rapporto del
    // tempo: mousemove non e' aggregato dal browser e puo' arrivare a 60 e
    // piu' eventi al secondo, e ognuno che arrivasse a setValore
    // ridisegnerebbe App, cioe' esattamente il vincolo che questa
    // architettura esiste per rispettare.
    const strozzatore = creaStrozzatore<number | null>(alValore, 100);

    void (async () => {
      try {
        const m = await creaMappa(
          contenitore.current!, catalogo.griglia, stile, vistaIniziale, preserveDrawingBuffer,
        );
        if (!vivo) { m.remove(); return; }
        mappa = m;

        // Il primo rapporto, subito: cosi' chi scrive l'URL (App.tsx) ha
        // gia' zoom e centro veri prima che l'utente muova qualcosa, invece
        // di scriverci null finche' non arriva il primo "moveend". A ogni
        // "moveend" successivo lo stesso rapporto tiene l'URL allineato a
        // dove la mappa e' davvero, non a dove si e' aperta.
        const riportaVista = () => {
          const c = m.getCenter();
          alVista({ zoom: m.getZoom(), centro: [c.lat, c.lng] });
        };
        riportaVista();
        m.on("moveend", riportaVista);

        const livello = new LivelloCampo({
          griglia: catalogo.griglia, costa, maschera,
          limiteCostaM: metaCosta.limite_m, limiteDatoM: metaMaschera.limite_m,
          palette: variabile.colormap,
          minimo: grandezzaRef.current.minimo, massimo: grandezzaRef.current.massimo,
          scala: variabile.scala,
        });
        // Il segnale che lo smoke test aspetta invece di dormire un tempo a
        // caso: nasce nel livello, al primo render() che disegna davvero con
        // dati caricati (vedi il commento su alPrimoDisegno in campo.ts), non
        // al montaggio della mappa. Impostato prima di addLayer perche' il
        // primo render puo' scattare appena il livello e' aggiunto.
        livello.alPrimoDisegno = () => {
          (window as never as { __primoFrame: boolean }).__primoFrame = true;
        };
        livelloRef.current = livello;
        // prima del primo livello di simboli: le etichette restano sopra il campo
        const sottoLeEtichette = primoLivelloSimboli(m.getStyle() as never);
        m.addLayer(livello, sottoLeEtichette);
        isolinee = new Isolinee(m, catalogo.griglia, sottoLeEtichette);
        isolineeRef.current = isolinee;
        isolinee.mostra(accese.current && haStatoDelMare(variabileRef.current.id));

        // asseRef e prefetcherRef, non asse e prefetcher: l'animazione vive
        // per tutta la vita della mappa, ma i due ref restano aggiornati a
        // ogni render di MapView (vedi sopra), quindi legge sempre i valori
        // correnti invece di quelli del primo montaggio.
        // Il valore a schermo e' una funzione di (posizione, istante), quindi va
        // ricalcolato quando cambia l'una O l'altro. Ricalcolarlo solo sul
        // movimento del mouse lasciava a schermo, durante la riproduzione, un
        // numero di un altro istante accanto a una barra di stato che
        // dichiarava l'istante giusto: due meta' dello schermo che si
        // contraddicono, e quella sbagliata sembra una misura.
        const segnaposto = new Segnaposto(m);
        const aggiornaValore = () => {
          const dove = puntoFissato.current ?? ultimaPosizione.current;
          const valore = dove
            ? valoreCorrente(
                catalogo.griglia, asseRef.current, ultimoIstante.current,
                (ora) => cache.prendi(prefetcherRef.current.chiave(ora)),
                dove.lng, dove.lat, variabileRef.current.scala, variabileRef.current.offset,
                grandezzaRef.current.dissolvenza,
              )
            : null;
          // L'etichetta accanto al segno si scrive qui e non da React: il
          // numero cambia dieci volte al secondo durante la riproduzione, e
          // farlo passare da un render sarebbe esattamente il vincolo che
          // questa architettura esiste per rispettare. E' lo stesso numero
          // della barra di stato, scritto dalla stessa funzione.
          if (puntoFissato.current) {
            segnaposto.scrivi(scriviValoreEStato(valore, variabileRef.current.unita, variabileRef.current.id));
          }
          strozzatore.invia(valore);
        };

        // Piantare il punto e toglierlo. MapLibre distingue gia' il click dal
        // trascinamento, quindi spostare la mappa non pianta niente.
        m.on("click", (e) => {
          puntoFissato.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          segnaposto.metti(e.lngLat.lng, e.lngLat.lat);
          aggiornaValore();
          alPuntoRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
        segnaposto.alTolto = () => {
          puntoFissato.current = null;
          aggiornaValore();
          alPuntoRef.current(null);
        };
        if (puntoIniziale) {
          puntoFissato.current = { lng: puntoIniziale.lng, lat: puntoIniziale.lat };
          segnaposto.metti(puntoIniziale.lng, puntoIniziale.lat);
        }

        // Le isolinee si calcolano sullo stesso campo che lo shader disegna,
        // cioe' la stessa coppia di ore con la stessa frazione: prendere solo
        // l'ora piu' vicina farebbe saltare le linee di ora in ora mentre il
        // colore scorre liscio.
        const aggiornaIsolinee = () => {
          if (!isolinee) return;
          const q = inquadraOre(asseRef.current, ultimoIstante.current);
          if (!q) return;
          const chiaveA = prefetcherRef.current.chiave(q.prima);
          const datiA = cache.prendi(chiaveA);
          if (!datiA) return;
          const chiaveB = q.dopo ? prefetcherRef.current.chiave(q.dopo) : null;
          const datiB = chiaveB ? cache.prendi(chiaveB) ?? null : null;
          isolinee.aggiorna({
            chiaveA, datiA,
            chiaveB: datiB ? chiaveB : null,
            datiB,
            frazione: q.frazione,
            scala: variabileRef.current.scala,
            offset: variabileRef.current.offset,
          });
        };

        chiediIsolinee.current = aggiornaIsolinee;

        animazione = new Animazione(livello, {
          asse: asseRef, prefetcher: prefetcherRef, cache,
          dissolvenza: { get current() { return grandezzaRef.current.dissolvenza; } },
        });
        animazione.alTempo = (istante, stato) => {
          ultimoIstante.current = istante;
          aggiornaValore();
          aggiornaIsolinee();
          alTempo(istante, stato);
        };
        alPronto({ animazione, livello });

        // La posizione si ricorda sempre (serve appena si toglie il punto), ma
        // il valore si ricalcola solo se non c'e' un punto fissato: con il
        // punto, il numero e' il suo e ricalcolarlo a ogni movimento sarebbe
        // lavoro a vuoto sessanta volte al secondo.
        m.on("mousemove", (e) => {
          ultimaPosizione.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          if (!puntoFissato.current) aggiornaValore();
        });

        // Uscendo dalla mappa il valore deve sparire: senza questo, il numero
        // dell'ultimo punto toccato resterebbe a schermo e continuerebbe pure
        // ad aggiornarsi nel tempo, per una posizione che il cursore ha
        // lasciato. Il ricordo della posizione rende il difetto peggiore, non
        // migliore, se non lo si azzera.
        m.on("mouseout", () => {
          ultimaPosizione.current = null;
          if (!puntoFissato.current) aggiornaValore();
        });

        (window as never as { __mappa: unknown }).__mappa = m;
      } catch (errore) {
        // Senza questo catch, un rifiuto di creaMappa (o un guasto sincrono
        // durante il montaggio del livello) sparirebbe dentro la IIFE e chi
        // guarda l'app resterebbe su "caricamento" senza niente da leggere.
        if (vivo) alErrore(errore instanceof Error ? errore : new Error(String(errore)));
      }
    })();

    return () => {
      vivo = false;
      isolinee?.distruggi();
      isolineeRef.current = null;
      animazione?.distruggi();
      mappa?.remove();
      strozzatore.distruggi();
      livelloRef.current = null;
    };
  }, []);

  // Le isolinee sono i confini della scala Douglas, quindi esistono solo dove
  // quella scala si applica: su un campo di secondi una linea a 0,5 m
  // affermerebbe una cosa falsa. Fuori dall'altezza d'onda si spengono, con lo
  // stesso meccanismo dell'interruttore (che svuota la sorgente e ferma il
  // worker), invece di lasciarle disegnate su un dato che non le riguarda.
  const isolineeVive = isolineeAccese && haStatoDelMare(variabile.id);
  useEffect(() => {
    isolineeRef.current?.mostra(isolineeVive);
    if (isolineeVive) chiediIsolinee.current();
  }, [isolineeVive]);

  return <div ref={contenitore} className="mappa" />;
}
