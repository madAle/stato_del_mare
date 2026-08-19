/// <reference lib="webworker" />
import { isolineeDi, mescola, type GrigliaIsolinee } from "./isolineeGeometria";
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

const TENUTI = 4;   // bastano i due dell'inquadratura, piu' respiro

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

const fotogrammi = new Map<string, Int16Array>();

function ricorda(chiave: string, dati: Int16Array) {
  fotogrammi.delete(chiave);
  fotogrammi.set(chiave, dati);
  while (fotogrammi.size > TENUTI) {
    const piuVecchio = fotogrammi.keys().next().value;
    if (piuVecchio === undefined) break;
    fotogrammi.delete(piuVecchio);
  }
}

function calcola(r: Richiesta) {
  const a = fotogrammi.get(r.idA);
  if (!a) return { tipo: "manca" as const, id: r.id, chiave: r.idA };
  const b = r.idB ? fotogrammi.get(r.idB) ?? null : null;
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
    ricorda(m.chiave, m.dati);
    (self as unknown as Worker).postMessage({ tipo: "ricevuto", chiave: m.chiave });
    return;
  }
  if (m.tipo === "dimentica") {
    fotogrammi.clear();
    return;
  }
  (self as unknown as Worker).postMessage(calcola(m));
};
