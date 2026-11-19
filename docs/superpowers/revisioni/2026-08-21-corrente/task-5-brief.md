## Task 5: il cablaggio, con la corrente ancora spenta

**File:**
- Modificare: `web/src/ui/App.tsx:140-220`
- Modificare: `web/src/ui/MapView.tsx`
- Modificare: `web/src/map/animazione.ts`
- Test: `web/test/ui/grandezze.test.ts`, `web/test/animazione.test.ts`

**Interfacce:**
- Consuma: `ComponenteFrame` dal task 4.
- Produce: `App` passa a `MapView` `prefetcherCampi: Prefetcher[]` invece di `prefetcher: Prefetcher`; `Animazione` tiene `prefetcherCampi: RefObject<Prefetcher[]>`.

- [ ] **Step 1: scrivere il test che falisce**

Il nodo è una riga sola e va fissata con un test che parla di lei:

```ts
it("la variabile del catalogo si cerca col **primo campo**, non con l'id della grandezza", () => {
  // E' il vincolo che STATO.md chiamava "da sciogliere prima della corrente":
  // per le grandezze a un campo solo i due id coincidono, per la corrente no,
  // e cercare per id della grandezza darebbe undefined, cioe' l'app ferma sul
  // ramo di caricamento con un catalogo perfetto.
  const g = grandezzeDi(CATALOGO);
  const corrente = g.find((x) => x.id === "corrente")!;
  expect(corrente.id).not.toBe(corrente.campi[0]);
  expect(CATALOGO.some((v) => v.id === corrente.id)).toBe(false);
  expect(CATALOGO.some((v) => v.id === corrente.campi[0])).toBe(true);
});

it("le due componenti della corrente hanno la stessa scala, che il modulo grezzo richiede", () => {
  // Lo shader prende il modulo sui valori grezzi e scala dopo: con due scale
  // diverse darebbe una velocita' sbagliata di un fattore, cioe' un numero
  // plausibile e falso. Verificato nel catalogo vero il 2026-08-21 (0,001 e
  // 0,001), fissato qui perche' il giorno che ARPAE ne cambiasse una lo si
  // sappia da un test e non da uno screenshot.
  const g = grandezzeDi(CATALOGO);
  const corrente = g.find((x) => x.id === "corrente")!;
  const scale = corrente.campi.map((c) => CATALOGO.find((v) => v.id === c)!.scala);
  expect(new Set(scale).size).toBe(1);
});
```

- [ ] **Step 2: eseguire e vedere fallire**

Comando: `cd web && npx vitest run test/ui/grandezze.test.ts`
Atteso: FAIL sul secondo test, perché la fabbrica `campo()` del file dà scala 1 a tutti: va resa fedele al catalogo vero (0,001 per `ubar` e `vbar`) prima che il test dica qualcosa.

- [ ] **Step 3: sciogliere il nodo in App**

In `web/src/ui/App.tsx`, sostituire la riga e il commento:

```ts
  // **L'id nell'URL e' quello della grandezza, gli id verso il bucket sono
  // quelli dei campi.** Per le grandezze a un campo solo i due coincidono; per
  // la corrente no, e cercare qui per id della grandezza darebbe undefined,
  // cioe' l'app ferma sul ramo di caricamento con un catalogo perfetto. Scala e
  // offset vengono dal **primo** campo, ed e' lecito perche' le componenti di
  // una stessa grandezza li hanno identici (test in grandezze.test.ts).
  const sceltaGrezza = variabili.find((v) => v.id === grandezza?.campi[0]);
```

e sostituire il prefetcher singolo con la lista, sullo stesso schema che la direzione usa già:

```ts
  const prefetcherCampi = useMemo(
    () => (catalogo.data && grandezza
      ? grandezza.campi.map((campo) => new Prefetcher(cache, campo, (ora: Ora) =>
          leggiFrame(urlFrame(campo, ora.tipo, ora.riferimento, new Date(ora.istante)),
                     catalogo.data!.griglia)))
      : []),
    [cache, catalogo.data, grandezza],
  );
```

- [ ] **Step 4: portare la lista fino al livello**

`MapView` riceve `prefetcherCampi` e lo tiene in un ref; `Animazione` lo prende al posto del singolo. Dove prima leggeva un fotogramma, ora ne legge uno per campo e costruisce la lista di `ComponenteFrame`:

```ts
      const componenti = prefetcherCampiRef.current.map((p) => {
        const chiaveA = p.chiave(q.prima);
        const a = cache.prendi(chiaveA);
        const chiaveB = q.dopo ? p.chiave(q.dopo) : null;
        const b = chiaveB ? cache.prendi(chiaveB) ?? null : null;
        return { a, chiaveA, b, chiaveB: b ? chiaveB : null };
      });
      // Se manca un fotogramma di una qualunque componente non si disegna
      // niente, invece di mescolare componenti di istanti diversi: sarebbe un
      // campo perfettamente liscio e sbagliato.
      if (componenti.some((c) => !c.a)) return;
      this.livello.imposta(
        componenti as ComponenteFrame[],
        componenti.every((c) => c.b) ? q.frazione : 0,
      );
```

Nello stesso task, correggere una divergenza che la corrente farebbe comparire: `MapView` scrive il numero a schermo con `variabileRef.current.unita` e `.id`, cioè l'unità e l'id del **catalogo**, mentre `App` passa alla barra di stato `grandezza.unita`. Per le grandezze a un campo le due unità coincidono per caso (`m`, `s`, `m`); per la corrente no, perché il catalogo dice `m s-1` e la grandezza dice `m/s`, e i due punti dello schermo direbbero la stessa misura in due modi. Usare in **entrambi** i posti quelli della grandezza:

```ts
            segnaposto.scrivi(scriviValoreEStato(
              valore, grandezzaRef.current.unita, grandezzaRef.current.id));
```

- [ ] **Step 5: eseguire tutto**

Comando: `cd web && npm run typecheck && npm test && npx playwright test`
Atteso: tutto verde. `corrente` è ancora `disegnabile: false`, quindi a schermo non cambia niente: questo task non aggiunge funzionalità, sposta un giunto.

- [ ] **Step 6: commit**

```bash
git add web/src/ui/App.tsx web/src/ui/MapView.tsx web/src/map/animazione.ts web/test
git commit -m "fix(spa): l'id verso il bucket e' quello del campo, non quello della grandezza"
```

---

