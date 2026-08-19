/**
 * Le soglie delle isolinee, in un posto solo.
 *
 * La spec chiede che le soglie delle isolinee e i gradini della scala di colore
 * siano la stessa lista: due elenchi separati prima o poi divergono, e una linea
 * che dice 1,25 m a due pixel dal punto dove il colore cambia davvero e' peggio
 * di nessuna linea, perche' e' credibile ed e' sbagliata.
 *
 * **Qui pero' il campo resta a rampa continua** (deciso il 2026-08-19). Il
 * motivo e' misurato: i gradini WMO in basso sono 0,1 / 0,5 / 1,25 m e
 * l'Adriatico passa gran parte dell'anno sotto i 0,5 m, quindi a bande discrete
 * quasi tutto il mare cadrebbe in una sola classe e la mappa sarebbe piatta. Con
 * la rampa continua non esiste nessun confine di colore da contraddire, quindi
 * il rischio che la spec voleva evitare non si presenta: le linee sono l'unico
 * confine disegnato, come le isobate su una carta nautica.
 */

/** Una soglia da disegnare. */
export type Soglia = {
  /** Metri. */
  valore: number;
  /**
   * Le soglie del codice stato del mare WMO portano il numero e la linea
   * spessa; le suddivisioni intermedie di ARPAE corrono sottili e mute. Il
   * numero compare dove ha un nome, non a ogni gradino.
   */
  nome: boolean;
};

/** Codice stato del mare WMO, piu' le intermedie di ARPAE. */
export const SOGLIE: readonly Soglia[] = [
  { valore: 0.1, nome: true },
  { valore: 0.5, nome: true },
  { valore: 0.8, nome: false },
  { valore: 1.25, nome: true },
  { valore: 1.8, nome: false },
  { valore: 2.5, nome: true },
  { valore: 3.2, nome: false },
  { valore: 4, nome: true },
  { valore: 5, nome: false },
  { valore: 6, nome: true },
  { valore: 7, nome: false },
  { valore: 8, nome: false },
  { valore: 9, nome: true },
  { valore: 14, nome: true },
];

/** Solo i valori, nell'ordine, come li vuole d3-contour. */
export const VALORI_SOGLIA: readonly number[] = SOGLIE.map((s) => s.valore);

/** L'etichetta di una soglia, con la virgola e senza zeri inutili. */
export function etichettaSoglia(valore: number): string {
  return `${valore.toString().replace(".", ",")} m`;
}
