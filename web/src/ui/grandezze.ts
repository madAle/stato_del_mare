import type { Variabile } from "../data/catalogo";

/**
 * Le grandezze come le pensa chi guarda, non come sono archiviate.
 *
 * Il catalogo pubblica **campi**, e alcuni campi sono componenti di una sola
 * grandezza: la direzione dell'onda sta in `dwave_sin` e `dwave_cos` perche' un
 * angolo non si puo' interpolare (359 e 1 grado sono adiacenti ma la loro media
 * lineare e' 180, cioe' il verso opposto), la corrente sta in `ubar` e `vbar`
 * perche' un vettore si media in cartesiane e non in modulo e angolo. Sono
 * scelte su **come si conserva** il dato, e non hanno niente da dire a chi apre
 * la mappa: in un menu, `dwave_sin` e' rumore.
 *
 * Questa tabella non rompe la regola per cui l'elenco viene dal catalogo e non
 * dal codice: **decide i nomi, non l'esistenza**. Un campo che il catalogo
 * pubblica e questa tabella non conosce compare lo stesso, col suo id grezzo
 * (vedi `grandezzeDi`). Far sparire dall'interfaccia un dato che esiste in
 * archivio sarebbe peggio di un'etichetta brutta, e sarebbe pure invisibile:
 * nessuno cerca quello che non sa che c'e'.
 */

export type Grandezza = {
  /** L'id che finisce nell'URL. Per le grandezze a un campo solo e' quello del campo. */
  id: string;
  /** Come si legge in un menu. */
  nome: string;
  /** L'unita' della grandezza, che per una direzione non e' quella dei campi. */
  unita: string;
  /** I campi del catalogo che la compongono, nell'ordine in cui servono. */
  campi: string[];
};

const TABELLA: readonly Grandezza[] = [
  { id: "hwave", nome: "altezza d'onda", unita: "m", campi: ["hwave"] },
  { id: "pwave", nome: "periodo dell'onda", unita: "s", campi: ["pwave"] },
  // Le due componenti sono adimensionali (seno e coseno); la grandezza sono gradi.
  { id: "dwave", nome: "direzione dell'onda", unita: "gradi", campi: ["dwave_sin", "dwave_cos"] },
  { id: "corrente", nome: "corrente", unita: "m/s", campi: ["ubar", "vbar"] },
  { id: "sealevel", nome: "livello del mare", unita: "m", campi: ["sealevel"] },
];

/**
 * Le grandezze da mettere in un menu, a partire dai campi che il catalogo
 * pubblica davvero.
 *
 * L'ordine e' quello del catalogo, letto sul **primo** campo di ogni grandezza:
 * un ordine deciso qui si scollerebbe dal catalogo senza che niente lo dica.
 * Un campo sconosciuto diventa una grandezza per conto suo, con l'id al posto
 * del nome e l'unita' che il catalogo dichiara.
 */
export function grandezzeDi(variabili: Variabile[]): Grandezza[] {
  const presenti = new Set(variabili.map((v) => v.id));
  const fuori: Grandezza[] = [];
  const gia = new Set<string>();

  for (const v of variabili) {
    if (gia.has(v.id)) continue;
    const nota = TABELLA.find((g) => g.campi.includes(v.id));
    if (nota) {
      // Una grandezza compare se ha **almeno** un campo in archivio: se ne
      // manca uno (un'ingestione a meta', un catalogo piu' vecchio) e' un
      // problema di chi la disegnera', non un motivo per nasconderla qui.
      const campi = nota.campi.filter((c) => presenti.has(c));
      for (const c of campi) gia.add(c);
      fuori.push({ ...nota, campi });
    } else {
      gia.add(v.id);
      fuori.push({ id: v.id, nome: v.id, unita: v.unita, campi: [v.id] });
    }
  }
  return fuori;
}
