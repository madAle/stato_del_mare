## Task 1: il moto da (u, v)

**File:**
- Modificare: `web/src/map/particelle.ts`
- Modificare: `web/src/map/livelloParticelle.ts` (solo il tipo passato)
- Test: `web/test/particelle.test.ts`

**Interfacce:**
- Consuma: niente.
- Produce:
  ```ts
  export type Geometria = {
    larghezza: number; altezza: number; risoluzioneM: number; yMax: number;
  };
  export type CampiMoto =
    | ({ tipo: "onda"; sin: Float32Array; cos: Float32Array; periodo: Float32Array } & Geometria)
    | ({ tipo: "corrente"; u: Float32Array; v: Float32Array } & Geometria);
  export function velocitaInCelle(campi: CampiMoto, i: number, j: number): { di: number; dj: number } | null;
  ```
  `CampiDirezione` sparisce: chi lo importava usa `CampiMoto`.

- [ ] **Step 1: scrivere i test che falliscono**

In `web/test/particelle.test.ts`, accanto alla fabbrica `campi()` che esiste, aggiungere la fabbrica della corrente e il blocco di test:

```ts
/** Un campo di corrente uniforme, in m/s. */
function correnteUniforme(
  est: number, nord: number, larghezza = 8, altezza = 6,
): CampiMoto {
  const n = larghezza * altezza;
  return {
    tipo: "corrente",
    u: new Float32Array(n).fill(est),
    v: new Float32Array(n).fill(nord),
    larghezza, altezza, risoluzioneM: 1200, yMax: 5_500_000,
  };
}

describe("il moto della corrente", () => {
  it("va dove l'acqua va, senza mezzo giro", () => {
    // Al contrario di Dwave, che dichiara la direzione **da cui** l'onda viene,
    // ubar e vbar sono componenti della velocita': dicono gia' dove l'acqua va.
    // Girarle di mezzo giro qui sarebbe la cosa piu' dannosa che questa mappa
    // possa fare a chi la usa per uscire in barca.
    const versoEst = velocitaInCelle(correnteUniforme(0.5, 0), 4, 3)!;
    expect(versoEst.di).toBeGreaterThan(0);
    expect(Math.abs(versoEst.dj)).toBeLessThan(1e-9);

    // Il nord e' j che CALA, come per l'onda: la riga 0 e' quella a nord.
    const versoNord = velocitaInCelle(correnteUniforme(0, 0.5), 4, 3)!;
    expect(versoNord.dj).toBeLessThan(0);
    expect(Math.abs(versoNord.di)).toBeLessThan(1e-9);
  });

  it("la velocita' **e'** il modulo, non viene da una formula", () => {
    // Per l'onda la velocita' si ricava da c = g T / 2 pi perche' il dato da' il
    // periodo e non la celerita'. Qui il dato E' la velocita': inventarla
    // mostrerebbe velocita' relative false, cioe' un gradiente che non c'e'.
    const lento = velocitaInCelle(correnteUniforme(0.1, 0), 4, 3)!;
    const veloce = velocitaInCelle(correnteUniforme(0.4, 0), 4, 3)!;
    expect(veloce.di / lento.di).toBeCloseTo(4, 6);
  });

  it("corregge la deformazione di Mercatore, come per l'onda", () => {
    // Un metro di mappa vale cos(latitudine) metri di mare: senza correzione la
    // stessa corrente correrebbe piu' veloce a nord che a sud, cioe'
    // l'animazione mostrerebbe un gradiente che nel mare non c'e'.
    const c = correnteUniforme(0.5, 0);
    const sud = velocitaInCelle(c, 4, 0)!;
    const nord = velocitaInCelle(c, 4, 5)!;
    expect(Math.abs(nord.di)).not.toBeCloseTo(Math.abs(sud.di), 9);
  });

  it("dove il dato non c'e' non inventa una rotta", () => {
    const senza = correnteUniforme(0.5, 0);
    (senza as { u: Float32Array }).u[3 * 8 + 4] = NaN;
    expect(velocitaInCelle(senza, 4, 3)).toBeNull();
    expect(velocitaInCelle(correnteUniforme(0.5, 0), -1, 3)).toBeNull();
    expect(velocitaInCelle(correnteUniforme(0, 0), 4, 3)).toBeNull();
  });

  it("la cresta funziona anche su una corrente, che e' geometria e non fisica", () => {
    // `cresta` prende il verso da `velocitaInCelle`, quindi non deve sapere da
    // che sorgente arriva. Il disegno a scia o a cresta lo decide il livello.
    const punti = cresta(correnteUniforme(0.5, 0), 4, 3, 2, 0.3)!;
    expect(punti).toHaveLength(10);
  });
});
```

Aggiungere `CampiMoto` all'import in testa al file e sostituire `CampiDirezione` con `CampiMoto` dove compare.

