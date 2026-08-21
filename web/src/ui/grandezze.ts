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
  /**
   * Il valore in fondo alla scala di colore. Zero per le grandezze positive,
   * negativo per quelle che hanno segno: con la scala ancorata a zero, meta'
   * del livello del mare finirebbe schiacciata nello stesso colore.
   */
  minimo: number;
  /**
   * Il valore in cima alla scala di colore.
   *
   * Non si ricava dal dato: un massimo calcolato sul fotogramma corrente
   * farebbe cambiare scala alla legenda mentre il tempo scorre, e due istanti
   * dello stesso mare non sarebbero piu' confrontabili a occhio. E' una scelta
   * di resa, e sta scritta con il numero misurato che la giustifica.
   */
  massimo: number;
  /**
   * Se fra un'ora e l'altra si puo' interpolare.
   *
   * Falso per le grandezze che il modello non produce continue: interpolarle
   * inventerebbe valori che non esistono (vedi `oraPiuVicina` in
   * data/sorgente.ts).
   */
  dissolvenza: boolean;
  /** Se questa versione la sa disegnare. */
  disegnabile: boolean;
  /**
   * Il passo con cui il valore si scrive a schermo, nelle unita' della
   * grandezza, e da cui vengono anche i decimali.
   *
   * E' una dichiarazione di quanta precisione il dato ha: due decimali su
   * un'altezza d'onda ne promettono piu' di quanta il modello ne produca, e chi
   * legge un centesimo di metro lo prende per una misura. Zero vuol dire "come
   * viene, a due decimali": e' il caso delle grandezze per cui un passo non e'
   * stato deciso, non un passo di zero.
   */
  passo: number;
};

const TABELLA: readonly Grandezza[] = [
  {
    id: "hwave", nome: "altezza d'onda", unita: "m", campi: ["hwave"],
    // Quattro metri e' il confine fra "agitato" e "molto agitato" nella scala
    // Douglas: sopra, in Adriatico, si va di rado.
    minimo: 0, massimo: 4, dissolvenza: true, disegnabile: true,
    // Cinque centimetri, e non il decimo di metro: tutti i confini Douglas
    // sono multipli esatti di 5 cm (0,10 0,50 1,25 2,50 4 6 9 14), quindi il
    // numero a schermo e il nome del grado non possono contraddirsi. Con 0,1 m
    // non valeva, perche' 1,25 non e' multiplo di 0,1.
    passo: 0.05,
  },
  {
    id: "pwave", nome: "periodo dell'onda", unita: "s", campi: ["pwave"],
    // Misurato su tutto l'archivio (144 fotogrammi, analisi e previsione): il
    // periodo prende 17 valori, da 1,00 a 7,37 s, e il massimo osservato e'
    // 7,37. Otto lascia margine senza schiacciare in fondo alla rampa i valori
    // veri, che stanno fra 2,4 e 5,1 nell'88 per cento del mare. **Sopra gli 8
    // secondi la scala satura**: da rivedere con un inverno di dati.
    minimo: 0, massimo: 8,
    // Niente dissolvenza: 17 livelli in progressione geometrica (griglia delle
    // frequenze di SWAN), interpolarli inventerebbe periodi che non esistono.
    dissolvenza: false, disegnabile: true,
    // Mezzo secondo. Il prezzo e' misurato e accettato: dei 17 livelli che il
    // modello produce ne restano 12 distinti (1,00 e 1,13 si leggono uguali,
    // 1,28 1,45 e 1,65 pure, e cosi' 1,87 con 2,11 e 2,40 con 2,71), quindi in
    // fondo alla scala, dove sta il mare d'agosto, due stati diversi mostrano
    // lo stesso numero. Un quarto di secondo li terrebbe distinti sopra i 2 s.
    passo: 0.5,
  },
  // Le due componenti sono adimensionali (seno e coseno); la grandezza sono gradi.
  {
    id: "dwave", nome: "direzione dell'onda", unita: "gradi",
    campi: ["dwave_sin", "dwave_cos"],
    // Una direzione non si disegna con una rampa: vuole le frecce.
    minimo: 0, massimo: 360, dissolvenza: true, disegnabile: false, passo: 0,
  },
  {
    id: "corrente", nome: "corrente", unita: "m/s", campi: ["ubar", "vbar"],
    minimo: 0, massimo: 1, dissolvenza: true, disegnabile: false, passo: 0,
  },
  {
    id: "sealevel", nome: "livello del mare", unita: "m", campi: ["sealevel"],
    // Ha segno, quindi la scala e' **simmetrica**: se non lo fosse, lo zero non
    // cadrebbe in mezzo alla tavolozza divergente e il colore neutro non
    // vorrebbe piu' dire "livello medio". Misurato su tutto l'archivio (288
    // fotogrammi fra analisi e previsione): da -0,654 a +0,575 m, con meta' del
    // mare fra -0,06 e +0,09. Zero virgola otto copre il misurato con margine;
    // **sopra satura**, e un'acqua alta vera lo supera, quindi va rivisto con
    // un inverno di dati.
    minimo: -0.8, massimo: 0.8, dissolvenza: true, disegnabile: true,
    // Nessun passo: l'arrotondamento e' stato chiesto per onda e periodo, e
    // qui i centimetri di marea sono il dato, non rumore attorno al dato.
    passo: 0,
  },
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
      // Sconosciuta: si mostra ma non si disegna, perche' di lei non sappiamo
      // ne' la scala della legenda ne' se si puo' interpolare.
      gia.add(v.id);
      fuori.push({
        id: v.id, nome: v.id, unita: v.unita, campi: [v.id],
        minimo: 0, massimo: 1, dissolvenza: true, disegnabile: false, passo: 0,
      });
    }
  }
  return fuori;
}

/**
 * Il passo di scrittura di una grandezza, dal suo id.
 *
 * Esiste perche' chi scrive il numero a schermo (`ui/numeri.ts`) ha in mano
 * l'id e non la grandezza intera, e perche' il passo deve stare **qui**, con le
 * altre scelte di resa, e non in chi formatta: una seconda tabella dei passi
 * dentro il formattatore sarebbe il modo in cui fra sei mesi la legenda e la
 * barra di stato arrotondano in modo diverso. Un id che questa tabella non
 * conosce non ha passo: si scrive come viene.
 */
export function passoDi(id: string): number {
  return TABELLA.find((g) => g.id === id)?.passo ?? 0;
}
