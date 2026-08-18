import * as Slider from "@radix-ui/react-slider";
import { buchi, type Ora } from "../data/indice";

type Props = {
  asse: Ora[];
  istante: number;
  cambia: (istante: number) => void;
};

/**
 * Il dato e' orario e riferito a un istante UTC fisso (ocean_time, non l'ora
 * del file): mostrarlo nel fuso del browser farebbe leggere ore diverse a chi
 * guarda lo stesso frame da fusi diversi, quindi si formatta sempre in UTC.
 */
const formattaOra = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Lo scrubber non e' un intervallo continuo: e' un asse di ore che puo' avere
 * buchi, e il valore dello slider di Radix e' l'indice su quell'asse, non il
 * tempo. Cosi' un'ora mancante non e' semplicemente disegnata come assente,
 * e' proprio irraggiungibile da tastiera o da trascinamento: non esiste una
 * posizione dello slider che vi corrisponda.
 *
 * Sopra la traccia si disegnano, in frazione dell'asse (indice diviso
 * ultimo indice, cosi' la stessa scala vale per lo slider e per i segni):
 * un rettangolo per ogni buco restituito da buchi(asse), lo sfondo della
 * zona di previsione, e il confine netto fra analisi e previsione.
 */
export function TimelineScrubber({ asse, istante, cambia }: Props) {
  const ultimo = asse.length - 1;
  const indiceTrovato = asse.findIndex((o) => o.istante === istante);
  const indiceCorrente = indiceTrovato >= 0 ? indiceTrovato : 0;
  const oraCorrente = asse[indiceCorrente] as Ora | undefined;

  // buchi() si fida che l'asse sia ordinato: qui arriva da asseDeiTempi (o da
  // un asse costruito allo stesso modo nei test), non da un ordinamento
  // arbitrario del chiamante.
  const buchiTrovati = buchi(asse);

  const indiceConfine = asse.findIndex((o) => o.tipo === "fc");
  const frazioneConfine =
    indiceConfine !== -1 && ultimo > 0 ? indiceConfine / ultimo : null;

  const frazione = (indice: number) => (ultimo > 0 ? indice / ultimo : 0);

  return (
    <div className="scrubber">
      <div className="scrubber-orologio" data-testid="orologio">
        {oraCorrente
          ? `${formattaOra.format(oraCorrente.istante)} UTC (${
              oraCorrente.tipo === "an" ? "analisi" : "previsione"
            })`
          : "nessun dato"}
      </div>
      <div className="scrubber-traccia">
        {frazioneConfine !== null && (
          <div
            className="scrubber-zona-previsione"
            style={{
              position: "absolute",
              left: `${frazioneConfine * 100}%`,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
        )}
        {buchiTrovati.map((buco) => {
          const idxDa = asse.findIndex((o) => o.istante === buco.da);
          if (idxDa < 0) return null;
          const daPerc = frazione(idxDa) * 100;
          const aPerc = frazione(idxDa + 1) * 100;
          return (
            <div
              key={buco.da}
              data-testid="buco"
              className="scrubber-buco"
              title="Ore mancanti: dato non disponibile"
              style={{
                position: "absolute",
                left: `${daPerc}%`,
                width: `${aPerc - daPerc}%`,
                top: 0,
                bottom: 0,
              }}
            />
          );
        })}
        {frazioneConfine !== null && (
          <div
            className="scrubber-confine"
            data-testid="confine"
            data-frazione={frazioneConfine}
            style={{
              position: "absolute",
              left: `${frazioneConfine * 100}%`,
              top: 0,
              bottom: 0,
            }}
          />
        )}
        <Slider.Root
          className="scrubber-slider"
          min={0}
          max={Math.max(ultimo, 0)}
          step={1}
          value={[indiceCorrente]}
          onValueChange={([indice]) => {
            const scelta = asse[indice];
            if (scelta) cambia(scelta.istante);
          }}
        >
          <Slider.Track className="scrubber-slider-traccia">
            <Slider.Range className="scrubber-slider-range" />
          </Slider.Track>
          <Slider.Thumb className="scrubber-slider-cursore" aria-label="Ora selezionata" />
        </Slider.Root>
      </div>
    </div>
  );
}
