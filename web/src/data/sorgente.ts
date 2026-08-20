import { PASSO_MS, type Ora } from "./indice";

export type Inquadratura = { prima: Ora; dopo: Ora | null; frazione: number };

/**
 * Le due ore fra cui cade un istante, e quanto ci si e' dentro.
 *
 * `dopo` e' null quando la seconda ora manca o e' oltre il passo: dentro un
 * buco non si interpola. Fondere due campi lontani giorni produrrebbe
 * un'animazione morbida e falsa, che su un fenomeno meteorologico e' peggio di
 * un salto visibile, perche' il salto si legge per quello che e'.
 */
export function inquadra(asse: Ora[], istante: number): Inquadratura | null {
  if (asse.length === 0) return null;
  if (istante < asse[0].istante || istante > asse[asse.length - 1].istante) return null;

  let basso = 0;
  let alto = asse.length - 1;
  while (basso < alto) {
    const mezzo = (basso + alto + 1) >> 1;
    if (asse[mezzo].istante <= istante) basso = mezzo;
    else alto = mezzo - 1;
  }

  const prima = asse[basso];
  const dopo = basso + 1 < asse.length ? asse[basso + 1] : null;
  if (!dopo || dopo.istante - prima.istante > PASSO_MS) {
    return { prima, dopo: null, frazione: 0 };
  }
  const frazione = (istante - prima.istante) / (dopo.istante - prima.istante);
  return { prima, dopo, frazione };
}

/**
 * L'inquadratura riportata all'ora piu' vicina, senza dissolvenza.
 *
 * Serve alle grandezze che il modello **non produce continue**. Il periodo di
 * picco, per esempio, e' l'etichetta della banda di frequenza dove sta il
 * massimo dello spettro: misurato su tutto l'archivio, prende 17 valori e
 * basta, in progressione geometrica di rapporto 1,1326 (la griglia delle
 * frequenze di SWAN). Fondere 3,48 e 3,95 darebbe 3,71 s, un periodo che il
 * modello non puo' generare, e il numero sotto il dito lo scriverebbe.
 *
 * E' la stessa regola dell'orologio, che non scrive mai "09:37" perche' il dato
 * e' orario: non si promette una risoluzione che non esiste.
 *
 * Il costo dichiarato: il campo scatta di ora in ora invece di scorrere liscio,
 * e lo scatto cade a meta' fra le due ore.
 */
export function oraPiuVicina(q: Inquadratura): Inquadratura {
  if (!q.dopo) return q;
  const vicina = q.frazione < 0.5 ? q.prima : q.dopo;
  return { prima: vicina, dopo: null, frazione: 0 };
}

/**
 * Ore di scadenza di una previsione, null per l'analisi.
 *
 * Misurato sul bucket: la corsa datata D copre da D+1h a D+24h (l'ultima corsa
 * disponibile arriva a +72h), quindi la scadenza si conta dalle 00Z della data
 * di riferimento. Dedurla dal primo istante disponibile invece che dalla data
 * darebbe numeri diversi a seconda di cosa e' stato ingerito.
 */
export function scadenzaOre(ora: Ora): number | null {
  if (ora.tipo === "an") return null;
  const r = ora.riferimento;
  const base = Date.UTC(
    Number(r.slice(0, 4)),
    Number(r.slice(4, 6)) - 1,
    Number(r.slice(6, 8)),
  );
  return Math.round((ora.istante - base) / PASSO_MS);
}

/**
 * Come si chiama, a schermo, il frame che si sta guardando.
 *
 * La StatusBar lo mostra sempre: senza, la mappa mente per omissione, perche'
 * analisi e previsione sono due cose scientificamente diverse e a colpo
 * d'occhio identiche.
 */
export function provenienza(ora: Ora): string {
  const scadenza = scadenzaOre(ora);
  return scadenza === null ? "analisi" : `previsione +${scadenza}h`;
}
