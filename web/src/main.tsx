/// <reference types="vite/client" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { urlGlifi } from "./data/urls";
// Il nostro, dopo quello di MapLibre: qui non si sovrascrive niente della
// mappa, ma se un domani servisse l'ordine e' quello giusto.
import "./styles.css";

/**
 * Stile minimo per i test end to end: nessuna sorgente esterna, un solo
 * livello di sfondo piatto.
 *
 * La basemap vettoriale vera pesa 700 MB e non e' ancora pubblicata sul
 * bucket (e' una decisione dell'utente, non nostra): con lo stile predefinito
 * `creaMappa` rifiuterebbe sempre in questo ambiente, e i test di resa e di
 * coerenza (che verificano il campo, non la basemap) non arriverebbero mai a
 * montare l'applicazione. La condizione e' doppia apposta: `import.meta.env.DEV`
 * fa sparire questo ramo dal bundle di produzione per tree shaking, e la
 * variabile d'ambiente la attiva solo quando Playwright avvia il server di
 * sviluppo apposta per questi test.
 */
function stileMinimoPerITest(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    // I glifi servono ai numeri che corrono sulle isolinee: senza, quel livello
    // non disegna niente e il test che li cerca fallirebbe per una ragione che
    // non ha a che vedere con le isolinee. Sono gli stessi del bucket, gia'
    // pubblicati, e ne scarica un intervallo solo (le cifre e la 'm').
    glyphs: urlGlifi(),
    // Il colore non e' arbitrario: deve restare distinguibile dal rosato con
    // cui si colora il campo (vedi web/e2e/resa.spec.ts) anche dopo che il
    // campo vi si mescola sopra con la propria opacita' parziale.
    layers: [{ id: "sfondo", type: "background", paint: { "background-color": "#bec3c8" } }],
  };
}

// La stessa condizione decide sia lo stile minimo sopra sia
// preserveDrawingBuffer sotto: sono i due interruttori che questa build ha
// bisogno di accendere solo quando Playwright avvia il server apposta per i
// test end to end, mai in produzione.
const modalitaTest = import.meta.env.DEV && import.meta.env.VITE_E2E === "1";

const stileTest = modalitaTest ? stileMinimoPerITest() : undefined;

/**
 * Un contesto WebGL, dopo aver composto il fotogramma, non e' tenuto a
 * conservare il proprio buffer di disegno: il browser puo' svuotarlo appena
 * dopo averlo mostrato, a meno che non lo si chieda esplicitamente qui.
 * Senza, rileggere il canvas con `drawImage`/`getImageData` (come fa
 * `web/e2e/resa.spec.ts`, per controllare che il campo sia dipinto nel posto
 * giusto) restituisce sempre nero anche quando a schermo si vede tutto,
 * verificato isolando il problema in una pagina WebGL minima senza MapLibre.
 * Costa prestazioni (il browser non puo' piu' scartare il buffer appena
 * usato), quindi resta spento in produzione: nessuno oltre a un test ha
 * bisogno di rileggere il canvas.
 */
const preserveDrawingBufferTest = modalitaTest;

/**
 * Carica un'immagine e aspetta che sia decodificata prima di usarla come
 * texture. Senza `decode()` il livello WebGL partirebbe con la texture ancora
 * vuota, e si vedrebbe per un fotogramma il campo non ritagliato dalla costa.
 */
async function caricaImmagine(url: string): Promise<HTMLImageElement> {
  const immagine = new Image();
  immagine.src = url;
  await immagine.decode();
  return immagine;
}

async function caricaJson<T>(url: string): Promise<T> {
  const risposta = await fetch(url);
  if (!risposta.ok) throw new Error(`${url}: HTTP ${risposta.status}`);
  return (await risposta.json()) as T;
}

type MetaDistanza = { limite_m: number };

async function avvia(): Promise<void> {
  const [costa, maschera, metaCosta, metaMaschera] = await Promise.all([
    caricaImmagine("/costa_sdf.png"),
    caricaImmagine("/maschera_dato.png"),
    caricaJson<MetaDistanza>("/costa_sdf.json"),
    caricaJson<MetaDistanza>("/maschera_dato.json"),
  ]);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Il bucket si aggiorna a lotti una volta al giorno (vedi CLAUDE.md),
        // non ogni volta che la scheda torna in primo piano: senza
        // staleTime, React Query lo considera scaduto appena letto e lo
        // ricarica al primo refetchOnWindowFocus, ricreando catalogo e asse
        // con una nuova identita' di oggetto. MapView costruisce l'animazione
        // una volta sola al montaggio (per non ricreare il contesto WebGL a
        // ogni cambio di scheda): un catalogo che cambia identita' sotto di
        // lei, senza che i suoi valori cambino davvero, la farebbe lavorare
        // in silenzio su un asse diverso da quello che lo scrubber mostra.
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });

  createRoot(document.getElementById("radice")!).render(
    <QueryClientProvider client={queryClient}>
      <App costa={costa} maschera={maschera} metaCosta={metaCosta} metaMaschera={metaMaschera}
           stile={stileTest} preserveDrawingBuffer={preserveDrawingBufferTest} />
    </QueryClientProvider>,
  );
}

/**
 * Senza questo catch, un asset mancante (costa_sdf.png o maschera_dato.png
 * non versionati, vedi strumenti/costa_sdf.py) fa rigettare la promessa di
 * avvia() prima che render() sia mai chiamato: React non monta niente, e
 * resta una pagina bianca con un errore visibile solo in console. Qui non si
 * usa React (potrebbe essere proprio React, o uno dei suoi moduli, a non
 * essere arrivato): si scrive direttamente nel DOM, con il minimo che possa
 * fallire a sua volta.
 */
function mostraErroreAvvio(errore: unknown): void {
  console.error("avvio dell'applicazione fallito", errore);
  const radice = document.getElementById("radice");
  if (!radice) return;

  const main = document.createElement("main");
  main.className = "errore";

  const corpo = document.createElement("div");
  const titolo = document.createElement("p");
  titolo.textContent = "Impossibile avviare l'applicazione.";
  const suggerimento = document.createElement("p");
  suggerimento.textContent =
    "Mancano probabilmente gli asset locali costa_sdf.png/.json e " +
    "maschera_dato.png/.json (non sono versionati): si generano eseguendo " +
    "strumenti/costa_sdf.py e strumenti/maschera_dato.py.";
  const dettaglio = document.createElement("p");
  dettaglio.textContent = errore instanceof Error ? errore.message : String(errore);

  corpo.append(titolo, suggerimento, dettaglio);
  main.append(corpo);
  radice.replaceChildren(main);
}

void avvia().catch(mostraErroreAvvio);
