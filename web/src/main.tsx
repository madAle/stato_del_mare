import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

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
      <App costa={costa} maschera={maschera} metaCosta={metaCosta} metaMaschera={metaMaschera} />
    </QueryClientProvider>,
  );
}

void avvia();
