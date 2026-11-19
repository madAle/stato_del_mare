## Task 2: il ritorno della scia, accanto alla cresta

**File:**
- Modificare: `web/src/map/particelle.ts` (la scia sulla particella)
- Modificare: `web/src/map/livelloParticelle.ts` (la forma)
- Test: `web/test/particelle.test.ts`

**Interfacce:**
- Consuma: `CampiMoto` dal task 1.
- Produce:
  ```ts
  export const PUNTI_SCIA = 12;
  export const FOTOGRAMMI_PER_PUNTO = 6;
  export type Particella = { i: number; j: number; scia: number[]; vita: number };
  export function avanza(
    particelle: Particella[], campi: CampiMoto, dt: number,
    caso: () => number, vitaMassima: number, registraScia?: boolean,
  ): void;
  // e nel livello:
  new LivelloParticelle(id, griglia, forma /* "cresta" | "scia" */)
  ```

Il codice esatto di prima sta in git: `git show a09da47^:web/src/map/livelloParticelle.ts` e `git show a09da47^:web/src/map/particelle.ts`. Va ripreso da lì, non riscritto a memoria, perché porta due misure che non vanno ripagate (il campionamento un fotogramma su sei e la testa della scia alla posizione di adesso).

- [ ] **Step 1: scrivere i test che falliscono**

```ts
describe("la scia, che serve alla corrente e non all'onda", () => {
  it("tiene le ultime posizioni e non cresce senza fine", () => {
    const p = [nasci(correnteUniforme(0.3, 0), () => 0.5, 50)];
    for (let k = 0; k < 60; k++) {
      avanza(p, correnteUniforme(0.3, 0), 0.1, () => 0.5, 5000);
    }
    expect(p[0].scia.length).toBeLessThanOrEqual(PUNTI_SCIA * 2);
    expect(p[0].scia.length).toBeGreaterThan(2);
  });

  it("un punto ogni tanto, non uno per fotogramma", () => {
    // Misurato il 2026-08-20: a una velocita' leggibile un fotogramma vale meno
    // di un pixel, quindi una scia presa a ogni fotogramma e' lunga sei pixel e
    // a schermo non e' una striscia ma polvere.
    const p = [nasci(correnteUniforme(0.3, 0), () => 0.5, 500)];
    for (let k = 0; k < 12; k++) {
      avanza(p, correnteUniforme(0.3, 0), 0.1, () => 0.5, 5000, k % FOTOGRAMMI_PER_PUNTO === 0);
    }
    expect(p[0].scia.length / 2).toBe(Math.ceil(12 / FOTOGRAMMI_PER_PUNTO));
  });

  it("chi non registra la scia non la accumula, cosi' l'onda non paga niente", () => {
    // L'onda si disegna a creste e la scia non le serve: registrarla sarebbe
    // lavoro e memoria per un dato che nessuno legge.
    const p = [nasci(campi(180), () => 0.5, 500)];
    for (let k = 0; k < 12; k++) avanza(p, campi(180), 0.1, () => 0.5, 5000, false);
    expect(p[0].scia).toEqual([]);
  });
});
```

- [ ] **Step 2: eseguire e vedere fallire**

Comando: `cd web && npx vitest run test/particelle.test.ts -t scia`
Atteso: FAIL, `PUNTI_SCIA` non esportato e `Particella` senza `scia`.

- [ ] **Step 3: implementare**

In `particelle.ts` rimettere, dal commit indicato sopra: le costanti `PUNTI_SCIA` e `FOTOGRAMMI_PER_PUNTO` con il loro commento (la misura della polvere bianca), il campo `scia: number[]` su `Particella`, `scia: []` in `nasci`, e il parametro `registraScia = false` in `avanza` con il corpo:

```ts
    if (registraScia) {
      p.scia.push(p.i, p.j);
      if (p.scia.length > PUNTI_SCIA * 2) p.scia.splice(0, 2);
    }
```

**Attenzione al valore di default**: prima era `true`, ora è `false`. Chi disegna creste non deve pagare la scia, e l'unico chiamante che la vuole la chiede.

In `livelloParticelle.ts`: aggiungere al costruttore `private forma: "cresta" | "scia" = "cresta"`, rimettere dal commit indicato il ramo di emissione dei vertici della scia e la sua sbiadita nel frammento, e scegliere in `render` quale dei due rami percorrere. Il frammento tiene **una** formula sola, con il significato dell'attributo che cambia col ramo:

```glsl
  // Con le creste `a_peso` e' la distanza dal centro e sfuma i capi; con le
  // scie e' l'eta' nella scia e sfuma la coda, che e' quello che da' il verso
  // a un oggetto che si muove lungo se stesso.
  fragColor = vec4(u_colore, u_opacita * (0.55 + 0.45 * v_peso));
```

`avanza` va chiamata con `this.forma === "scia" && this.fotogramma % FOTOGRAMMI_PER_PUNTO === 0`.

- [ ] **Step 4: eseguire e vedere verde**

Comando: `cd web && npm run typecheck && npm test`
Atteso: PASS. Nessun test end to end cambia: l'onda continua a disegnare creste, perché `forma` non è passata da nessuno e il default è `"cresta"`.

- [ ] **Step 5: commit**

```bash
git add web/src/map/particelle.ts web/src/map/livelloParticelle.ts web/test/particelle.test.ts
git commit -m "feat(spa): torna il disegno a scia, che alla corrente serve e all'onda no"
```

---

