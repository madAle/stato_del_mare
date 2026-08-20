import { useQuery } from "@tanstack/react-query";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CacheFrame } from "../data/cache";
import { leggiCatalogo, VARIABILE_DISEGNATA } from "../data/catalogo";
import { leggiFrame } from "../data/frame";
import { asseDeiTempi, leggiIndice, type Ora } from "../data/indice";
import { Prefetcher } from "../data/prefetch";
import { inquadra } from "../data/sorgente";
import { urlFrame } from "../data/urls";
import type { StatoRiproduzione } from "../map/animazione";
import { creaStrozzatore } from "../map/strozzatore";
import { Legend } from "./Legend";
import { LayerSwitcher } from "./LayerSwitcher";
import { MapView, type ManiglieMappa, type Vista } from "./MapView";
import { PlaybackControls } from "./PlaybackControls";
import { StatusBar } from "./StatusBar";
import { TimelineScrubber } from "./TimelineScrubber";
import { PALETTE } from "../map/colormap";
import { PaletteSwitcher } from "./PaletteSwitcher";
import { leggiStatoUrl, scriviStatoUrl } from "./statoUrl";

/** Finestra iniziale: 48 ore passate piu' 72 previste, cursore su adesso. */
const INDIETRO_MS = 48 * 3_600_000;
const AVANTI_MS = 72 * 3_600_000;

