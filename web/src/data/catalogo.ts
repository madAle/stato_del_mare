import { urlCatalogo, type Tipo } from "./urls";

export type Griglia = {
  larghezza: number;
  altezza: number;
  risoluzioneM: number;
  boundsLonLat: { ovest: number; sud: number; est: number; nord: number };
};

export type Variabile = {
  id: string;
  unita: string;
  scala: number;
  offset: number;
  colormap: string;
  tipi: Record<Tipo, { mesi: string[] }>;
};

export type Catalogo = {
  schemaVersion: number;
  generatoIl: string;
  griglia: Griglia;
  variabili: Variabile[];
};

/** Lo schema che questo client sa leggere. */
export const SCHEMA_ATTESO = 2;

/**
 * L'unica variabile che questa versione della SPA disegna davvero.
 *
 * Il catalogo ne pubblica altre (l'ingestore le scrive gia'), ma la mappa
 * conosce solo la scala e il colormap di questa. Il LayerSwitcher le elenca
 * comunque, lette dal catalogo e non cablate, ma disabilita le altre: senza
 * quel limite, selezionarne una diversa lascerebbe la legenda su un'unita' e
 * la mappa a disegnare un'altra, con un numero sotto il mouse calcolato con
 * la scala sbagliata. Un comando che cambia meta' schermo e lascia l'altra
 * meta' al valore vecchio dice una cosa falsa, che e' peggio di un comando
 * che non fa niente.
 */
export const VARIABILE_DISEGNATA = "hwave";

export async function leggiCatalogo(recupera: typeof fetch = fetch): Promise<Catalogo> {
  const risposta = await recupera(urlCatalogo());
  if (!risposta.ok) throw new Error(`catalogo non leggibile: HTTP ${risposta.status}`);
  const g = await risposta.json();

  // Uno schema piu' nuovo si ferma invece di provarci: il pacchetto e' un
  // contratto durevole, e un client che indovina un formato che non conosce
  // disegna numeri plausibili e sbagliati. Fermarsi e' meglio che sbagliare.
  if (g.schema_version !== SCHEMA_ATTESO) {
    throw new Error(
      `il bucket pubblica lo schema ${g.schema_version}, questo client legge il ` +
        `${SCHEMA_ATTESO}. Aggiornare la SPA prima di continuare.`,
    );
  }

  return {
    schemaVersion: g.schema_version,
    generatoIl: g.generated_at,
    griglia: {
      larghezza: g.grid.width,
      altezza: g.grid.height,
      risoluzioneM: g.grid.resolution_m,
      boundsLonLat: {
        ovest: g.grid.bounds_lonlat.west,
        sud: g.grid.bounds_lonlat.south,
        est: g.grid.bounds_lonlat.east,
        nord: g.grid.bounds_lonlat.north,
      },
    },
    variabili: g.variables.map((v: Record<string, unknown>) => ({
      id: v.id as string,
      unita: v.units as string,
      scala: v.scale as number,
      offset: v.offset as number,
      colormap: v.colormap as string,
      tipi: v.kinds as Variabile["tipi"],
    })),
  };
}
