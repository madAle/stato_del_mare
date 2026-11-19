## Task 3: il valore vettoriale sotto il dito

**File:**
- Modificare: `web/src/map/proiezione.ts`
- Test: `web/test/valoreInterpolato.test.ts`

**Interfacce:**
- Consuma: `valoreCorrente` e le sue parti interne, che **non si toccano**.
- Produce:
  ```ts
  export function valoreVettore(
    griglia: Griglia, ore: Ora[], istante: number,
    prendiU: (ora: Ora) => Int16Array | undefined,
    prendiV: (ora: Ora) => Int16Array | undefined,
    lon: number, lat: number, scala: number, offset: number, dissolvenza?: boolean,
  ): number | null;
  ```

- [ ] **Step 1: scrivere i test che falliscono**

```ts
describe("il modulo di un vettore sotto il cursore", () => {
  const leggiVettore = (
    istante: number, ua: Int16Array, ub: Int16Array, va: Int16Array, vb: Int16Array,
  ): number | null => {
    const u = new Map([[ORE[0].istante, ua], [ORE[1].istante, ub]]);
    const v = new Map([[ORE[0].istante, va], [ORE[1].istante, vb]]);
    return valoreVettore(
      GRIGLIA, ORE, istante,
      (ora) => u.get(ora.istante), (ora) => v.get(ora.istante),
      LON, LAT, 0.001, 0,
    );
  };

  it("su un'ora esatta e' il modulo delle due componenti", () => {
    // 300 e 400 millesimi di m/s danno 0,5 m/s: il triangolo che tutti sanno.
    expect(leggiVettore(
      ORE[0].istante, frameCostante(300), frameCostante(0),
      frameCostante(400), frameCostante(0),
    )).toBeCloseTo(0.5, 6);
  });

  it("**interpola le componenti e poi prende il modulo**, non il contrario", () => {
    // E' il test per cui esiste la sezione 4 della spec. Con u che passa da
    // +300 a -300 e v nullo, a metà ora il valore vero e' ZERO: la corrente si
    // annulla, che e' quello che fa a stanca. Mescolando i moduli si otterrebbe
    // 0,3 m/s, cioe' un mare che non sta mai fermo. Non si vede come un errore:
    // si vede come un mare diverso.
    expect(leggiVettore(
      ORE[0].istante + 1_800_000, frameCostante(300), frameCostante(-300),
      frameCostante(0), frameCostante(0),
    )).toBeCloseTo(0, 6);
  });

  it("a tre quarti pesa di piu' l'ora dopo, componente per componente", () => {
    // u va da 0 a 400: a tre quarti vale 300, e con v nullo il modulo e' 0,3.
    expect(leggiVettore(
      ORE[0].istante + 2_700_000, frameCostante(0), frameCostante(400),
      frameCostante(0), frameCostante(0),
    )).toBeCloseTo(0.3, 6);
  });

  it("se una delle due componenti non ha dato, non c'e' valore", () => {
    // Meta' di un vettore non e' un vettore: dare per buono zero sull'altra
    // componente sarebbe una corrente inventata, e piu' lenta del vero.
    expect(leggiVettore(
      ORE[0].istante, frameCostante(300), frameCostante(300),
      frameCostante(NODATA), frameCostante(NODATA),
    )).toBeNull();
  });
});
```

- [ ] **Step 2: eseguire e vedere fallire**

Comando: `cd web && npx vitest run test/valoreInterpolato.test.ts`
Atteso: FAIL, `valoreVettore` non esportato.

- [ ] **Step 3: implementare**

In `web/src/map/proiezione.ts`, accanto a `valoreCorrente`:

```ts
/**
 * Il modulo di una grandezza a due componenti, sotto il cursore.
 *
 * **L'ordine non e' negoziabile**: si interpolano nel tempo le due componenti,
 * ognuna col percorso di `valoreCorrente`, e solo dopo si prende il modulo.
 * Mescolare i moduli sbaglia proprio all'inversione di marea, dove una
 * componente passa da +0,3 a -0,3 e il valore vero a meta' e' zero mentre la
 * media dei moduli da' 0,3: una corrente che non si annulla mai. E' lo stesso
 * principio per cui il catalogo archivia seno e coseno di un angolo invece
 * dell'angolo, scritto in `ui/grandezze.ts`.
 *
 * Se una delle due componenti non ha dato, non c'e' valore: meta' di un vettore
 * non e' un vettore, e dare zero all'altra darebbe una corrente piu' lenta del
 * vero, cioe' un numero plausibile e falso.
 */
export function valoreVettore(
  griglia: Griglia,
  ore: Ora[],
  istante: number,
  prendiU: (ora: Ora) => Int16Array | undefined,
  prendiV: (ora: Ora) => Int16Array | undefined,
  lon: number,
  lat: number,
  scala: number,
  offset: number,
  dissolvenza = true,
): number | null {
  const u = valoreCorrente(griglia, ore, istante, prendiU, lon, lat, scala, offset, dissolvenza);
  const v = valoreCorrente(griglia, ore, istante, prendiV, lon, lat, scala, offset, dissolvenza);
  if (u === null || v === null) return null;
  return Math.hypot(u, v);
}
```

Chi esegue verifichi la firma vera di `valoreCorrente` prima di scrivere la chiamata: se l'ordine dei parametri differisce da quello qui sopra, vince quello vero e questo blocco va adattato, non il contrario.

- [ ] **Step 4: eseguire e vedere verde**

Comando: `cd web && npm run typecheck && npx vitest run test/valoreInterpolato.test.ts`
Atteso: PASS.

- [ ] **Step 5: verificare che il test dell'ordine sappia fallire**

Sostituire il corpo con la versione sbagliata (modulo per ora e poi interpolazione) e guardare diventare rosso **solo** il test dell'inversione:

```ts
  // difetto da rimettere e poi togliere
  const a = Math.hypot(prendiU(ore[0])![0], prendiV(ore[0])![0]) * scala;
  return a;
```

- [ ] **Step 6: commit**

```bash
git add web/src/map/proiezione.ts web/test/valoreInterpolato.test.ts
git commit -m "feat(spa): il valore di un vettore, con l'ordine giusto fra interpolazione e modulo"
```

---

