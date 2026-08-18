import { useQuery } from "@tanstack/react-query";
import type { StyleSpecification } from "maplibre-gl";
import { useMemo, useRef, useState } from "react";
import { CacheFrame } from "../data/cache";
import { leggiCatalogo, VARIABILE_DISEGNATA } from "../data/catalogo";
import { leggiFrame } from "../data/frame";
import { asseDeiTempi, leggiIndice, type Ora } from "../data/indice";
import { Prefetcher } from "../data/prefetch";
import { inquadra } from "../data/sorgente";
import { urlFrame } from "../data/urls";
import type { StatoRiproduzione } from "../map/animazione";
import { Legend } from "./Legend";
import { LayerSwitcher } from "./LayerSwitcher";
import { MapView, type ManiglieMappa } from "./MapView";
import { PlaybackControls } from "./PlaybackControls";
import { StatusBar } from "./StatusBar";
import { TimelineScrubber } from "./TimelineScrubber";
import { leggiStatoUrl, scriviStatoUrl } from "./statoUrl";

/** Finestra iniziale: 48 ore passate piu' 72 previste, cursore su adesso. */
const INDIETRO_MS = 48 * 3_600_000;
const AVANTI_MS = 72 * 3_600_000;

export function App({
  costa, maschera, metaCosta, metaMaschera, stile,
}: {
  // Caricate una volta sola in main.tsx e passate come proprieta': una
  // variabile globale nasconderebbe una dipendenza vera e impedirebbe di
  // montare due mappe o di provare questo componente in isolamento.
  costa: HTMLImageElement;
  maschera: HTMLImageElement;
  metaCosta: { limite_m: number };
  metaMaschera: { limite_m: number };
  // Solo per i test end to end: la basemap vera non e' pubblicata sul bucket
  // (vedi main.tsx). Assente, si usa quella predefinita di creaMappa.
  stile?: StyleSpecification;
}) {
  const iniziale = useMemo(() => leggiStatoUrl(location.search), []);
  // Un link condiviso con ?var= su una variabile diversa da quella disegnata
  // avrebbe montato la mappa gia' incoerente con la legenda fin dal primo
  // render: stessa incoerenza del LayerSwitcher, stesso rimedio, cioe' non
  // accettarla.
  const [variabile, setVariabile] = useState(
    iniziale.variabile === VARIABILE_DISEGNATA ? iniziale.variabile : VARIABILE_DISEGNATA,
  );
  const [istante, setIstante] = useState(iniziale.istante ?? Date.now());
  const [stato, setStato] = useState<StatoRiproduzione>("ferma");
  const [inRiproduzione, setInRiproduzione] = useState(false);
  const [valore, setValore] = useState<number | null>(null);
  // Errore di montaggio della mappa (per esempio la basemap non ancora
  // pubblicata sul bucket): creaMappa puo' rifiutare, e senza tenere lo stato
  // qui l'app resterebbe bloccata su "caricamento" per sempre, senza dire
  // perche' a chi guarda.
  const [erroreMappa, setErroreMappa] = useState<string | null>(null);
  const maniglie = useRef<ManiglieMappa | null>(null);

  // Il ciclo di animazione si collega ad alTempo una volta sola, al montaggio
  // di MapView: la sua chiusura vedrebbe per sempre la variabile del primo
  // render. Un ref, aggiornato a ogni render, tiene l'ultimo valore vero senza
  // dover ricreare l'animazione (e il contesto WebGL) a ogni cambio.
  const variabileRef = useRef(variabile);
  variabileRef.current = variabile;

  const catalogo = useQuery({ queryKey: ["catalogo"], queryFn: () => leggiCatalogo() });
  const variabili = catalogo.data?.variabili ?? [];
  const scelta = variabili.find((v) => v.id === variabile);

  const assi = useQuery({
    queryKey: ["asse", variabile, scelta?.tipi.an.mesi.join()],
    enabled: Boolean(scelta),
    queryFn: async () => {
      const an = await leggiIndice(variabile, "an", scelta!.tipi.an.mesi);
      const fc = await leggiIndice(variabile, "fc", scelta!.tipi.fc.mesi);
      return asseDeiTempi(an, fc);
    },
  });

  const asse = useMemo(() => {
    const tutte = assi.data ?? [];
    if (iniziale.istante) return tutte;
    // Tutto l'archivio si allarga da un comando; all'apertura si mostra la
    // finestra utile, se no lo scrubber nasce compresso su settimane di ore.
    const adesso = Date.now();
    return tutte.filter((o) => o.istante > adesso - INDIETRO_MS && o.istante < adesso + AVANTI_MS);
  }, [assi.data, iniziale.istante]);

  const cache = useMemo(() => new CacheFrame(), []);
  const prefetcher = useMemo(
    () => new Prefetcher(cache, (ora: Ora) =>
      leggiFrame(urlFrame(variabile, ora.tipo, ora.riferimento, new Date(ora.istante)),
                 catalogo.data!.griglia)),
    [cache, variabile, catalogo.data],
  );

  // Un catalogo o un asse che non arrivano sono la stessa categoria di guasto
  // della mappa che rifiuta: senza mostrarli, l'app resta su "caricamento..."
  // per sempre e chi guarda non ha modo di sapere perche'.
  if (catalogo.error) {
    return <main className="errore">Impossibile caricare il catalogo: {catalogo.error.message}</main>;
  }
  if (assi.error) {
    return (
      <main className="errore">Impossibile caricare l'indice degli orari: {assi.error.message}</main>
    );
  }
  if (erroreMappa) {
    return <main className="errore">Impossibile aprire la mappa: {erroreMappa}</main>;
  }

  if (!catalogo.data || !scelta || asse.length === 0) return <main>caricamento...</main>;

  const oraCorrente = inquadra(asse, istante)?.prima ?? null;

  return (
    <main>
      <MapView
        catalogo={catalogo.data} variabile={scelta} asse={asse}
        prefetcher={prefetcher} cache={cache}
        costa={costa} maschera={maschera}
        metaCosta={metaCosta} metaMaschera={metaMaschera}
        stile={stile}
        vistaIniziale={{ centro: iniziale.centro, zoom: iniziale.zoom }}
        alTempo={(i, s) => { setIstante(i); setStato(s);
          history.replaceState(null, "", scriviStatoUrl({
            istante: i, variabile: variabileRef.current, zoom: null, centro: null })); }}
        alValore={setValore}
        alPronto={(m) => { maniglie.current = m; m.animazione.vaiA(istante); }}
        alErrore={(e) => setErroreMappa(e.message)}
      />
      <LayerSwitcher variabili={variabili} scelta={variabile} cambia={setVariabile} />
      <Legend palette={scelta.colormap} massimo={4} unita={scelta.unita} />
      <TimelineScrubber asse={asse} istante={istante}
        cambia={(i) => { setIstante(i); maniglie.current?.animazione.vaiA(i); }} />
      <PlaybackControls
        inRiproduzione={inRiproduzione}
        cambia={(attiva) => {
          setInRiproduzione(attiva);
          if (attiva) maniglie.current?.animazione.riproduci();
          else maniglie.current?.animazione.pausa();
        }}
        cambiaVelocita={(v) => maniglie.current?.animazione.impostaVelocita(v)}
      />
      <StatusBar ora={oraCorrente} valore={valore} unita={scelta.unita} stato={stato} />
    </main>
  );
}
