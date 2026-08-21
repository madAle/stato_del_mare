import type { Variabile } from "../data/catalogo";
import { grandezzeDi } from "./grandezze";

/**
 * Spiegazione visibile su ogni grandezza che il catalogo pubblica ma che questa
 * versione non disegna.
 *
 * Generica di proposito: la porta anche un campo che la tabella delle grandezze
 * non conosce, di cui non sappiamo niente. Prima elencava i casi ("direzione e
 * corrente vogliono le frecce, il livello del mare una scala col segno") e
 * invecchiava male: al 2026-08-21 due dei tre erano falsi.
 */
const NOTA_NON_DISEGNATA = "Non ancora disegnabile: la legenda direbbe un'unita' e la mappa ne disegnerebbe un'altra";

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
 * **Chi ha un comando suo qui non compare**: e' il caso della direzione
 * dell'onda, che si accende dal suo interruttore. Non e' una deroga alla regola
 * di sopra, perche' quella regola esiste perche' nessun dato in archivio
 * diventi invisibile, e la direzione invisibile non e': ha un comando, e ha lo
 * stesso nome. Il filtro e' su `comandoSuo` e **non** su `disegnabile`: sul
 * secondo spariscono la corrente e i campi sconosciuti, che e' proprio quello
 * che non si deve fare.
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
      {grandezzeDi(variabili).filter((g) => !g.comandoSuo).map((g) => (
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
