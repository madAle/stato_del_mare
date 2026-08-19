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
