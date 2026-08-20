/**
 * Le tavolozze che si possono scegliere a schermo, con il nome che ha senso per
 * chi guarda e non quello di cmocean.
 *
 * Sono poche e non tutte quelle disponibili: un elenco lungo di nomi tecnici
 * (`haline`, `thermal`, `balance`) invita a provarle su una grandezza per cui
 * non sono state fatte, e le palette di cmocean sono scelte **per tipo di
 * dato**, non per gusto. Queste tre sono state confrontate guardando lo stesso
 * campo.
 */
export const TAVOLOZZE = [
  { id: "deep", nome: "giallo e blu" },
  { id: "dense", nome: "blu" },
  { id: "amp", nome: "rosso" },
] as const;

/**
 * Per una grandezza con segno serve una tavolozza **divergente**, cioe' con un
 * colore neutro in mezzo: e' quello che fa vedere dov'e' lo zero. Con una
 * sequenziale il livello medio del mare non avrebbe nessun colore che lo
 * distingue, e sopra e sotto si leggerebbero come "piu'" e "meno" di qualcosa
 * invece che come due versi opposti.
 *
 * Ce n'e' una sola, quindi il comando resta a schermo ma disabilitato: e' un
 * modo di dire "qui la scelta non c'e'", che e' diverso dal farlo sparire e
 * lasciare chi guarda a chiedersi dove sia finito.
 */
export const TAVOLOZZE_CON_SEGNO = [
  { id: "balance", nome: "rosso e blu" },
] as const;

export function PaletteSwitcher({
  scelta, cambia, conSegno = false,
}: {
  scelta: string;
  cambia: (id: string) => void;
  /** Se la grandezza ha segno: cambia l'elenco, non solo il valore mostrato. */
  conSegno?: boolean;
}) {
  const elenco: readonly { id: string; nome: string }[] =
    conSegno ? TAVOLOZZE_CON_SEGNO : TAVOLOZZE;
  return (
    <select
      className="selettore-tavolozza"
      aria-label="tavolozza dei colori"
      disabled={elenco.length < 2}
      title={elenco.length < 2
        ? "Una grandezza con segno vuole una tavolozza divergente, e ce n'e' una sola"
        : undefined}
      value={elenco.some((t) => t.id === scelta) ? scelta : elenco[0].id}
      onChange={(e) => cambia(e.target.value)}
    >
      {elenco.map((t) => (
        <option key={t.id} value={t.id}>{t.nome}</option>
      ))}
    </select>
  );
}
