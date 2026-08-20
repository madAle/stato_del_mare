import type { Variabile } from "../data/catalogo";
import { grandezzeDi } from "./grandezze";

/** Spiegazione visibile su ogni grandezza che il catalogo pubblica ma che questa versione non disegna. */
const NOTA_NON_DISEGNATA = "Non ancora disegnabile: direzione e corrente vogliono le frecce, il livello del mare una scala col segno";

/**
 * L'elenco viene dal catalogo, non dal codice.
 *
 * Cablare qui le variabili significherebbe che aggiungere un layer costa una
 * modifica alla UI invece di un run dell'ingestore. Le grandezze che questa
 * versione non sa ancora disegnare compaiono comunque, ma disabilitate:
 * selezionarne una lascerebbe la legenda su un'unita' e la mappa a disegnarne
 * un'altra, cioe' uno schermo che dice il falso invece di un comando che
 * semplicemente non fa niente. Chi sa disegnarsi lo dichiara in `grandezze.ts`.
 *
 * I nomi e l'accorpamento delle componenti stanno in `grandezze.ts`: qui si
 * mostra quello che il catalogo pubblica, li' si decide come si chiama. Il
 * catalogo pubblica `dwave_sin` e `dwave_cos` perche' un angolo non si puo'
 * interpolare, ma in un menu quella e' una cosa sola e si chiama direzione.
 */
export function LayerSwitcher({
  variabili, scelta, cambia,
}: { variabili: Variabile[]; scelta: string; cambia: (id: string) => void }) {
  return (
    <select value={scelta} onChange={(e) => cambia(e.target.value)} aria-label="variabile">
      {grandezzeDi(variabili).map((g) => (
        <option
          key={g.id}
          value={g.id}
          disabled={!g.disegnabile}
          title={g.disegnabile ? undefined : NOTA_NON_DISEGNATA}
        >
          {g.nome}
        </option>
      ))}
    </select>
  );
}
