## Task 4: lo shader a quattro texture

**File:**
- Modificare: `web/src/map/shader.ts`
- Modificare: `web/src/map/campo.ts`
- Modificare: `web/src/map/animazione.ts` (la chiamata a `imposta`)
- Modificare: `web/src/ui/MapView.tsx` (la chiamata a `imposta`)
- Test: nessuno nuovo, e il perché sta nello step 1.

**Interfacce:**
- Consuma: niente dai task precedenti.
- Produce:
  ```ts
  export type ComponenteFrame = {
    a: Int16Array; chiaveA: string; b: Int16Array | null; chiaveB: string | null;
  };
  // LivelloCampo:
  imposta(componenti: ComponenteFrame[], frazione: number): void;
  ```
  Una lista di uno si comporta **esattamente** come oggi; una lista di due accende il modulo.

- [ ] **Step 1: capire con che rete si sta lavorando, prima di toccare**

Questo task **non aggiunge un comportamento visibile**: cambia una firma e prepara lo shader. Quindi non si scrive un test nuovo, e va detto perché, se no chi esegue crede di aver dimenticato qualcosa.

- `LivelloCampo` **non ha né ha mai avuto test unitari**, e non è una dimenticanza: è un custom layer WebGL, e in questo repo il codice grafico si prova end to end (`web/e2e/`, due progetti, uno sul bundle compilato). Verificato il 2026-08-21: in `web/test/` non esiste nessun doppio di `WebGLRenderingContext` e nessun `campo.test.ts`.
- Costruire un doppio di `gl` per contare le `texImage2D` proverebbe **solo la contabilità** delle texture, non il modulo né l'ordine dell'interpolazione, che sono le due cose che possono essere sbagliate. Il costo (un doppio di WebGL2 da mantenere) non lo vale.
- **La rete che c'è**: i 38 test end to end. Il percorso a una componente ci passa dentro tutto, quindi se questo task rompe qualcosa, sono loro a dirlo. Il percorso a **due** componenti resta scoperto fino al task 6, e il task 7 è quello che lo prova davvero: **non si salta nessuno dei due**.

- [ ] **Step 2: fissare il punto di partenza**

Comando: `cd web && npm run typecheck && npm test && npx playwright test`
Atteso: 38 end to end verdi **prima** di toccare. Senza questa riga, un rosso più tardi non si sa se l'hai fatto tu.

- [ ] **Step 3: implementare lo shader**

In `web/src/map/shader.ts`, dentro `FRAMMENTO`, aggiungere le uniform:

```glsl
uniform isampler2D u_a2;       // seconda componente all'ora t, solo se u_modulo
uniform isampler2D u_b2;       // seconda componente all'ora t+1
uniform bool u_modulo;         // true: il valore e' il modulo delle due componenti
```

e sostituire il blocco che calcola `valore` con:

```glsl
  // Si interpolano nel tempo le COMPONENTI, e solo dopo si prende il modulo.
  // Nell'ordine opposto la corrente non si annullerebbe mai: all'inversione di
  // marea una componente passa da +0,3 a -0,3 e il valore vero a meta' e' zero,
  // mentre la media dei moduli da' 0,3. Non si vede come un errore, si vede
  // come un mare che non sta mai fermo.
  float pesoA;
  float va = media(u_a, p, pesoA);
  float pesoA2 = pesoA;
  float va2 = u_modulo ? media(u_a2, p, pesoA2) : 0.0;
  float c1;
  float c2;
  if (u_haB) {
    float pesoB;
    float vb = media(u_b, p, pesoB);
    float pesoB2 = pesoB;
    float vb2 = u_modulo ? media(u_b2, p, pesoB2) : 0.0;
    if (pesoA <= 0.0 && pesoB <= 0.0) { fragColor = vec4(0.0); return; }
    if (u_modulo && pesoA2 <= 0.0 && pesoB2 <= 0.0) { fragColor = vec4(0.0); return; }
    // Se una delle due ore non ha dato qui, si usa l'altra invece di mediare
    // con zero, che sarebbe un campo che sprofonda e risale a ogni ora.
    c1 = pesoA <= 0.0 ? vb : (pesoB <= 0.0 ? va : mix(va, vb, u_frazione));
    c2 = !u_modulo ? 0.0
       : (pesoA2 <= 0.0 ? vb2 : (pesoB2 <= 0.0 ? va2 : mix(va2, vb2, u_frazione)));
  } else {
    if (pesoA <= 0.0) { fragColor = vec4(0.0); return; }
    if (u_modulo && pesoA2 <= 0.0) { fragColor = vec4(0.0); return; }
    c1 = va;
    c2 = va2;
  }
  // Il modulo si prende sui valori GREZZI e si scala dopo: e' lecito solo
  // perche' le due componenti hanno la stessa scala, e chi le mette insieme lo
  // verifica (vedi App.tsx e il suo test).
  float valore = u_modulo ? length(vec2(c1, c2)) : c1;
```

