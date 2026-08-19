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

/**
 * Converte davvero `kinds` (il campo del JSON grezzo, in inglese) in `tipi`
 * (il campo del tipo `Variabile`, in italiano), invece di limitarsi ad
 * affermarne la forma con un cast.
 *
 * Un cast come `v.kinds as Variabile["tipi"]` dice al compilatore di fidarsi
 * di una forma che a runtime non c'e' mai: il bucket scrive
 * `{"an": {"months": [...]}}`, non `{"an": {"mesi": [...]}}`. Il risultato e'
 * `mesi` sempre `undefined`, e chi lo legge (`App.tsx`) crasha al primo
 * render con dati veri. Qui il campo si rinomina davvero, non si finge.
 *
 * `kinds` arriva come `unknown` (non tipizzato dal chiamante): un catalogo
 * con una forma inattesa (campo assente, "an"/"fc" mancanti, "months" non un
 * elenco) faceva sollevare a `Object.entries` o alla destrutturazione un
 * `TypeError` grezzo ("Cannot convert undefined or null to object", o
 * simili), che non dice ne' quale variabile ne' cosa non torna. Qui si
 * controlla la forma prima di usarla, e si solleva un errore in italiano che
 * nomina la variabile e il campo mancante.
 */
function convertiTipi(idVariabile: string, kinds: unknown): Variabile["tipi"] {
  if (typeof kinds !== "object" || kinds === null) {
    throw new Error(
      `catalogo malformato: la variabile "${idVariabile}" non ha un campo "kinds" leggibile`,
    );
  }
  const risultato = {} as Variabile["tipi"];
  for (const tipo of ["an", "fc"] as const) {
    const voce = (kinds as Record<string, unknown>)[tipo];
    const mesi = voce && typeof voce === "object" ? (voce as { months?: unknown }).months : undefined;
    if (!Array.isArray(mesi)) {
      throw new Error(
        `catalogo malformato: la variabile "${idVariabile}" non ha "kinds.${tipo}.months" come elenco`,
      );
    }
    risultato[tipo] = { mesi: mesi as string[] };
  }
  return risultato;
}

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
      tipi: convertiTipi(v.id as string, v.kinds),
    })),
  };
}
