import { urlIndice, type Tipo } from "./urls";

/** Istante in millisecondi UTC verso la data di riferimento che lo contiene. */
export type Indice = Map<number, string>;

export type Ora = { istante: number; tipo: Tipo; riferimento: string };

/** Passo dell'asse: ADRIAC pubblica i campi 2D a passo orario. */
export const PASSO_MS = 3_600_000;

export async function leggiIndice(
  variabile: string,
  tipo: Tipo,
  mesi: string[],
  recupera: typeof fetch = fetch,
): Promise<Indice> {
  const fuso: Indice = new Map();
  for (const mese of mesi) {
    const risposta = await recupera(urlIndice(variabile, tipo, mese));
    // Un mese assente non e' un guasto: il mese prima dell'inizio
    // dell'archivio semplicemente non esiste, e trattarlo come errore
    // renderebbe impossibile aprire l'app il primo giorno di un mese nuovo.
    if (risposta.status === 404) continue;
    if (!risposta.ok) throw new Error(`indice ${variabile}/${tipo}/${mese}: HTTP ${risposta.status}`);
    const g = await risposta.json();
    for (const [iso, riferimento] of Object.entries(g.hours as Record<string, string>)) {
      fuso.set(Date.parse(iso), riferimento);
    }
  }
  return fuso;
}

/**
 * L'asse navigabile: tutte le ore disponibili, con l'analisi che vince.
 *
 * La regola sta qui e non nella UI perche' e' una proprieta' del dato: dove
 * esiste l'analisi, la previsione della stessa ora e' superata per definizione.
 */
export function asseDeiTempi(analisi: Indice, previsione: Indice): Ora[] {
  const ore = new Map<number, Ora>();
  for (const [istante, riferimento] of previsione) {
    ore.set(istante, { istante, tipo: "fc", riferimento });
  }
  for (const [istante, riferimento] of analisi) {
    ore.set(istante, { istante, tipo: "an", riferimento });
  }
  return [...ore.values()].sort((a, b) => a.istante - b.istante);
}

/**
 * Gli intervalli mancanti sull'asse.
 *
 * Lo scrubber deve mostrarli invece di scavalcarli: un giorno senza ingestione
 * e' storico perso per sempre, e una timeline che lo salta in silenzio fa
 * credere che il mare sia stato continuo mentre il dato non c'e'.
 *
 * Richiede che l'asse sia ordinato in senso crescente per istante: un asse non
 * ordinato non e' un caso da gestire ma un difetto di chi lo ha costruito.
 */
export function buchi(asse: Ora[]): { da: number; a: number }[] {
  for (let i = 1; i < asse.length; i++) {
    if (asse[i].istante < asse[i - 1].istante) {
      throw new Error(`asse non ordinato: istante ${asse[i].istante} dopo ${asse[i - 1].istante}`);
    }
  }
  const trovati: { da: number; a: number }[] = [];
  for (let i = 1; i < asse.length; i++) {
    if (asse[i].istante - asse[i - 1].istante > PASSO_MS) {
      trovati.push({ da: asse[i - 1].istante, a: asse[i].istante });
    }
  }
  return trovati;
}
