import { VARIABILE_DISEGNATA, type Variabile } from "../data/catalogo";

/** Spiegazione visibile su ogni variabile che il catalogo pubblica ma che questa versione non disegna. */
const NOTA_NON_DISEGNATA = "In questa versione si disegna solo l'altezza d'onda (hwave)";

/**
 * L'elenco viene dal catalogo, non dal codice.
 *
 * In v1 si disegna solo hwave, ma cablare l'unica variabile qui significherebbe
 * che aggiungere un layer costa una modifica alla UI invece di un run
 * dell'ingestore. Le altre variabili del catalogo compaiono comunque, per la
 * stessa ragione, ma disabilitate: selezionarne una lascerebbe la legenda su
 * un'unita' e la mappa a disegnarne un'altra, cioe' uno schermo che dice il
 * falso invece di un comando che semplicemente non fa niente.
 */
export function LayerSwitcher({
  variabili, scelta, cambia,
}: { variabili: Variabile[]; scelta: string; cambia: (id: string) => void }) {
  return (
    <select value={scelta} onChange={(e) => cambia(e.target.value)} aria-label="variabile">
      {variabili.map((v) => (
        <option
          key={v.id}
          value={v.id}
          disabled={v.id !== VARIABILE_DISEGNATA}
          title={v.id === VARIABILE_DISEGNATA ? undefined : NOTA_NON_DISEGNATA}
        >
          {v.id}
        </option>
      ))}
    </select>
  );
}
