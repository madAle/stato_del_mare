/**
 * Logica di rilevamento degli import di React, separata dalla scansione su
 * disco perche' deve restare verificabile contro un campione di testo, non
 * solo contro i file veri: e' il modo in cui il cancello di
 * web/test/vincoli.test.ts si dimostra a se stesso di avere i denti su
 * ognuna delle forme che un import puo' prendere.
 */

// import statico e re-export: la grammatica di ES pretende una StringLiteral
// dopo "from", quindi qui il backtick non e' un varco ma un errore di
// sintassi. Ammettere solo apici singoli e doppi e' corretto, non un caso
// dimenticato.
const MODULO_STATICO = `["'](?:react|react-dom)(?:/[^"']*)?["']`;

// import() e require() invece accettano qualunque espressione fra le
// parentesi, quindi un template literal senza interpolazione, per esempio
// import(`react`), e' sintassi valida ed eseguibile: il backtick va accettato
// anche qui. Il gruppo catturante forza la stessa virgoletta in apertura e
// chiusura, per non accoppiare per esempio "react` per errore.
const MODULO_DINAMICO = `(["'\`])(?:react|react-dom)(?:/[^"'\`]*)?\\1`;

const FORME: ReadonlyArray<{ nome: string; espressione: RegExp }> = [
  {
    // import statico, anche andato a capo: un formatter lo spezza su piu'
    // righe appena gli specificatori superano la larghezza di riga.
    // Include "import type { X } from 'react'": il vincolo e' che lo strato
    // non CONOSCA React, e importarne solo i tipi vuol dire conoscerlo lo
    // stesso. Non e' una svista, non va "corretto" escludendolo.
    nome: "import statico",
    espressione: new RegExp(`import\\s[^;]*?from\\s+${MODULO_STATICO}[^;]*;?`, "g"),
  },
  {
    // re-export: "export { x } from '...'" o "export * from '...'"
    nome: "re-export",
    espressione: new RegExp(`export\\s[^;]*?from\\s+${MODULO_STATICO}[^;]*;?`, "g"),
  },
  {
    // import dinamico: "import('...')", "import(\`...\`)" o "await import(...)"
    nome: "import dinamico",
    espressione: new RegExp(`import\\s*\\(\\s*${MODULO_DINAMICO}\\s*\\)`, "g"),
  },
  {
    // require in stile CommonJS, apici o backtick
    nome: "require",
    espressione: new RegExp(`require\\s*\\(\\s*${MODULO_DINAMICO}\\s*\\)`, "g"),
  },
];

/**
 * Toglie commenti di riga e di blocco dal testo, lasciando intatto il
 * contenuto di stringhe e template literal.
 *
 * Serve per due ragioni opposte: un commento che nomina React per spiegare
 * il vincolo (come questo stesso commento, o quello in cima al file di
 * test) non deve diventare una violazione; una stringa qualunque che
 * contenga "//" (un URL, per esempio) non deve essere troncata per errore.
 */
export function rimuoviCommenti(testo: string): string {
  let risultato = "";
  let i = 0;
  const n = testo.length;

  while (i < n) {
    const carattere = testo[i];
    const successivo = testo[i + 1];

    if (carattere === '"' || carattere === "'" || carattere === "`") {
      const virgoletta = carattere;
      let j = i + 1;
      while (j < n) {
        if (testo[j] === "\\") {
          j += 2;
          continue;
        }
        if (testo[j] === virgoletta) {
          j += 1;
          break;
        }
        j += 1;
      }
      risultato += testo.slice(i, j);
      i = j;
      continue;
    }

    if (carattere === "/" && successivo === "/") {
      let j = i + 2;
      while (j < n && testo[j] !== "\n") j += 1;
      i = j;
      continue;
    }

    if (carattere === "/" && successivo === "*") {
      let j = i + 2;
      while (j < n && !(testo[j] === "*" && testo[j + 1] === "/")) j += 1;
      i = Math.min(j + 2, n);
      continue;
    }

    risultato += carattere;
    i += 1;
  }

  return risultato;
}

/**
 * Cerca import di React nel testo intero, non riga per riga: un import
 * spezzato su piu' righe non e' un caso esotico, e' quello che produce un
 * formatter appena gli specificatori superano la larghezza di riga.
 *
 * Copre le quattro forme plausibili: import statico (anche multi riga),
 * re-export, import dinamico, require. Ritorna una voce per occorrenza, nella
 * forma "<nome forma>: <frammento trovato>", pronta per finire in un
 * messaggio d'errore che nomina la forma oltre al file.
 *
 * Decisione deliberata: una stringa che nomina testualmente un import di
 * React, per esempio `const messaggio = "non fare: import { x } from
 * 'react'"`, risulta una violazione anche se non lo e' davvero. Rimuovere
 * anche il contenuto delle stringhe (oltre ai commenti) richiederebbe un
 * tokenizzatore vero, e i suoi errori sarebbero silenziosi: un import reale
 * non visto perche' il tokenizzatore lo ha scambiato per testo. Questo falso
 * positivo invece e' rumoroso, cioe' il test fallisce e si legge il perche'
 * in dieci secondi guardando il messaggio. Fra un cancello che sbaglia
 * dicendolo e uno che sbaglia tacendo, si tiene il primo: non toccare questo
 * comportamento senza aver gia' in mano il tokenizzatore vero.
 */
export function trovaImportReact(testoOriginale: string): string[] {
  const testo = rimuoviCommenti(testoOriginale);
  const trovati: string[] = [];

  for (const { nome, espressione } of FORME) {
    espressione.lastIndex = 0;
    for (const corrispondenza of testo.matchAll(espressione)) {
      const frammento = corrispondenza[0].replace(/\s+/g, " ").trim();
      trovati.push(`${nome}: ${frammento}`);
    }
  }

  return trovati;
}
