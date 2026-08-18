import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { CacheFrame } from "../data/cache";
import type { Catalogo, Variabile } from "../data/catalogo";
import type { Ora } from "../data/indice";
import type { Prefetcher } from "../data/prefetch";
import { Animazione, type StatoRiproduzione } from "../map/animazione";
import { LivelloCampo } from "../map/campo";
import { creaMappa, primoLivelloSimboli, type VistaIniziale } from "../map/mappa";
import { valoreCorrente } from "../map/proiezione";
import { creaStrozzatore } from "../map/strozzatore";

/** Centro [lat, lon] e zoom letti dalla mappa vera, non dalla vista con cui e' stata aperta. */
export type Vista = { centro: [number, number]; zoom: number };

export type ManiglieMappa = { animazione: Animazione; livello: LivelloCampo };

export function MapView({
  catalogo, variabile, asse, prefetcher, cache, costa, maschera, metaCosta, metaMaschera, stile,
  preserveDrawingBuffer, vistaIniziale,
  alTempo, alValore, alPronto, alVista, alErrore,
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
}) {
  const contenitore = useRef<HTMLDivElement>(null);
  // L'ultimo istante disegnato: il gestore di mousemove lo legge per mostrare
  // il valore del fotogramma che si vede a schermo, non quello con cui la
  // mappa e' stata montata. Un ref e non uno stato React, perche' alTempo gia'
  // arriva strozzato a 10 Hz dal ciclo di animazione, e uno stato in piu' qui
  // ricreerebbe il gestore di mousemove a ogni rapporto.
  const ultimoIstante = useRef(asse[0]?.istante ?? 0);

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

  // Dipendenze vuote di proposito: la mappa si costruisce una volta sola. Se si
  // ricostruisce a ogni cambio di stato, ogni ora di riproduzione ricreerebbe
  // il contesto WebGL e ricaricherebbe 702 MB di basemap.
  useEffect(() => {
    let vivo = true;
    let animazione: Animazione | null = null;
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
          palette: variabile.colormap, massimo: 4, scala: variabile.scala,
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
        m.addLayer(livello, primoLivelloSimboli(m.getStyle() as never));

        // asseRef e prefetcherRef, non asse e prefetcher: l'animazione vive
        // per tutta la vita della mappa, ma i due ref restano aggiornati a
        // ogni render di MapView (vedi sopra), quindi legge sempre i valori
        // correnti invece di quelli del primo montaggio.
        animazione = new Animazione(livello, { asse: asseRef, prefetcher: prefetcherRef, cache });
        animazione.alTempo = (istante, stato) => {
          ultimoIstante.current = istante;
          alTempo(istante, stato);
        };
        alPronto({ animazione, livello });

        m.on("mousemove", (e) => {
          const valore = valoreCorrente(
            catalogo.griglia, asseRef.current, ultimoIstante.current,
            (ora) => cache.prendi(prefetcherRef.current.chiave(ora)),
            e.lngLat.lng, e.lngLat.lat, variabileRef.current.scala, variabileRef.current.offset,
          );
          strozzatore.invia(valore);
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
      animazione?.distruggi();
      mappa?.remove();
      strozzatore.distruggi();
      livelloRef.current = null;
    };
  }, []);

  return <div ref={contenitore} className="mappa" />;
}
