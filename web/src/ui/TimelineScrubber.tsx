import * as Slider from "@radix-ui/react-slider";
import { buchi, type Ora } from "../data/indice";
import { inquadra } from "../data/sorgente";

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
  // Per prossimita' (la stessa regola con cui inquadra() sceglie il
  // fotogramma da disegnare), non per uguaglianza stretta: durante la
  // riproduzione l'istante avanza con continuita' in millisecondi e non
  // coincide quasi mai con una delle ore dell'asse. Un confronto stretto
  // ricadeva sempre sull'indice 0, e lo scrubber restava visivamente fermo
  // sulla prima ora della finestra mentre il campo disegnato avanzava per
  // davvero: la stessa scelta con due regole diverse avrebbe potuto mostrare
  // un'ora e disegnare il campo di un'altra.
  const inquadratura = inquadra(asse, istante);
  const indiceCorrente = inquadratura ? asse.indexOf(inquadratura.prima) : 0;
  const oraCorrente = asse[indiceCorrente] as Ora | undefined;

  // buchi() si fida che l'asse sia ordinato: qui arriva da asseDeiTempi (o da
  // un asse costruito allo stesso modo nei test), non da un ordinamento
  // arbitrario del chiamante.
  const buchiTrovati = buchi(asse);

  // L'ultimo indice di analisi, piu' uno: non il primo indice di previsione.
  // buchi() esiste apposta per lo scenario in cui un'ora di analisi manca nel
  // passato ed e' coperta da una previsione (un buco riempito): in quel caso
  // findIndex(fc) si fermerebbe sulla previsione di riempimento, molto prima
  // dell'ultima analisi vera, e il confine salterebbe indietro mostrando come
  // "previsione" ore che sono analisi. Cercando l'ultima analisi (che puo'
  // stare oltre quel buco) il confine cade dove analisi e previsione
  // smettono davvero di alternarsi.
  let ultimoIndiceAn = -1;
  for (let i = 0; i < asse.length; i++) {
    if (asse[i].tipo === "an") ultimoIndiceAn = i;
  }
  const indiceConfine = ultimoIndiceAn + 1;
  // Nessun confine da disegnare se non c'e' previsione dopo l'ultima analisi
  // (indiceConfine oltre l'ultimo indice): un asse tutto di analisi non ha
  // niente da segnare.
  const frazioneConfine =
    ultimo > 0 && indiceConfine <= ultimo ? indiceConfine / ultimo : null;

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
