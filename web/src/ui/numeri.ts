import { haStatoDelMare, statoDelMare } from "../map/soglie";
import { passoDi } from "./grandezze";

/**
 * Come si scrive un valore misurato, in un posto solo.
 *
 * Sta qui per la stessa ragione per cui ci sta `tempo.ts`: lo stesso numero si
 * legge adesso in due punti dello schermo (la barra di stato e l'etichetta del
 * punto fissato), e due formattatori separati sono il modo in cui due parti
 * dello schermo cominciano a contraddirsi. La virgola, che e' la convenzione
 * italiana, e il **passo** della grandezza, che dice quanta precisione il dato
 * ha davvero: due decimali su un'altezza d'onda ne promettono piu' di quanta il
 * modello ne produca.
 */

/**
 * Il valore portato sul passo con cui verra' scritto.
 *
 * In millesimi interi, e non con `valore / passo`: 1,25 diviso 0,05 in virgola
 * mobile fa 24,999... e il prodotto tornerebbe 1.2500000000000002, cioe' un
 * numero diverso da quello scritto a schermo proprio sul confine fra "mosso" e
 * "molto mosso". Nemmeno `valore * 100 / 5` va bene: su 8,325 da 166,4999... e
 * arrotonda per difetto dove il mezzo centimetro chiedeva di salire.
 *
 * Passo zero vuol dire "il valore come viene": non tutte le grandezze hanno un
 * passo di scrittura deciso.
 */
function arrotonda(valore: number, passo: number): number {
  if (passo <= 0) return valore;
  const millesimi = Math.round(passo * 1000);
  return (Math.round((valore * 1000) / millesimi) * millesimi) / 1000;
}

/**
 * Quanti decimali scrivere: quelli del passo.
 *
 * Non e' un dettaglio tipografico ma la stessa affermazione dell'arrotondamento
 * detta due volte: con un passo di mezzo secondo, scrivere `4,50 s` prometterebbe
 * dei centesimi che non possono comparire, ed e' esattamente cio' che stiamo
 * togliendo. Senza passo si resta a due, come si e' sempre fatto.
 */
function decimali(passo: number): number {
  if (passo <= 0) return 2;
  return String(passo).split(".")[1]?.length ?? 0;
}

/**
 * Il valore con la sua unita': "0,45 m", "4,5 s".
 *
 * Il passo e' obbligatorio di proposito. Con un valore di comodo, il giorno che
 * qualcuno scrive un numero da un terzo punto dello schermo lo scriverebbe con
 * una precisione diversa dagli altri due senza che niente lo dica, e sarebbe la
 * divergenza che questo modulo esiste per impedire.
 */
export function scriviValore(valore: number | null, unita: string, passo: number): string {
  if (valore === null) return "";
  const arrotondato = arrotonda(valore, passo);
  return `${arrotondato.toFixed(decimali(passo)).replace(".", ",")} ${unita}`;
}

/**
 * Lo stesso valore, con lo stato del mare accanto: "0,40 m · poco mosso".
 *
 * Il nome Douglas si aggiunge **solo se il valore e' un'altezza in metri**: le
 * altre grandezze del catalogo (periodo in secondi, direzione in gradi, e
 * domani la corrente) non hanno gradi di Douglas, e appiccicarglieli sarebbe
 * scrivere una cosa falsa accanto a un numero vero. La condizione sta qui, in
 * un posto solo, invece che in ognuno dei due punti dello schermo.
 *
 * **Il nome si calcola sul valore arrotondato**, cioe' sul numero che si legge
 * e non su quello che si e' misurato. Se venisse dal valore grezzo, un vero
 * 0,49 m si leggerebbe "0,50 m · poco mosso": un numero che dice "mosso"
 * accanto a un nome che lo nega. La coppia regge perche' ogni confine Douglas
 * e' un multiplo esatto di 5 cm, che e' il passo dell'altezza d'onda: col
 * decimo di metro non reggeva, perche' 1,25 non e' multiplo di 0,1. Il residuo
 * e' dichiarato: la classificazione al confine puo' sbagliare di al piu' mezzo
 * passo (un vero 0,475 si legge "0,50 m · mosso" mentre sarebbe ancora "poco
 * mosso"), che e' un errore invisibile, mentre una coppia che si contraddice si
 * vede.
 */
export function scriviValoreEStato(
  valore: number | null, unita: string, idVariabile: string,
): string {
  if (valore === null) return "";
  const passo = passoDi(idVariabile);
  const numero = scriviValore(valore, unita, passo);
  if (!haStatoDelMare(idVariabile)) return numero;
  return `${numero} · ${statoDelMare(arrotonda(valore, passo))}`;
}
