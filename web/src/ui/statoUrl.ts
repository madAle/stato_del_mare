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
  /**
   * Il punto osservato, come "lat,lon". Viaggia nell'URL come tutto il resto
   * dello stato: un link che dice "guarda qui" senza dire quale punto stavi
   * guardando manda a vedere una mappa, non una misura.
   */
  punto: [number, number] | null;
  /**
   * Se le isolinee sono accese. Viaggia nell'URL come tutto il resto: un link
   * che dice "guarda qui" deve riaprire la mappa come la si stava guardando,
   * comprese le linee che uno aveva tolto per vedere il campo pulito.
   */
  isolinee: boolean | null;
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

  // punto: stesso formato del centro, e stessa regola di tolleranza. Sta nello
  // stesso lettore e nello stesso scrittore di tutto il resto: un parametro
  // letto da qualcuno e non riscritto verrebbe cancellato al primo
  // aggiornamento dell'URL, cioe' appena il tempo avanza.
  let punto: [number, number] | null = null;
  const pStr = params.get("p");
  if (pStr) {
    const parts = pStr.split(",");
    if (parts.length === 2) {
      const lat = Number(parts[0]);
      const lon = Number(parts[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        punto = [lat, lon];
      }
    }
  }

  // isolinee: "1" o "0". Qualunque altra cosa (o l'assenza) vale null, cioe'
  // "non detto", e chi legge decide il suo predefinito. Non si interpreta una
  // stringa qualsiasi come "vero": un link storto accenderebbe o spegnerebbe
  // le linee a caso invece di lasciare l'impostazione di casa.
  let isolinee: boolean | null = null;
  const isoStr = params.get("iso");
  if (isoStr === "1") isolinee = true;
  else if (isoStr === "0") isolinee = false;

  return { istante, variabile, palette, zoom, centro, punto, isolinee };
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

  if (stato.punto !== null) {
    params.set("p", `${stato.punto[0]},${stato.punto[1]}`);
  }

  if (stato.isolinee !== null) {
    params.set("iso", stato.isolinee ? "1" : "0");
  }

  const str = params.toString();
  return str ? "?" + str : "";
}
