import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vincolo di struttura: src/data e src/map non conoscono React.
 *
 * Un vincolo dichiarato ovunque e verificato da niente viene riportato come
 * rispettato mentre non lo e'. Lato Python e' successo tre volte, e ogni volta
 * la correzione utile non e' stata sistemare il caso singolo ma rendere la
 * proprieta' verificabile. Questo file e' quel cancello per la SPA.
 */
const STRATI_PURI = ["src/data", "src/map"];

function sorgenti(radice: string): string[] {
  const trovati: string[] = [];
  const cammina = (dir: string) => {
    for (const voce of readdirSync(dir)) {
      const percorso = join(dir, voce);
      if (statSync(percorso).isDirectory()) cammina(percorso);
      else if (/\.tsx?$/.test(voce)) trovati.push(percorso);
    }
  };
  cammina(radice);
  return trovati;
}

describe("i tre strati", () => {
  it("src/data e src/map non importano React", () => {
    const colpevoli: string[] = [];
    for (const strato of STRATI_PURI) {
      for (const file of sorgenti(strato)) {
        const testo = readFileSync(file, "utf8");
        // si guardano le sole righe di import, non le occorrenze nel testo:
        // un commento che nomina React per spiegare il vincolo non lo viola
        for (const riga of testo.split("\n")) {
          if (/^\s*import\s[^;]*from\s+["'](react|react-dom)[^"']*["']/.test(riga)) {
            colpevoli.push(`${file}: ${riga.trim()}`);
          }
        }
      }
    }
    expect(colpevoli, "React importato in uno strato puro").toEqual([]);
  });

  it("i due strati puri esistono davvero", () => {
    // senza questa asserzione, rinominare le cartelle renderebbe verde il test
    // precedente per la ragione sbagliata, cioe' perche' non c'e' piu' niente
    // da controllare
    for (const strato of STRATI_PURI) {
      expect(sorgenti(strato).length, `${strato} non contiene sorgenti`).toBeGreaterThan(0);
    }
  });
});
