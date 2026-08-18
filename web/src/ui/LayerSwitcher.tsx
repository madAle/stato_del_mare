import type { Variabile } from "../data/catalogo";

/**
 * L'elenco viene dal catalogo, non dal codice.
 *
 * In v1 si disegna solo hwave, ma cablare l'unica variabile qui significherebbe
 * che aggiungere un layer costa una modifica alla UI invece di un run
 * dell'ingestore.
 */
export function LayerSwitcher({
  variabili, scelta, cambia,
}: { variabili: Variabile[]; scelta: string; cambia: (id: string) => void }) {
  return (
    <select value={scelta} onChange={(e) => cambia(e.target.value)} aria-label="variabile">
      {variabili.map((v) => (
        <option key={v.id} value={v.id}>{v.id}</option>
      ))}
    </select>
  );
}
