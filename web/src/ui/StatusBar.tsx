import type { Ora } from "../data/indice";
import { provenienza } from "../data/sorgente";
import type { StatoRiproduzione } from "../map/animazione";
import { istanteEsteso, soloOra } from "./tempo";

/**
 * Come si scrive il momento osservato: un'ora sola, o la coppia fra cui si sta
 * passando. Mai i minuti, per la ragione scritta sulla prop `istante`.
 */
function momento(istante: number, ora: Ora | null, oraDopo: Ora | null): string {
  if (!ora) return "nessun dato";
  if (!oraDopo || istante === ora.istante) return istanteEsteso(ora.istante);
  return `${istanteEsteso(ora.istante)} -> ${soloOra(oraDopo.istante)}`;
}

export function StatusBar({
  istante, ora, oraDopo, valore, unita, stato,
}: {
  /**
   * L'istante disegnato. Serve solo a sapere se si sta esattamente su un'ora o
   * in mezzo a due: non viene mai scritto a schermo al minuto.
   *
   * Il dato e' orario. Fra un'ora e l'altra la mappa mostra una dissolvenza,
   * che serve all'occhio mentre il tempo scorre ma non e' un istante che il
   * modello abbia calcolato: scrivere "09:37" prometterebbe una precisione che
   * non esiste, e chi legge la prenderebbe per una misura piu' fine invece che
   * per la posizione dentro una transizione.
   */
  istante: number;
  ora: Ora | null;
  /** L'ora successiva, quando si e' in mezzo a una transizione. */
  oraDopo: Ora | null;
  valore: number | null;
  unita: string;
  stato: StatoRiproduzione;
}) {
  return (
    <div className="barra-stato">
      {/* Il momento osservato, per primo e in evidenza: e' la domanda a cui
          serve rispondere prima di guardare qualunque numero. */}
      <span className="momento">{momento(istante, ora, oraDopo)}</span>
      {/* La provenienza si mostra sempre: senza, la mappa mente per omissione. */}
      <span className="provenienza">{ora ? provenienza(ora) : ""}</span>
      <span className="valore">
        {valore === null ? "" : `${valore.toFixed(2).replace(".", ",")} ${unita}`}
      </span>
      {stato === "in attesa di dati" && <span className="attesa">in attesa di dati</span>}
    </div>
  );
}
