# Task 5: il cablaggio a due campi, con la corrente ancora spenta, rapporto

## Cosa ho implementato

Il nodo dell'id si scioglie: `App.tsx` cerca la variabile del catalogo col
**primo campo** della grandezza (`grandezza?.campi[0]`), non con l'id della
grandezza. Il prefetcher singolo diventa una lista (`prefetcherCampi:
Prefetcher[]`), una voce per campo, costruita con lo stesso schema che la
direzione usa gia' per i suoi tre campi. La lista arriva a `MapView` (prop
`prefetcherCampi`), che la tiene in un ref usato in tre punti diversi:

- `aggiornaValore` e `aggiornaIsolinee` leggono solo il **primo campo**
  (le isolinee esistono solo per l'altezza d'onda, che ha un campo solo; il
  valore sotto il mouse con la seconda componente arriva col task che accende
  la corrente);
- il ref intero passa ad `Animazione`, che e' l'unica a impostare il livello.

`Animazione.disegna()` ora legge un fotogramma da **ogni** prefetcher della
lista, tutti sulla stessa coppia di ore, costruisce la lista di
`ComponenteFrame` e non disegna niente se manca il fotogramma A di una
qualunque componente; la dissolvenza (frazione diversa da zero) vale solo se
OGNI componente ha anche l'ora dopo. Il resto del ciclo (`assicuraFinestra`,
`avanza`, `chiediAvanti`, cioe' prontezza e prefetch in avanti) guarda ancora
solo il primo campo, come fa gia' MapView: e' un limite noto e dichiarato nel
commento su `prefetcherCampi` in `OpzioniAnimazione`, che il task che accende
la corrente dovra' sciogliere.

La corrente resta `disegnabile: false` in `ui/grandezze.ts`: a schermo non
cambia niente.

### Le quattro cose decise dalla revisione

