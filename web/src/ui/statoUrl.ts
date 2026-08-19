// Serializz e deserializz lo stato della vista nell'URL.
// Consente di condividere un link che punta a un fotogramma esatto.
// Usare history.replaceState (non pushState) per non intasare la cronologia del browser.

export type StatoUrl = {
  istante: number | null;
  variabile: string | null;
  /** Nome della tavolozza, per condividere anche la scelta di colore. */
  palette: string | null;
  zoom: number | null;
  centro: [number, number] | null;
};

// Legge lo stato dalla query string dell'URL.
// Restituisce null per ogni valore non valido invece di sollevare eccezione:
// un link vecchio o troncato deve aprire l'app sulle impostazioni predefinite,
// non su una pagina bianca.
export function leggiStatoUrl(ricerca: string): StatoUrl {
  const params = new URLSearchParams(ricerca);

  // istante: ISO 8601 string convertito a millisecondi con Date.parse
  let istante: number | null = null;
  const tStr = params.get("t");
  if (tStr) {
    const parsed = Date.parse(tStr);
    if (!isNaN(parsed)) {
      istante = parsed;
    }
  }

  // palette: stessa regola della variabile. Sta qui e non in un parametro
  // letto per conto suo perche' l'URL ha un solo scrittore: un secondo lettore
  // che non scrive verrebbe cancellato dal primo aggiornamento, e la scelta
  // sparirebbe dal link appena il tempo avanza.
  let palette: string | null = null;
  const palStr = params.get("palette");
  if (palStr) palette = palStr;

  // variabile: stringa non vuota, null se assente o vuota
  let variabile: string | null = null;
  const varStr = params.get("var");
  if (varStr) {
    variabile = varStr;
  }

  // zoom: numero finito (MapLibre supporta zoom frazionari)
  let zoom: number | null = null;
  const zStr = params.get("z");
  if (zStr) {
    const parsed = Number(zStr);
    if (Number.isFinite(parsed)) {
      zoom = parsed;
    }
  }

  // centro: coordinate come "lat,lon"
  let centro: [number, number] | null = null;
  const cStr = params.get("c");
  if (cStr) {
    const parts = cStr.split(",");
    if (parts.length === 2) {
      const lat = Number(parts[0]);
      const lon = Number(parts[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        centro = [lat, lon];
      }
    }
  }

  return { istante, variabile, palette, zoom, centro };
}

// Scrive lo stato sulla query string dell'URL.
// Produce un formato leggibile da leggiStatoUrl in modo identico
// (giro completo: scrivi, rileggi, ottieni lo stesso oggetto).
export function scriviStatoUrl(stato: StatoUrl): string {
  const params = new URLSearchParams();

  if (stato.istante !== null) {
    // Convertire il numero di millisecondi a ISO 8601 string
    const date = new Date(stato.istante);
    params.set("t", date.toISOString());
  }

  if (stato.palette !== null) {
    params.set("palette", stato.palette);
  }
  if (stato.variabile !== null) {
    params.set("var", stato.variabile);
  }

  if (stato.zoom !== null) {
    params.set("z", String(stato.zoom));
  }

  if (stato.centro !== null) {
    params.set("c", `${stato.centro[0]},${stato.centro[1]}`);
  }

  const str = params.toString();
  return str ? "?" + str : "";
}