- [ ] **Step 4: implementare il livello**

In `web/src/map/campo.ts`:
- aggiungere `texA2` e `texB2` accanto a `texA` e `texB`, create in `onAdd` con `this.texturaDato(gl)` e distrutte in `onRemove`;
- aggiungere `chiaveA2` e `chiaveB2`, e `modulo = false`;
- sostituire `imposta` con:

```ts
  /**
   * I fotogrammi da disegnare, una voce per componente.
   *
   * Una sola componente e' il caso di sempre (altezza d'onda, periodo, livello
   * del mare). Due sono un campo vettoriale: la corrente. Il numero di voci
   * decide `u_modulo`, quindi non c'e' un interruttore da tenere allineato a
   * mano con quante texture sono state caricate.
   */
  imposta(componenti: ComponenteFrame[], frazione: number): void {
    if (!this.gl || componenti.length === 0) return;
    const [primo, secondo] = componenti;
    if (primo.chiaveA !== this.chiaveA) {
      this.carica(this.gl, this.texA!, primo.a);
      this.chiaveA = primo.chiaveA;
    }
    this.haB = primo.b !== null;
    if (primo.b && primo.chiaveB !== this.chiaveB) this.carica(this.gl, this.texB!, primo.b);
    this.chiaveB = primo.b ? primo.chiaveB : null;

    this.modulo = componenti.length > 1;
    if (secondo) {
      if (secondo.chiaveA !== this.chiaveA2) {
        this.carica(this.gl, this.texA2!, secondo.a);
        this.chiaveA2 = secondo.chiaveA;
      }
      if (secondo.b && secondo.chiaveB !== this.chiaveB2) this.carica(this.gl, this.texB2!, secondo.b);
      this.chiaveB2 = secondo.b ? secondo.chiaveB : null;
    }

    this.frazione = frazione;
    this.haDatoCaricato = true;
    this.mappa?.triggerRepaint();
  }
```

- in `render`, legare le due texture nuove alle unità 5 e 6 (controllare quali sono libere: costa, maschera, palette e le due del dato occupano già le prime) e passare `u_modulo`.

- [ ] **Step 5: aggiornare i due chiamanti**

`web/src/map/animazione.ts` riga 282 e `web/src/ui/MapView.tsx` riga 304 e seguenti passano una lista di una voce, così il comportamento non cambia:

```ts
    this.livello.imposta([{ a, chiaveA, b, chiaveB: b ? chiaveB : null }], b ? q.frazione : 0);
```

- [ ] **Step 6: eseguire tutto**

Comando: `cd web && npm run typecheck && npm test && npx playwright test`
Atteso: 232 test unitari più i nuovi, e **38 end to end verdi**. Questo è il punto in cui si scopre se lo shader non compila più: un errore di compilazione GLSL solleva da `onAdd` e la mappa non parte.

- [ ] **Step 7: commit**

```bash
git add web/src/map/shader.ts web/src/map/campo.ts web/src/map/animazione.ts web/src/ui/MapView.tsx web/test/campo.test.ts
git commit -m "feat(spa): il campo sa disegnare il modulo di due componenti"
```

---

