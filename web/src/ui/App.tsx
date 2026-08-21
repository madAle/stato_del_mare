import { useQuery } from "@tanstack/react-query";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CacheFrame } from "../data/cache";
import { leggiCatalogo, VARIABILE_DISEGNATA } from "../data/catalogo";
import { haStatoDelMare } from "../map/soglie";
import { grandezzeDi } from "./grandezze";
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
import { PaletteSwitcher, TAVOLOZZE, TAVOLOZZE_CON_SEGNO } from "./PaletteSwitcher";
import { leggiStatoUrl, scriviStatoUrl } from "./statoUrl";

/**
 * Finestra iniziale: **24** ore passate piu' 72 previste, cursore su adesso.
 *
 * Il passato era 48 ore. Chiesto il 2026-08-21 di stringerlo a un giorno: con la
 * previsione schiacciata in meta' scala, un'ora di domani vale meta' dei pixel di
 * un'ora di ieri, e trovarla col dito diventa piu' difficile proprio dove serve,
 * che e' la parte per cui si apre la mappa.
 *
 * **Quanto passato si vede davvero dipende da quanto lontano arriva la
 * previsione**, non solo da questa costante, e la prima stesura di questo commento
 * lo dava per fisso. Misurato sul sito vero il 2026-08-21 alle 17, con la
 * previsione ferma a +31 ore perche' ARPAE non aveva ancora pubblicato il file del
 * giorno: il passato occupava il **42 per cento** della scala (41,6 letto dalla
 * posizione del segno "adesso"), non il 25. I tre casi, con la stessa aritmetica:
 * con la previsione di quel momento il passato era il **61** per cento prima della
 * modifica e il **42** dopo; con una previsione piena a +72 ore sarebbe il **25**.
 * Quindi la modifica aiuta **di piu'** quando la previsione e' vecchia, cioe'
 * proprio quando il problema e' peggiore.
 *
 * **Non toglie niente**: un link con `?t=` apre l'asse intero (vedi `asse` qui
 * sotto), quindi l'archivio resta raggiungibile e questa e' solo la vista di
 * partenza.
 *
 * Una conseguenza sulle tacche, misurata e non dedotta: **solo quando la
 * previsione e' al massimo**. Con la previsione fresca a +72 ore l'ampiezza passa
 * da 120 a 96 ore, e `tacche` scende da un passo di 24 ore a uno di 12, cioe' due
 * etichette al giorno invece di una. Ma la previsione invecchia fra un run e
 * l'altro: con +36 ore (misurato il 2026-08-21, quando ARPAE non aveva ancora
 * pubblicato il file del giorno) l'ampiezza era 84 ore e il passo era **gia'** 12,
 * e resta 12 a 60 ore. Quindi la scala si infittisce a volte, non sempre.
 *
 * "Per ora": se un giorno indietro risultasse troppo poco per confrontare la
 * previsione con com'e' andata, il numero e' questo.
 */
