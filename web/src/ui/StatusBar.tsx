import type { Ora } from "../data/indice";
import { provenienza } from "../data/sorgente";
import type { StatoRiproduzione } from "../map/animazione";
import { istanteEsteso } from "./tempo";

export function StatusBar({
  istante, ora, valore, unita, stato,
}: {
  /**
   * L'istante che la mappa sta disegnando, non l'ora del frame.
   *
   * Sono due cose diverse mentre la riproduzione scorre: il campo e' fuso fra
   * due ore con una frazione continua, e alle 09:37 mostra il 62% del cammino
   * verso le 10:00. Scrivere qui l'ora del frame direbbe 09:00 accanto a un
   * campo che non e' piu' quello delle 09:00, e accanto a un valore che (dopo
   * la correzione di proiezione.ts) e' anch'esso interpolato.
   */
  istante: number;
  ora: Ora | null;
  valore: number | null;
  unita: string;
  stato: StatoRiproduzione;
}) {
  return (
    <div className="barra-stato">
      {/* Il momento osservato, per primo e in evidenza: e' la domanda a cui
          serve rispondere prima di guardare qualunque numero. */}
      <span className="momento">{ora ? istanteEsteso(istante) : "nessun dato"}</span>
      {/* La provenienza si mostra sempre: senza, la mappa mente per omissione. */}
      <span className="provenienza">{ora ? provenienza(ora) : ""}</span>
      <span className="valore">
        {valore === null ? "" : `${valore.toFixed(2).replace(".", ",")} ${unita}`}
      </span>
      {stato === "in attesa di dati" && <span className="attesa">in attesa di dati</span>}
    </div>
  );
}
