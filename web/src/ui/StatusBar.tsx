import type { Ora } from "../data/indice";
import { provenienza } from "../data/sorgente";
import type { StatoRiproduzione } from "../map/animazione";

export function StatusBar({
  ora, valore, unita, stato,
}: {
  ora: Ora | null;
  valore: number | null;
  unita: string;
  stato: StatoRiproduzione;
}) {
  return (
    <div className="barra-stato">
      {/* La provenienza si mostra sempre: senza, la mappa mente per omissione. */}
      <span className="provenienza">{ora ? provenienza(ora) : "nessun dato"}</span>
      <span className="valore">
        {valore === null ? "" : `${valore.toFixed(2).replace(".", ",")} ${unita}`}
      </span>
      {stato === "in attesa di dati" && <span className="attesa">in attesa di dati</span>}
    </div>
  );
}