const INDIETRO_MS = 24 * 3_600_000;
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
  // Un link con ?var= su una grandezza che questa versione non sa disegnare
  // monterebbe la mappa gia' incoerente con la legenda fin dal primo render:
  // stessa incoerenza del selettore, stesso rimedio, cioe' non accettarla. Il
  // controllo vero (e' disegnabile?) si puo' fare solo col catalogo in mano,
  // piu' sotto: qui si tiene quello che l'URL dice.
  const [variabile, setVariabile] = useState(iniziale.variabile ?? VARIABILE_DISEGNATA);
  const [istante, setIstante] = useState(iniziale.istante ?? Date.now());
  const [stato, setStato] = useState<StatoRiproduzione>("ferma");
  const [inRiproduzione, setInRiproduzione] = useState(false);
  const [valore, setValore] = useState<number | null>(null);
  // Le isolinee sono accese di casa: sono la lettura quantitativa del campo, e
  // chi apre la mappa per la prima volta non sa di poterle chiedere. Si possono
  // togliere per guardare il colore pulito, e la scelta viaggia nell'URL.
  const [isolinee, setIsolinee] = useState(iniziale.isolinee ?? true);
  // L'animazione della direzione e' spenta di casa: costa un asse dei tempi in
  // piu' e tre campi per istante, e chi apre la mappa la prima volta cerca
  // "com'e' il mare", non "da dove viene".
  const [direzione, setDirezione] = useState(iniziale.direzione ?? false);
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
  const direzioneRef = useRef(direzione);
  direzioneRef.current = direzione;
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
        direzione: direzioneRef.current,
      }));
    }, 1000),
    [],
  );
  useEffect(() => () => strozzatoreUrl.distruggi(), [strozzatoreUrl]);

  const catalogo = useQuery({ queryKey: ["catalogo"], queryFn: () => leggiCatalogo() });
  const variabili = catalogo.data?.variabili ?? [];
  const grandezze = grandezzeDi(variabili);
  // Le grandezze disegnabili di oggi hanno **un campo solo**, quindi il loro id
  // coincide con l'id del campo nel catalogo, ed e' cio' che rende lecito
  // cercarla qui per id e passarla a `leggiIndice` e a `urlFrame`. Il giorno
  // che diventa disegnabile una grandezza a due campi (direzione, corrente),
  // questa riga non basta piu' e va sciolta la corrispondenza.
  const grandezza = grandezze.find((g) => g.id === variabile && g.disegnabile)
    ?? grandezze.find((g) => g.id === VARIABILE_DISEGNATA);
  const sceltaGrezza = variabili.find((v) => v.id === grandezza?.id);
  // La tavolozza del catalogo si puo' sostituire con `?palette=dense` per
  // confrontare le alternative sullo stesso dato, che e' l'unico modo per
  // deciderle. Il catalogo resta la scelta di default: questo e' un parametro
  // per guardare, non una configurazione.
  //
  // Ma la sostituzione vale solo se la tavolozza ha senso per la grandezza: una
  // scelta fatta sull'altezza d'onda non deve seguirti sul livello del mare,
  // che ha segno e vuole una divergente. Senza questo controllo il campo si
  // disegnerebbe con una rampa sequenziale mentre il selettore mostra il nome
  // di un'altra, cioe' due parti dello schermo che si contraddicono.
  const ammesse: readonly { id: string }[] =
    grandezza && grandezza.minimo < 0 ? TAVOLOZZE_CON_SEGNO : TAVOLOZZE;
  const paletteValida = palette && ammesse.some((t) => t.id === palette) ? palette : null;
  const scelta = sceltaGrezza && paletteValida
    ? { ...sceltaGrezza, colormap: paletteValida }
    : sceltaGrezza;

  // Se l'URL chiedeva una grandezza che non si sa disegnare, si e' ricaduti
  // sull'altezza d'onda: lo stato va corretto, non solo la resa. Senza, il
  // selettore mostrerebbe una scelta diversa da quella disegnata e l'URL
  // continuerebbe a promettere una grandezza che nessuno sta guardando.
  useEffect(() => {
    if (grandezza && grandezza.id !== variabile) {
      variabileRef.current = grandezza.id;
      setVariabile(grandezza.id);
      strozzatoreUrl.invia();
    }
  }, [grandezza, variabile, strozzatoreUrl]);

  const assi = useQuery({
    queryKey: ["asse", scelta?.id, scelta?.tipi.an.mesi.join()],
    enabled: Boolean(scelta),
    queryFn: async () => {
      const an = await leggiIndice(scelta!.id, "an", scelta!.tipi.an.mesi);
      const fc = await leggiIndice(scelta!.id, "fc", scelta!.tipi.fc.mesi);
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

  // La direzione ha un asse dei tempi **suo**: il livello del mare, per
  // esempio, e' archiviato ogni dieci minuti, e chiedere quegli istanti ai
  // campi della direzione (che sono orari) darebbe una sfilza di 404. Si carica
  // solo quando serve davvero.
  const campiDirezione = ["dwave_sin", "dwave_cos", "pwave"] as const;
  const specDirezione = campiDirezione.map((c) => variabili.find((v) => v.id === c));
  const asseDirezione = useQuery({
    queryKey: ["asseDirezione", specDirezione[0]?.tipi.an.mesi.join()],
    enabled: direzione && specDirezione.every(Boolean),
    queryFn: async () => asseDeiTempi(
      await leggiIndice("dwave_sin", "an", specDirezione[0]!.tipi.an.mesi),
      await leggiIndice("dwave_sin", "fc", specDirezione[0]!.tipi.fc.mesi),
    ),
  });

  const cache = useMemo(() => new CacheFrame(), []);
  const prefetcher = useMemo(
    () => new Prefetcher(cache, scelta?.id ?? variabile, (ora: Ora) =>
      leggiFrame(urlFrame(scelta?.id ?? variabile, ora.tipo, ora.riferimento, new Date(ora.istante)),
                 catalogo.data!.griglia)),
    [cache, scelta?.id, variabile, catalogo.data],
  );

  const prefetcherDirezione = useMemo(
    () => (catalogo.data
      ? campiDirezione.map((campo) => new Prefetcher(cache, campo, (ora: Ora) =>
          leggiFrame(urlFrame(campo, ora.tipo, ora.riferimento, new Date(ora.istante)),
                     catalogo.data!.griglia)))
      : null),
    [cache, catalogo.data],
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
        grandezza={grandezza!}
        direzione={direzione && Boolean(asseDirezione.data) && Boolean(prefetcherDirezione)}
        asseDirezione={asseDirezione.data ?? []}
        prefetcherDirezione={prefetcherDirezione}
        scaleDirezione={specDirezione.map((v) => v?.scala ?? 1) as [number, number, number]}
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
        <LayerSwitcher variabili={variabili} scelta={grandezza!.id} cambia={setVariabile} />
        <StatusBar istante={istante} ora={oraCorrente} oraDopo={oraDopo} valore={valore} unita={grandezza!.unita} variabile={scelta.id} stato={stato} />
        <Legend palette={scelta.colormap} minimo={grandezza!.minimo}
          massimo={grandezza!.massimo} unita={grandezza!.unita}>
          {/* Il ref si aggiorna **prima** di chiedere la scrittura dell'URL, non
              solo al render successivo: lo strozzatore consegna subito se la
              finestra e' gia' scaduta, e leggerebbe il valore di prima. Con un
              solo cambio e nessun altro evento a seguire (mappa ferma) quel
              valore sbagliato resterebbe nell'URL per sempre. */}
          <PaletteSwitcher
            conSegno={grandezza!.minimo < 0}
            scelta={scelta.colormap}
            cambia={(id) => { paletteRef.current = id; setPalette(id); strozzatoreUrl.invia(); }}
          />
          {/* L'interruttore delle isolinee sta nella legenda, accanto alla
              scala di colore, perche' e' la stessa domanda: come si legge il
              campo. Il colore lo legge a occhio, le linee lo leggono in
              metri. */}
          <label
            className="interruttore"
            title={haStatoDelMare(scelta.id) ? undefined
              : "Le isolinee sono i confini della scala Douglas: valgono solo per l'altezza d'onda"}
          >
            <input
              type="checkbox"
              disabled={!haStatoDelMare(scelta.id)}
              checked={isolinee && haStatoDelMare(scelta.id)}
              onChange={(e) => {
                isolineeRef.current = e.target.checked;
                setIsolinee(e.target.checked);
                strozzatoreUrl.invia();
              }}
            />
            isolinee
          </label>
          {/* L'animazione della direzione: le creste avanzano dove l'onda va,
              e la loro velocita' viene dal periodo (c = g T / 2 pi), non da un
              numero scelto a mano. */}
          <label
            className="interruttore"
            title="Le creste avanzano dove l'onda va, e sono trasversali al moto come le creste vere: in un'onda non viaggia l'acqua, viaggia la cresta. Il dato ARPAE dichiara la direzione da cui l'onda viene, come si fa col vento: qui e' girata di mezzo giro, perche' su una mappa conta dove finisce l'energia."
          >
            <input
              type="checkbox"
              checked={direzione}
              onChange={(e) => {
                direzioneRef.current = e.target.checked;
                setDirezione(e.target.checked);
                strozzatoreUrl.invia();
              }}
            />
            {/* Il nome per intero, non "direzione": e' lo stesso della grandezza
                nel selettore, e su un campo che non e' l'onda (il livello del
                mare, domani la corrente) "direzione" da sola fa pensare alla
                direzione di quello che si sta guardando. Il title dice la
                convenzione, ma su un telefono il title non esiste. */}
            direzione dell'onda
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
