/**
 * Le tavolozze che si possono scegliere a schermo, con il nome che ha senso per
 * chi guarda e non quello di cmocean.
 *
 * Sono tre e non tutte quelle disponibili: un elenco lungo di nomi tecnici
 * (`haline`, `thermal`, `balance`) invita a provarle su una grandezza per cui
 * non sono state fatte, e le palette di cmocean sono scelte per tipo di dato,
 * non per gusto. Queste tre sono state confrontate guardando lo stesso campo.
 */
export const TAVOLOZZE = [
  { id: "deep", nome: "giallo e blu" },
  { id: "dense", nome: "blu" },
  { id: "amp", nome: "rosso" },
] as const;

export function PaletteSwitcher({
  scelta, cambia,
}: {
  scelta: string;
  cambia: (id: string) => void;
}) {
  return (
    <select
      className="selettore-tavolozza"
      aria-label="tavolozza dei colori"
      value={TAVOLOZZE.some((t) => t.id === scelta) ? scelta : TAVOLOZZE[0].id}
      onChange={(e) => cambia(e.target.value)}
    >
      {TAVOLOZZE.map((t) => (
        <option key={t.id} value={t.id}>{t.nome}</option>
      ))}
    </select>
  );
}
