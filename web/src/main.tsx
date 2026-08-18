/// <reference types="vite/client" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StyleSpecification } from "maplibre-gl";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

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
    // Il colore non e' arbitrario: deve restare distinguibile dal rosato con
    // cui si colora il campo (vedi web/e2e/resa.spec.ts) anche dopo che il
    // campo vi si mescola sopra con la propria opacita' parziale.
    layers: [{ id: "sfondo", type: "background", paint: { "background-color": "#bec3c8" } }],
  };
}

const stileTest =
  import.meta.env.DEV && import.meta.env.VITE_E2E === "1" ? stileMinimoPerITest() : undefined;

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

  const queryClient = new QueryClient();

  createRoot(document.getElementById("radice")!).render(
    <QueryClientProvider client={queryClient}>
      <App costa={costa} maschera={maschera} metaCosta={metaCosta} metaMaschera={metaMaschera}
           stile={stileTest} />
    </QueryClientProvider>,
  );
}

void avvia();
