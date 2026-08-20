/// <reference lib="webworker" />
import { isolineeDi, mescola, type GrigliaIsolinee } from "./isolineeGeometria";
import { Ricordo } from "./ricordoFotogrammi";
import type { Soglia } from "./soglie";

/**
 * Il marching squares, fuori dal thread principale.
 *
 * Misurato sulla griglia vera (858x844) con le quattordici soglie: 50-63 ms per
 * fotogramma. Sul thread principale sarebbero due scatti da 50 ms al secondo a
 * 2 ore/s, e mezzo secondo di calcolo per ogni secondo a 8 ore/s.
 *
 * Qui dentro c'e' solo la posta: il calcolo sta in isolineeGeometria.ts, che si
 * puo' provare senza aprire un browser.
 *
 * I fotogrammi si mandano una volta sola e restano qui. Rimandarli a ogni
 * richiesta sarebbe 1,4 MB copiati dieci volte al secondo, e *trasferirli*
 * (senza copia) non si puo': la stessa griglia serve al thread principale per
 * lo shader e per il valore sotto il punto.
 */

// Otto e non quattro: quattro bastano per l'inquadratura ferma, ma chi
// trascina il cursore avanti e indietro passa continuamente su ore gia' viste,
// e ogni fotogramma sfrattato e' un giro buttato. Otto sono 11 MB, che stanno
// in un telefono senza discussioni.
const TENUTI = 8;

type Richiesta = {
  tipo: "calcola";
  id: number;
  idA: string;
  idB: string | null;
  frazione: number;
  scala: number;
  offset: number;
  soglie: Soglia[];
  griglia: GrigliaIsolinee;
};

type Messaggio =
  | { tipo: "fotogramma"; chiave: string; dati: Int16Array }
  | { tipo: "dimentica" }
  | Richiesta;

const fotogrammi = new Ricordo(TENUTI);

function calcola(r: Richiesta) {
  // `prendi` rinfresca la recenza: le due ore che si stanno guardando non
  // devono essere sfrattate da quelle che scorrono loro accanto.
  const a = fotogrammi.prendi(r.idA);
  if (!a) return { tipo: "manca" as const, id: r.id, chiave: r.idA };
  const b = r.idB ? fotogrammi.prendi(r.idB) : null;
  if (r.idB && !b) return { tipo: "manca" as const, id: r.id, chiave: r.idB };

  const campo = mescola(a, b, r.frazione, r.scala, r.offset);
  return {
    tipo: "isolinee" as const,
    id: r.id,
    geojson: isolineeDi(campo, r.griglia, r.soglie),
  };
}

self.onmessage = (e: MessageEvent<Messaggio>) => {
  const m = e.data;
  if (m.tipo === "fotogramma") {
    // Chi butta via un fotogramma lo dice. Senza questo messaggio il thread
    // principale continua a credere che il worker ce l'abbia, non lo rimanda
    // mai, e ogni richiesta che lo usa torna "manca": e' cosi' che le isolinee
    // smettevano di aggiornarsi durante uno scorrimento lungo.
    for (const buttata of fotogrammi.metti(m.chiave, m.dati)) {
      (self as unknown as Worker).postMessage({ tipo: "dimenticato", chiave: buttata });
    }
    (self as unknown as Worker).postMessage({ tipo: "ricevuto", chiave: m.chiave });
    return;
  }
  if (m.tipo === "dimentica") {
    fotogrammi.svuota();
    return;
  }
  (self as unknown as Worker).postMessage(calcola(m));
};
