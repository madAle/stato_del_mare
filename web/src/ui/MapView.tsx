import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Catalogo, Variabile } from "../data/catalogo";
import type { Ora } from "../data/indice";
import { Animazione, type StatoRiproduzione } from "../map/animazione";
import { LivelloCampo } from "../map/campo";
import { creaMappa, primoLivelloSimboli, type VistaIniziale } from "../map/mappa";
import { valoreCorrente } from "../map/proiezione";
import { creaStrozzatore } from "../map/strozzatore";

export type ManiglieMappa = { animazione: Animazione; livello: LivelloCampo };

export function MapView({
  catalogo, variabile, asse, prefetcher, cache, costa, maschera, metaCosta, metaMaschera, stile,
  preserveDrawingBuffer, vistaIniziale,
  alTempo, alValore, alPronto, alErrore,
}: {
  catalogo: Catalogo;
  variabile: Variabile;
  asse: Ora[];
  prefetcher: import("../data/prefetch").Prefetcher;
  cache: import("../data/cache").CacheFrame;
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

  // Dipendenze vuote di proposito: la mappa si costruisce una volta sola. Se si
  // ricostruisse a ogni cambio di stato, ogni ora di riproduzione ricreerebbe
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
        const livello = new LivelloCampo({
          griglia: catalogo.griglia, costa, maschera,
          limiteCostaM: metaCosta.limite_m, limiteDatoM: metaMaschera.limite_m,
          palette: variabile.colormap, massimo: 4, scala: variabile.scala,
        });
        // prima del primo livello di simboli: le etichette restano sopra il campo
        m.addLayer(livello, primoLivelloSimboli(m.getStyle() as never));

        animazione = new Animazione(livello, { asse, prefetcher, cache });
        animazione.alTempo = (istante, stato) => {
          ultimoIstante.current = istante;
          alTempo(istante, stato);
        };
        alPronto({ animazione, livello });

        m.on("mousemove", (e) => {
          const valore = valoreCorrente(
            catalogo.griglia, asse, ultimoIstante.current,
            (ora) => cache.prendi(prefetcher.chiave(ora)),
            e.lngLat.lng, e.lngLat.lat, variabile.scala, variabile.offset,
          );
          strozzatore.invia(valore);
        });

        // il segnale che lo smoke test aspetta invece di dormire un tempo a caso
        (window as never as { __mappa: unknown }).__mappa = m;
        (window as never as { __primoFrame: boolean }).__primoFrame = true;
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
    };
  }, []);

  return <div ref={contenitore} className="mappa" />;
}
