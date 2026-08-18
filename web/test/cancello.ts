/**
 * Logica di rilevamento degli import di React, separata dalla scansione su
 * disco perche' deve restare verificabile contro un campione di testo, non
 * solo contro i file veri: e' il modo in cui il cancello di
 * web/test/vincoli.test.ts si dimostra a se stesso di avere i denti su
 * ognuna delle forme che un import puo' prendere.
 */

const MODULO = `["'](?:react|react-dom)(?:/[^"']*)?["']`;

const FORME: ReadonlyArray<{ nome: string; espressione: RegExp }> = [
  {
    // import statico, anche andato a capo: un formatter lo spezza su piu'
    // righe appena gli specificatori superano la larghezza di riga
    nome: "import statico",
    espressione: new RegExp(`import\\s[^;]*?from\\s+${MODULO}[^;]*;?`, "g"),
  },
  {
    // re-export: "export { x } from '...'" o "export * from '...'"
    nome: "re-export",
    espressione: new RegExp(`export\\s[^;]*?from\\s+${MODULO}[^;]*;?`, "g"),
  },
  {
    // import dinamico: "import('...')" o "await import('...')"
    nome: "import dinamico",
    espressione: new RegExp(`import\\s*\\(\\s*${MODULO}\\s*\\)`, "g"),
  },
  {
    // require in stile CommonJS
    nome: "require",
    espressione: new RegExp(`require\\s*\\(\\s*${MODULO}\\s*\\)`, "g"),
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