- [ ] **Step 2: eseguire i test e vederli fallire**

Comando: `cd web && npx vitest run test/particelle.test.ts`
Atteso: FAIL, `CampiMoto` non esportato e la fabbrica `correnteUniforme` non compila.

- [ ] **Step 3: implementare**

In `web/src/map/particelle.ts`, sostituire il tipo `CampiDirezione` con:

```ts
/** La geometria comune, uguale per qualunque campo di moto. */
export type Geometria = {
  larghezza: number;
  altezza: number;
  /** Metri di Mercatore per cella. */
  risoluzioneM: number;
  /** Coordinata y di Mercatore del bordo nord, per ricavare la latitudine. */
  yMax: number;
};

/**
 * Un campo da cui ricavare un moto, in due forme.
 *
 * **Onda**: seno e coseno della direzione da cui viene, piu' il periodo, da cui
 * la celerita' `c = g T / 2 pi`. Il verso e' mezzo giro rispetto all'angolo.
 *
 * **Corrente**: le due componenti della velocita'. Il verso e' quello delle
 * componenti, **senza** mezzo giro, e la velocita' e' il loro modulo: qui il
 * dato e' la velocita', non un periodo da cui ricavarla.
 *
 * Sono un'unione discriminata e non due funzioni separate perche' tutto quello
 * che sta a valle (la cresta, il ricambio delle particelle, la correzione di
 * Mercatore) e' identico: separarle vorrebbe dire due copie di quella roba, che
 * e' il modo in cui fra sei mesi divergono.
 */
export type CampiMoto =
  | ({ tipo: "onda"; sin: Float32Array; cos: Float32Array; periodo: Float32Array } & Geometria)
  | ({ tipo: "corrente"; u: Float32Array; v: Float32Array } & Geometria);
```

Riscrivere `velocitaInCelle` così, tenendo intatti i commenti esistenti sulle tre cose che possono essere sbagliate in silenzio e aggiungendo la quarta:

```ts
export function velocitaInCelle(
  campi: CampiMoto, i: number, j: number,
): { di: number; dj: number } | null {
  const ii = Math.floor(i);
  const jj = Math.floor(j);
  if (ii < 0 || jj < 0 || ii >= campi.larghezza || jj >= campi.altezza) return null;
  const k = jj * campi.larghezza + ii;

  let est: number;
  let nord: number;
  let metriAlSecondo: number;

  if (campi.tipo === "onda") {
    const s = campi.sin[k];
    const c = campi.cos[k];
    const t = campi.periodo[k];
    if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
    const modulo = Math.hypot(s, c);
    if (modulo < 0.5) return null;
    // Dove l'onda **va**: mezzo giro rispetto a dove viene.
    est = -s / modulo;
    nord = -c / modulo;
    metriAlSecondo = VELOCITA_PER_SECONDO_DI_PERIODO * t;
  } else {
    const u = campi.u[k];
    const v = campi.v[k];
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    // La velocita' **e'** il modulo, e il verso e' quello delle componenti:
    // niente mezzo giro, perche' u e v dicono gia' dove l'acqua va.
    metriAlSecondo = Math.hypot(u, v);
    if (metriAlSecondo <= 0) return null;
    est = u / metriAlSecondo;
    nord = v / metriAlSecondo;
  }

  const celleAlSecondo = metriAlSecondo / (Math.cos(latitudineDi(campi, jj)) * campi.risoluzioneM);
  return { di: est * celleAlSecondo, dj: -nord * celleAlSecondo };
}
```

In `web/src/map/livelloParticelle.ts` cambiare l'import e il tipo del campo da `CampiDirezione` a `CampiMoto`, e in `imposta` costruire `{ tipo: "onda", ... }`.

- [ ] **Step 4: eseguire e vedere verde**

Comando: `cd web && npm run typecheck && npx vitest run test/particelle.test.ts`
Atteso: PASS su tutti, compresi i test dell'onda che c'erano già.

- [ ] **Step 5: verificare che i test nuovi sappiano fallire**

Rimettere il difetto e guardare il rosso, uno per volta:
1. mezzo giro anche sulla corrente (`est = -u / metriAlSecondo`): deve diventare rosso "va dove l'acqua va".
2. velocità fissa (`metriAlSecondo = 0.2`): deve diventare rosso "la velocita' e' il modulo".

Comando: `cd web && npx vitest run test/particelle.test.ts` dopo ogni difetto, e ripristinare con `cp` da una copia, **non** con `git checkout` (cancellerebbe il lavoro non committato).

- [ ] **Step 6: commit**

```bash
cd web && npm run typecheck && npm test
git add web/src/map/particelle.ts web/src/map/livelloParticelle.ts web/test/particelle.test.ts
git commit -m "feat(spa): il motore delle particelle sa muoversi anche su una corrente"
```

---