export function App({
  costa, maschera, metaCosta, metaMaschera, stile, preserveDrawingBuffer,
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
  // Solo per i test end to end, vedi main.tsx: costa prestazioni, mai in produzione.
  preserveDrawingBuffer?: boolean;
}) {
  const iniziale = useMemo(() => leggiStatoUrl(location.search), []);
  // Tavolozza sostituibile con `?palette=dense` per confrontare le alternative
  // sullo stesso dato: le scelte di colore si decidono guardando, non a
  // ragionamenti. Un nome sconosciuto viene ignorato invece di far saltare la
  // mappa, perche' questo parametro finisce nei link che ci si scambia.
  // La tavolozza: dall'URL se c'e' e se esiste, altrimenti quella del catalogo
  // (che per l'altezza d'onda pubblica `dense`). Un nome sconosciuto viene
  // ignorato invece di far saltare la mappa, perche' questo parametro finisce
  // nei link che ci si scambia.
  const [palette, setPalette] = useState<string | null>(() => {
    const chiesta = iniziale.palette;
    return chiesta && chiesta in PALETTE ? chiesta : null;
  });
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
  // Le isolinee sono accese di casa: sono la lettura quantitativa del campo, e
  // chi apre la mappa per la prima volta non sa di poterle chiedere. Si possono
  // togliere per guardare il colore pulito, e la scelta viaggia nell'URL.
  const [isolinee, setIsolinee] = useState(iniziale.isolinee ?? true);
  // Il punto osservato non e' uno stato che ridisegna: il segno lo tiene
  // MapLibre, il valore lo scrive lo strato mappa. Serve solo a finire
  // nell'URL, quindi vive in un ref come zoom e centro.
  const puntoRef = useRef<{ lat: number; lng: number } | null>(
    iniziale.punto ? { lat: iniziale.punto[0], lng: iniziale.punto[1] } : null,
  );
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
  const istanteRef = useRef(istante);
  istanteRef.current = istante;
  // Come gli altri ref: lo scrittore dell'URL vive dentro uno strozzatore
  // creato una volta sola, quindi legge i valori correnti e non quelli del
  // primo render.
  const paletteRef = useRef<string | null>(palette);
  paletteRef.current = palette;
  const isolineeRef = useRef(isolinee);
  isolineeRef.current = isolinee;
  // Zoom e centro veri, riportati da MapView a ogni "moveend" (vedi
  // MapView.tsx): prima di questo ref l'URL non li conosceva mai e
  // scriveva sempre null, cancellando la vista di un link condiviso.
  const vistaRef = useRef<Vista | null>(null);

  // Scrive l'URL al massimo una volta al secondo invece che a ogni rapporto
  // del tempo (che arriva gia' a 10 Hz da Animazione): dieci replaceState al
  // secondo superano il limite di Safari (100 in 30 secondi), e l'eccezione
  // che ne segue fermerebbe il ciclo di riproduzione senza dirlo a nessuno.
  // Lo strozzatore consegna comunque l'ultimo stato quando i cambi si
  // fermano (vedi map/strozzatore.ts), quindi l'URL resta corretto anche
  // dopo l'ultimo movimento o l'ultimo avanzamento del tempo.
  const strozzatoreUrl = useMemo(
    () => creaStrozzatore<void>(() => {
      history.replaceState(null, "", scriviStatoUrl({
        istante: istanteRef.current,
        variabile: variabileRef.current,
        palette: paletteRef.current,
        zoom: vistaRef.current?.zoom ?? null,
        centro: vistaRef.current?.centro ?? null,
        punto: puntoRef.current ? [puntoRef.current.lat, puntoRef.current.lng] : null,
        isolinee: isolineeRef.current,
      }));
    }, 1000),
    [],
  );
  useEffect(() => () => strozzatoreUrl.distruggi(), [strozzatoreUrl]);

  const catalogo = useQuery({ queryKey: ["catalogo"], queryFn: () => leggiCatalogo() });
  const variabili = catalogo.data?.variabili ?? [];
  const sceltaGrezza = variabili.find((v) => v.id === variabile);
  // La tavolozza del catalogo si puo' sostituire con `?palette=dense` per
  // confrontare le alternative sullo stesso dato, che e' l'unico modo per
  // deciderle. Il catalogo resta la scelta di default: questo e' un parametro
  // per guardare, non una configurazione.
  const scelta = sceltaGrezza && palette
    ? { ...sceltaGrezza, colormap: palette }
    : sceltaGrezza;

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
    () => new Prefetcher(cache, variabile, (ora: Ora) =>
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

  if (!catalogo.data) return <main>caricamento...</main>;

  // Il catalogo e' arrivato per intero e non la nomina: non e' un guasto di
  // rete ne' un caricamento ancora in corso, e' un catalogo pubblicato senza
  // la variabile che questa versione sa disegnare. Senza questo messaggio
  // l'app restava su "caricamento..." per sempre, mentre tutti gli altri
  // guasti (catalogo, indice, mappa) hanno gia' un messaggio.
  if (!scelta) {
    return (
      <main className="errore">
        Il catalogo non pubblica la variabile "{VARIABILE_DISEGNATA}": impossibile disegnare la mappa.
      </main>
    );
  }

  if (!assi.data) return <main>caricamento...</main>;

  // L'indice e' arrivato ma, dentro la finestra corrente (l'apertura
  // normale, o l'istante esatto di un link condiviso), non c'e' nessun'ora:
  // stesso ragionamento del caso sopra, un catalogo vuoto per la finestra
  // scelta non e' un caricamento che deve ancora finire.
  if (asse.length === 0) {
    return (
      <main className="errore">
        Nessun orario disponibile per "{VARIABILE_DISEGNATA}" nella finestra corrente.
      </main>
    );
  }

  const inquadratura = inquadra(asse, istante);
  const oraCorrente = inquadratura?.prima ?? null;
  // L'ora successiva serve alla barra di stato per dire "09:00 -> 10:00"
  // mentre si passa fra le due, invece di scrivere un minuto che il dato,
  // che e' orario, non ha mai avuto.
  const oraDopo = inquadratura?.dopo ?? null;

  return (
    <main>
      <MapView
        catalogo={catalogo.data} variabile={scelta} asse={asse}
        prefetcher={prefetcher} cache={cache}
        costa={costa} maschera={maschera}
        metaCosta={metaCosta} metaMaschera={metaMaschera}
        stile={stile}
        preserveDrawingBuffer={preserveDrawingBuffer}
        vistaIniziale={{ centro: iniziale.centro, zoom: iniziale.zoom }}
        puntoIniziale={puntoRef.current}
        isolinee={isolinee}
        alTempo={(i, s) => {
          setIstante(i); setStato(s);
          istanteRef.current = i;
          strozzatoreUrl.invia();
        }}
        alValore={setValore}
        alPunto={(p) => { puntoRef.current = p; strozzatoreUrl.invia(); }}
        alPronto={(m) => { maniglie.current = m; m.animazione.vaiA(istante); }}
        alVista={(v) => { vistaRef.current = v; strozzatoreUrl.invia(); }}
        alErrore={(e) => setErroreMappa(e.message)}
      />
      {/* I tre pannelli in alto stanno in un contenitore che a schermo largo non
          fa niente (restano posizionati ognuno per conto suo) e a schermo
          stretto li impila, invece di lasciarli accavallare. */}
      <div className="fascia-alta">
        <LayerSwitcher variabili={variabili} scelta={variabile} cambia={setVariabile} />
        <StatusBar istante={istante} ora={oraCorrente} oraDopo={oraDopo} valore={valore} unita={scelta.unita} variabile={scelta.id} stato={stato} />
        <Legend palette={scelta.colormap} massimo={4} unita={scelta.unita}>
          {/* Il ref si aggiorna **prima** di chiedere la scrittura dell'URL, non
              solo al render successivo: lo strozzatore consegna subito se la
              finestra e' gia' scaduta, e leggerebbe il valore di prima. Con un
              solo cambio e nessun altro evento a seguire (mappa ferma) quel
              valore sbagliato resterebbe nell'URL per sempre. */}
          <PaletteSwitcher
            scelta={scelta.colormap}
            cambia={(id) => { paletteRef.current = id; setPalette(id); strozzatoreUrl.invia(); }}
          />
          {/* L'interruttore delle isolinee sta nella legenda, accanto alla
              scala di colore, perche' e' la stessa domanda: come si legge il
              campo. Il colore lo legge a occhio, le linee lo leggono in
              metri. */}
          <label className="interruttore">
            <input
              type="checkbox"
              checked={isolinee}
              onChange={(e) => {
                isolineeRef.current = e.target.checked;
                setIsolinee(e.target.checked);
                strozzatoreUrl.invia();
              }}
            />
            isolinee
          </label>
        </Legend>
      </div>
      {/* Come la fascia alta: il contenitore impila, quindi ne' i comandi ne'
          lo scrubber devono conoscere l'altezza dell'altro. I comandi stanno
          prima perche' vanno sopra. */}
      <div className="fascia-bassa">
        <PlaybackControls
          inRiproduzione={inRiproduzione}
          cambia={(attiva) => {
            setInRiproduzione(attiva);
            if (attiva) maniglie.current?.animazione.riproduci();
            else maniglie.current?.animazione.pausa();
          }}
          cambiaVelocita={(v) => maniglie.current?.animazione.impostaVelocita(v)}
        />
        <TimelineScrubber asse={asse} istante={istante}
          cambia={(i) => { setIstante(i); maniglie.current?.animazione.vaiA(i); }} />
      </div>
    </main>
  );
}
