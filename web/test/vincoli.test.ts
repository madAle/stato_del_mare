import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trovaImportReact } from "./cancello";

/**
 * Vincolo di struttura: src/data e src/map non conoscono React.
 *
 * Un vincolo dichiarato ovunque e verificato da niente viene riportato come
 * rispettato mentre non lo e'. Lato Python e' successo tre volte, e ogni volta
 * la correzione utile non e' stata sistemare il caso singolo ma rendere la
 * proprieta' verificabile. Questo file e' quel cancello per la SPA.
 *
 * Il rilevamento vero e proprio (trovaImportReact, in ./cancello) e' testato
 * qui sotto contro campioni di testo, non solo contro i file veri: un
 * cancello con varchi noti, per esempio un import andato a capo che sfugge a
 * un controllo riga per riga, e' peggio di nessun cancello, perche' da' una
 * sicurezza che non c'e'.
 */
const STRATI_PURI = ["src/data", "src/map"];

function sorgenti(radice: string): string[] {
  const trovati: string[] = [];
  const cammina = (dir: string) => {
    for (const voce of readdirSync(dir)) {
      const percorso = join(dir, voce);
      if (statSync(percorso).isDirectory()) cammina(percorso);
      else if (/\.[jt]sx?$/.test(voce)) trovati.push(percorso);
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
        for (const forma of trovaImportReact(testo)) {
          colpevoli.push(`${file}: ${forma}`);
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

describe("trovaImportReact", () => {
  // Le quattro forme plausibili, verificate contro un campione di testo:
  // cosi' il cancello si dimostra di avere i denti senza dover per forza
  // scrivere un file vero sul disco per ognuna.

  it("riconosce l'import statico anche quando va a capo", () => {
    const testo = ['import {', '  useState,', '  useEffect,', '} from "react";'].join("\n");
    expect(trovaImportReact(testo).length).toBeGreaterThan(0);
  });

  it("riconosce il re-export", () => {
    const testo = 'export { useState } from "react";';
    expect(trovaImportReact(testo).length).toBeGreaterThan(0);
  });

  it("riconosce l'import dinamico", () => {
    const testo = 'const { useState } = await import("react");';
    expect(trovaImportReact(testo).length).toBeGreaterThan(0);
  });

  it("riconosce require", () => {
    const testo = 'const { useState } = require("react");';
    expect(trovaImportReact(testo).length).toBeGreaterThan(0);
  });

  it("riconosce un sottopercorso come react-dom/client", () => {
    const testo = 'import { createRoot } from "react-dom/client";';
    expect(trovaImportReact(testo).length).toBeGreaterThan(0);
  });

  it("non segnala un commento di riga che nomina React per spiegare il vincolo", () => {
    const testo = [
      "// src/data e src/map non devono importare React, per esempio:",
      '// import { useState } from "react";',
      "export const x = 1;",
    ].join("\n");
    expect(trovaImportReact(testo)).toEqual([]);
  });

  it("non segnala un commento di blocco che nomina React", () => {
    const testo = [
      "/*",
      " * vietato fare cosi': import { useState } from \"react\";",
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(trovaImportReact(testo)).toEqual([]);
  });
});
