import * as Slider from "@radix-ui/react-slider";
import { buchi, type Ora } from "../data/indice";
import { istanteEsteso, soloGiorno, soloOra, tacche } from "./tempo";
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
  // Il cursore resta comunque da qualche parte sulla traccia (indice 0) anche
  // quando l'istante e' fuori dall'asse, ma l'orologio no: prima ricadeva su
  // asse[0] anche in quel caso, mostrando un'ora vera mentre la barra di
  // stato (App.tsx, stessa chiamata a inquadra) diceva gia' "nessun dato". Le
  // due parti dello schermo si contraddicevano. Ora l'orologio segue la
  // stessa regola della barra di stato: nessuna inquadratura, nessun'ora.
  const indiceCorrente = inquadratura ? asse.indexOf(inquadratura.prima) : 0;
  const oraCorrente = inquadratura ? (asse[indiceCorrente] as Ora | undefined) : undefined;

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

  // Le tacche si posizionano sulla stessa scala a indici dello slider, non sul
  // tempo: l'asse puo' avere buchi, quindi due ore lontane possono essere
  // adiacenti come indici. Mettere le tacche in proporzione al tempo le
  // farebbe scivolare rispetto al cursore, che si muove per indici.
  const primo = asse[0]?.istante ?? 0;
  const finale = asse[ultimo]?.istante ?? 0;
  const frazioneDelTempo = (istanteCercato: number): number | null => {
    if (asse.length < 2) return null;
    let i = asse.findIndex((o) => o.istante >= istanteCercato);
    if (i < 0) return null;
    if (i === 0) return istanteCercato < primo ? null : 0;
    const prima = asse[i - 1];
    const dopo = asse[i];
    const dentro = (istanteCercato - prima.istante) / (dopo.istante - prima.istante);
    return frazione(i - 1) + dentro * (frazione(i) - frazione(i - 1));
  };

  const taccheAsse = tacche(primo, finale)
    .map((t) => ({ ...t, frazione: frazioneDelTempo(t.istante) }))
    .filter((t): t is typeof t & { frazione: number } => t.frazione !== null);

  // "Adesso" e' il riferimento che rende leggibile una scala che copre passato
  // e futuro: senza, per capire dove finisce l'analisi bisogna leggere le date.
  const frazioneAdesso = frazioneDelTempo(Date.now());

  return (
    <div className="scrubber">
      <div className="scrubber-orologio" data-testid="orologio">
        {oraCorrente
          ? `${istanteEsteso(oraCorrente.istante)} (${
              oraCorrente.tipo === "an" ? "analisi" : "previsione"
            })`
          : "nessun dato"}
      </div>
      <div className="scrubber-scala" aria-hidden="true">
        {taccheAsse.map((t) => (
          <div
            key={t.istante}
            className={t.mezzanotte ? "scrubber-tacca giorno" : "scrubber-tacca"}
            style={{ left: `${t.frazione * 100}%` }}
          >
            <span>{t.mezzanotte ? soloGiorno(t.istante) : soloOra(t.istante)}</span>
          </div>
        ))}
        {frazioneAdesso !== null && (
          <div
            className="scrubber-adesso"
            data-testid="adesso"
            style={{ left: `${frazioneAdesso * 100}%` }}
            title="Adesso"
          >
            <span>adesso</span>
          </div>
        )}
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
