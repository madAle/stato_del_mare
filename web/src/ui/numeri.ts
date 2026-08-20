import { haStatoDelMare, statoDelMare } from "../map/soglie";

/**
 * Come si scrive un valore misurato, in un posto solo.
 *
 * Sta qui per la stessa ragione per cui ci sta `tempo.ts`: lo stesso numero si
 * legge adesso in due punti dello schermo (la barra di stato e l'etichetta del
 * punto fissato), e due formattatori separati sono il modo in cui due parti
 * dello schermo cominciano a contraddirsi. Due decimali e la virgola, che e' la
 * convenzione italiana.
 */
export function scriviValore(valore: number | null, unita: string): string {
  if (valore === null) return "";
  return `${valore.toFixed(2).replace(".", ",")} ${unita}`;
}

/**
 * Lo stesso valore, con lo stato del mare accanto: "0,42 m · poco mosso".
 *
 * Il nome Douglas si aggiunge **solo se il valore e' un'altezza in metri**: le
 * altre grandezze del catalogo (periodo in secondi, direzione in gradi, e
 * domani la corrente) non hanno gradi di Douglas, e appiccicarglieli sarebbe
 * scrivere una cosa falsa accanto a un numero vero. La condizione sta qui, in
 * un posto solo, invece che in ognuno dei due punti dello schermo.
 */
export function scriviValoreEStato(
  valore: number | null, unita: string, idVariabile: string,
): string {
  const numero = scriviValore(valore, unita);
  if (!numero || valore === null || !haStatoDelMare(idVariabile)) return numero;
  return `${numero} · ${statoDelMare(valore)}`;
}
