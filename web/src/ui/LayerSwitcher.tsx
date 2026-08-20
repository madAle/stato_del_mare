import { VARIABILE_DISEGNATA, type Variabile } from "../data/catalogo";
import { grandezzeDi } from "./grandezze";

/** Spiegazione visibile su ogni grandezza che il catalogo pubblica ma che questa versione non disegna. */
const NOTA_NON_DISEGNATA = "In questa versione si disegna solo l'altezza d'onda";

/**
 * L'elenco viene dal catalogo, non dal codice.
 *
 * In v1 si disegna solo hwave, ma cablare l'unica variabile qui significherebbe
 * che aggiungere un layer costa una modifica alla UI invece di un run
 * dell'ingestore. Le altre grandezze del catalogo compaiono comunque, per la
 * stessa ragione, ma disabilitate: selezionarne una lascerebbe la legenda su
 * un'unita' e la mappa a disegnarne un'altra, cioe' uno schermo che dice il
 * falso invece di un comando che semplicemente non fa niente.
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
          disabled={g.id !== VARIABILE_DISEGNATA}
          title={g.id === VARIABILE_DISEGNATA ? undefined : NOTA_NON_DISEGNATA}
        >
          {g.nome}
        </option>
      ))}
    </select>
  );
}