1. **`campo.ts`**: `this.haB = primo.b !== null && (!secondo || secondo.b !==
   null)`. Con una sola componente (`secondo` undefined) e' identico a prima.
   Commento con il motivo (u_haB e' uno solo per due texture) e il costo se
   sbagliato (texelFetch su una texture mai popolata legge zeri, e zero non e'
   NODATA: nessun guardiano dello shader se ne accorgerebbe).
2. **`App.tsx`**: la funzione `scaleCoerenti` (nuova, in `ui/grandezze.ts`)
   confronta le scale dei campi di una grandezza; la predicate che sceglie la
   grandezza da disegnare ora e' `g.id === variabile && g.disegnabile &&
   scaleCoerenti(g, variabili)`. Una grandezza con le scale divergenti si
   comporta come una non disegnabile: ricade su `VARIABILE_DISEGNATA` con lo
   stesso meccanismo gia' in uso (l'effetto che corregge lo stato quando
   `grandezza.id !== variabile`).
3. **`shader.ts`**: un commento sul ripiego per pixel della seconda
   componente, che dichiara l'assunzione (ubar e vbar condividono la
   maschera nodata perche' vengono dallo stesso file) e il costo se non
   valesse (un modulo costruito su due istanti).
4. **`campo.ts`**: una riga di commento su `imposta([])`, che non fa niente
   in silenzio.

### Uno scostamento deliberato dalla lettera del brief, con motivo

Il brief mette la dipendenza del nuovo `useMemo` su `[cache, catalogo.data,
grandezza]` (l'intero oggetto). L'ho cambiata in `[cache, catalogo.data,
grandezza?.campi.join()]`. Motivo: `grandezzeDi()` non e' memoizzato, quindi
`grandezza` cambia identita' a **ogni** render di `App`, anche quando i campi
sono gli stessi; e `App` ri-renderizza fino a dieci volte al secondo durante
la riproduzione (`alTempo` arriva da `Animazione` a quella frequenza e chiama
`setIstante`). Con l'oggetto come dipendenza, il `useMemo` avrebbe ricreato un
`Prefetcher` nuovo dieci volte al secondo, per **qualunque** grandezza
selezionata (non solo la corrente), perdendo le richieste in volo del
prefetcher scartato a ogni giro. La tecnica (`array.join()` per una
dipendenza stabile) e' gia' in uso nel file per le query key
(`scelta?.tipi.an.mesi.join()`). Non e' un cambiamento di comportamento
visibile, ma una correzione di un difetto di prestazioni che il testo del
brief avrebbe introdotto silenziosamente.

## TDD: rosso e verde

### I due test del brief, su `grandezze.test.ts`

Prima ho scritto i due test del brief (piu' tre su `scaleCoerenti`, non
richiesti dal brief ma richiesti dalle "quattro cose decise") e reso la
fabbrica `campo()` fedele al catalogo vero (scala 0,001 per ubar/vbar).

Rosso (`npx vitest run test/ui/grandezze.test.ts`):
```
FAIL ... scaleCoerenti > e' vera per una grandezza a un campo solo...
TypeError: scaleCoerenti is not a function
(3 test falliti su 12, gli altri 9 gia' verdi perche' la fabbrica fedele
 rendeva veri i due test del brief da subito)
```

Implementato `scaleCoerenti` in `ui/grandezze.ts`.

Verde:
```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

### Il controllo sulle scale in App.tsx

E' lo stesso `scaleCoerenti`, gia' provato sopra e chiamato da `App.tsx`
nella predicate di selezione della grandezza. Non ho scritto un secondo test
che monta `App` (nessun test esistente lo fa: montare `App` per intero
richiederebbe un doppio di `react-query`, del catalogo e della mappa, un
costo sproporzionato per provare una riga che chiama una funzione gia'
provata). Ho verificato a mano che la riga `g.disegnabile &&
scaleCoerenti(g, variabili)` sia effettivamente nel percorso eseguito
leggendo il file dopo la modifica; il typecheck e i 252 test unitari
confermano che non ha rotto niente.

### Un test genuinamente nuovo, oltre il brief: `disegna()` a due componenti

Il brief non prova la nuova logica di `Animazione.disegna()` che compone
piu' prefetcher (perche' non ne parla: pensa solo al passaggio da un
`Prefetcher` a `Prefetcher[]`, senza toccare `disegna()`). Ho aggiunto due
test in `animazione.test.ts` che esercitano il caso a due campi (readiness
"tutti i campi" e dissolvenza "ogni campo ha l'ora dopo"), e ho verificato
che **falliscono per la ragione giusta** iniettando temporaneamente il
difetto che dovrebbero prevenire (`.slice(0, 1)` sulla lista dei
prefetcher, cioe' il comportamento a un solo campo):

```
FAIL ... non disegna finche' non sono pronti TUTTI i campi...
  expected [ { frazione: +0, haB: false, voci: 1 } ] to deeply equal []
FAIL ... la dissolvenza vale solo se OGNI campo ha l'ora dopo...
  expected { frazione: 0.5, haB: true, voci: 1 } to deeply equal
  { frazione: +0, haB: true, voci: 2 }
```

Ripristinato il file buono con `cp` da una copia (mai `git checkout`), non
con l'editor: i due test tornano verdi.

Nota tecnica su questi due test: il primo non usa `Prefetcher.assicura()` per
popolare la cache ma `cache.metti()` direttamente, perche' `vaiA()` avvia da
solo un prefetch di sfondo sul primo campo (`assicuraFinestra` guarda solo
`prefetcherCampi.current[0]`); con un `await` di mezzo quel prefetch di
sfondo avrebbe avuto il tempo di completarsi e falsare lo stato che il test
voleva controllare. E' una scoperta della sessione di test, non del codice di
produzione.

## Comandi e output

### Prima di cominciare (base dichiarata dal brief)

245 test unitari, typecheck pulito, 38 su 38 end to end (confermato dal
report del task 4 sullo stesso albero).

### Dopo, sull'albero committato (33e7e71)

```
$ npm run typecheck
> tsc --noEmit                    (nessun errore)

$ npm test
 Test Files  26 passed (26)
      Tests  252 passed (252)
```

252 = 245 + 2 (i due test del brief) + 3 (`scaleCoerenti`) + 2 (`disegna()`
a due componenti).

```
$ npx playwright test
  38 passed (1.9m)
```

**38 su 38, gli stessi test, prima e dopo.** Eseguito una volta sola: non era
intermittente in questo giro.

## File cambiati

- `web/src/ui/App.tsx`: nodo dell'id sciolto sul primo campo, guardia
  `scaleCoerenti` nella scelta della grandezza, `prefetcherCampi` al posto
  di `prefetcher`, `StatusBar` allineata a `grandezza!.id`.
- `web/src/ui/MapView.tsx`: prop `prefetcherCampi: Prefetcher[]`, ref
  omonimo, `aggiornaValore`/`aggiornaIsolinee` sul primo campo, unita' e id
  di `scriviValoreEStato` presi dalla grandezza, `Animazione` costruita con
  la lista.
- `web/src/map/animazione.ts`: `OpzioniAnimazione.prefetcherCampi:
  Leggibile<Prefetcher[]>`; `disegna()` compone `ComponenteFrame[]` da tutti
  i campi; il resto del ciclo guarda il primo.
- `web/src/map/campo.ts`: `haB` combinato fra le due componenti; commento su
  `imposta([])`.
- `web/src/map/shader.ts`: commento sul ripiego per pixel della seconda
  componente; aggiornato il commento che rimandava "al task che accende la
  corrente" (ora il controllo esiste davvero, in `scaleCoerenti`).
- `web/src/ui/grandezze.ts`: nuova funzione `scaleCoerenti`.
- `web/test/ui/grandezze.test.ts`: fabbrica fedele alle scale vere, i due
  test del brief, tre test su `scaleCoerenti`.
- `web/test/animazione.test.ts`: interfaccia aggiornata a `prefetcherCampi`
  (rinomina meccanica su undici costruzioni di `Animazione`), `livelloFinto`
  registra anche `voci`, due test nuovi sul percorso a due campi.

Commit: `33e7e71 fix(spa): l'id verso il bucket e' quello del campo, non
quello della grandezza`.

## La parte facoltativa (unione discriminata per `ComponenteFrame`)

Non l'ho fatta. Valutata: trasformare `ComponenteFrame` in `{ a: Int16Array;
chiaveA: string; b: Int16Array; chiaveB: string } | { a: Int16Array;
chiaveA: string; b: null; chiaveB: null }` toglierebbe il ternario
`chiaveB: b ? chiaveB : null` in `Animazione.disegna()`, ma non toglierebbe
il cast: `a` resta `Int16Array | undefined` finche' il guardiano
`componenti.some((c) => !c.a)` non ha girato, e quel guardiano non e' nel
discriminante dell'unione proposta (che riguarda solo la coppia
b/chiaveB). Il cast attuale (`componenti as ComponenteFrame[]`) diventerebbe
un cast verso un'unione da una forma che non corrisponde strutturalmente a
nessuno dei due membri, il tipo di cast che TypeScript rifiuta senza un
doppio cast (`as unknown as ...`), che e' esattamente la sorta di rumore che
l'unione discriminata dovrebbe togliere. Il beneficio (un ternario in meno)
non ripaga il rischio di introdurlo in un task che deve lasciare tutto
com'era a schermo; lo lascio al task successivo, che tocchera' comunque
questa stessa funzione per la prontezza a piu' campi.

## Cosa ha trovato la mia autorevisione

1. **La dipendenza sbagliata nello snippet del brief per `prefetcherCampi`**
   (descritta sopra, sezione "scostamento deliberato"): usare l'oggetto
   `grandezza` intero come dipendenza del `useMemo` avrebbe ricreato un
   `Prefetcher` nuovo fino a dieci volte al secondo durante la riproduzione,
   per qualunque grandezza. Non l'ho seguita alla lettera.
2. **Il commento in `shader.ts` che rimandava "al task che accende la
   corrente"** per il controllo delle scale (scritto dal task 4) era
   diventato falso dopo questo task: il controllo esiste gia'. Aggiornato per
   puntare a `scaleCoerenti`.
3. **Il campo `haB` del doppio dei test (`livelloFinto`) e' rimasto ambiguo
   col passaggio a due componenti**: registra `componenti[0].b !== null`,
   cioe' la presenza di `b` sulla **prima** componente passata da `disegna()`,
   non l'`haB` combinato che calcola il vero `LivelloCampo.imposta()` (quello
   della decisione 1). L'ho tenuto cosi' perche' e' comunque un'osservazione
   corretta di cosa `Animazione` ha passato (il doppio non replica la logica
   interna del livello vero, e non dovrebbe: quella la esercita solo la
   suite end to end, come gia' notato nel rapporto del task 4). Ma il nome
   `haB` in un contesto a due componenti puo' fuorviare chi legge il test
   senza questa nota.
4. Verificato a mano (oltre al typecheck) che nessuno degli otto file
   toccati contenga i due caratteri Unicode piu' lunghi del segno meno ASCII,
   con `grep -nP '\x{2013}|\x{2014}'` (non con un embed diretto del
   carattere, che il livello di sicurezza della sessione ha rifiutato come
   comando "troppo complesso" per ragioni indipendenti da questo task).

## Dubbi

1. **La prontezza a piu' campi resta sul primo campo soltanto**
   (`assicuraFinestra`, `avanza`, `chiediAvanti`): oggi e' innocuo (la
   corrente e' spenta, e per le grandezze a un campo solo e' l'unico campo
   che esiste), ma e' un limite che il task che accende la corrente deve
   sciogliere esplicitamente, non solo ereditare. L'ho scritto nel commento
   su `prefetcherCampi` in `OpzioniAnimazione`; se quel task non lo vede,
   rischia di dichiarare "pronto" un istante per cui manca ancora vbar.
2. **`campiDirezione` in `App.tsx`** (l'array `["dwave_sin", "dwave_cos",
   "pwave"]`) e' un array letterale ricreato a ogni render, escluso dalle
   dipendenze di `prefetcherDirezione` con lo stesso schema che ho appena
   usato per `prefetcherCampi` (una stringa derivata stabile). Non l'ho
   toccato perche' e' fuori dal perimetro di questo task, ma e' la controprova
   che il problema descritto sopra (oggetto array come dipendenza instabile)
   era gia' presente nel codice esistente, e vale la pena tenerlo a mente se
   un giorno la direzione avesse lo stesso sintomo.
3. Nessun dubbio sui quattro punti del brief corretto dall'utente: li ho
   seguiti alla lettera (tranne la dipendenza del punto 3, spiegata sopra).
