/**
 * Le soglie delle isolinee, in un posto solo: i confini della scala Douglas.
 *
 * La spec chiede che le soglie delle isolinee e i gradini della scala di colore
 * siano la stessa lista: due elenchi separati prima o poi divergono, e una linea
 * che dice 1,25 m a due pixel dal punto dove il colore cambia davvero e' peggio
 * di nessuna linea, perche' e' credibile ed e' sbagliata.
 *
 * **Qui pero' il campo resta a rampa continua** (deciso il 2026-08-19). Il
 * motivo e' misurato: i gradini in basso sono 0,1 / 0,5 / 1,25 m e l'Adriatico
 * passa gran parte dell'anno sotto i 0,5 m, quindi a bande discrete quasi tutto
 * il mare cadrebbe in una sola classe e la mappa sarebbe piatta. Con la rampa
 * continua non esiste nessun confine di colore da contraddire: le linee sono
 * l'unico confine disegnato, come le isobate su una carta nautica.
 *
 * **Ogni soglia e' un confine di classe Douglas**, e niente altro (deciso il
 * 2026-08-20). Prima c'erano anche sei suddivisioni intermedie di ARPAE
 * (0,8 / 1,8 / 3,2 / 5 / 7 / 8) che correvano mute: col mare d'agosto l'unica
 * visibile era 0,8, cioe' una linea senza nome in mezzo al grado "mosso", che
 * non separava niente che si potesse dire a parole. Adesso attraversare una
 * linea vuol dire cambiare stato del mare, e la linea lo scrive.
 *
 * La scala Douglas (H. P. Douglas, 1921) classifica il mare sull'altezza
 * significativa, cioe' la media del terzo di onde piu' alto: e' esattamente
 * quello che ARPAE pubblica in `hwave`.
 */

/**
 * La variabile a cui la scala Douglas si applica.
 *
 * Douglas classifica **l'altezza d'onda**: il periodo in secondi e la direzione
 * in gradi non hanno gradi di Douglas, e scriverglieli accanto sarebbe una cosa
 * falsa messa vicino a un numero vero. Sta scritto qui e non nei due punti
 * dello schermo che mostrano il valore, se no il giorno che il catalogo ne
 * pubblica un'altra i due punti divergono.
 */
export const VARIABILE_DOUGLAS = "hwave";

/** Vero se di questa grandezza ha senso dire "poco mosso". */
export function haStatoDelMare(idVariabile: string): boolean {
  return idVariabile === VARIABILE_DOUGLAS;
}

/** Un grado della scala Douglas: il nome, e l'altezza a cui comincia. */
export type Grado = {
  /** Metri: da qui in su vale questo nome. */
  da: number;
  nome: string;
};

/**
 * I dieci gradi, dal calmo al tempestoso.
 *
 * Il grado 0 (calmo) non e' un intervallo ma un punto (mare piatto): comincia a
 * zero come il grado 1, e la sola cosa che li distingue e' che sotto un
 * centimetro l'onda non e' misurabile. Si tiene un solo confine a zero, con il
 * nome del grado 1, invece di far comparire "calmo" per un dato che non ha la
 * risoluzione per dirlo.
 */
export const GRADI: readonly Grado[] = [
  { da: 0, nome: "quasi calmo" },
  { da: 0.1, nome: "poco mosso" },
  { da: 0.5, nome: "mosso" },
  { da: 1.25, nome: "molto mosso" },
  { da: 2.5, nome: "agitato" },
  { da: 4, nome: "molto agitato" },
  { da: 6, nome: "grosso" },
  { da: 9, nome: "molto grosso" },
  { da: 14, nome: "tempestoso" },
];

/**
 * Lo stato del mare a una certa altezza d'onda.
 *
 * Il confine appartiene al grado che apre: a 0,50 m esatti il mare e' "mosso",
 * non "poco mosso". E' la convenzione della scala (gli intervalli si leggono
 * 0,10-0,50, 0,50-1,25) ed e' anche l'unica coerente con le isolinee, dove la
 * linea a 0,5 m e' il posto dove comincia "mosso".
 */
export function statoDelMare(altezza: number): string {
  let nome = GRADI[0].nome;
  for (const g of GRADI) if (altezza >= g.da) nome = g.nome;
  return nome;
}

/** Una soglia da disegnare. */
export type Soglia = {
  /** Metri. */
  valore: number;
  /**
   * Resta per compatibilita' con chi legge la sorgente: adesso ogni soglia e'
   * un confine di classe, quindi porta sempre il nome.
   */
  nome: boolean;
};

/** Un'isolinea per ogni confine fra due gradi. Lo zero non e' un confine. */
export const SOGLIE: readonly Soglia[] = GRADI
  .filter((g) => g.da > 0)
  .map((g) => ({ valore: g.da, nome: true }));

/** Solo i valori, nell'ordine, come li vuole d3-contour. */
export const VALORI_SOGLIA: readonly number[] = SOGLIE.map((s) => s.valore);

/**
 * L'etichetta di una soglia: solo l'altezza.
 *
 * Il nome del grado (`mosso`, `poco mosso`) sta accanto al **valore misurato**,
 * nella barra di stato e sul segnaposto, non sulla linea. Sulla linea sarebbe
 * lungo il triplo e la corsa lungo la curva e' il posto piu' stretto che
 * l'interfaccia abbia: un'etichetta lunga su una linea che gira si spezza, si
 * scavalla con la vicina o non compare affatto. Che ogni linea sia comunque un
 * confine di classe resta vero, e resta scritto dove c'e' spazio per dirlo.
 */
export function etichettaSoglia(valore: number): string {
  return `${valore.toString().replace(".", ",")} m`;
}
