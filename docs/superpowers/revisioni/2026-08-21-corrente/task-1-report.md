# Report Task 1: il moto da (u, v)

Commit: `89cde3a` "feat(spa): il motore delle particelle sa muoversi anche su una corrente"

## Cosa ho implementato

In `web/src/map/particelle.ts`:

- Nuovo tipo `Geometria` (larghezza, altezza, risoluzioneM, yMax): la parte
  comune ai due campi di moto.
- `CampiDirezione` sparito, sostituito da `CampiMoto`, unione discriminata su
  `tipo`: `"onda"` (sin, cos, periodo, come prima) o `"corrente"` (u, v, le due
  componenti della velocita' in m/s).
- `velocitaInCelle` riscritta con un `if (campi.tipo === "onda") {...} else {...}`:
  il ramo onda e' identico a prima (stesso commento sul cerchio unitario, stesso
  mezzo giro), il ramo corrente calcola `metriAlSecondo = Math.hypot(u, v)` e usa
  `est = u / metriAlSecondo`, `nord = v / metriAlSecondo` (nessun mezzo giro: u e
  v dicono gia' dove l'acqua va). La correzione di Mercatore e il calcolo finale
  di `di`/`dj` restano fuori dal ramo, condivisi da entrambe le sorgenti.
- `latitudineDi`, `cresta`, `nasci`, `avanza`: firma aggiornata da
  `CampiDirezione` a `CampiMoto` (nessuna delle tre usa i campi specifici di una
  sorgente, solo `Geometria` o il risultato di `velocitaInCelle`).

In `web/src/map/livelloParticelle.ts`:

- Import e tipo del campo `campi` da `CampiDirezione` a `CampiMoto`.
- In `imposta`, l'oggetto costruito ora dichiara `tipo: "onda"` (unico punto
  dell'app che oggi produce un `CampiMoto`: la corrente arriva in un task
  successivo).

In `web/test/particelle.test.ts`:

- Import `CampiMoto` al posto di `CampiDirezione`; la fabbrica `campi()` ora
  dichiara `tipo: "onda"` nell'oggetto restituito.
- Aggiunta la fabbrica `correnteUniforme` e il blocco `describe("il moto della
  corrente", ...)` con i cinque test, copiati alla lettera dal brief.
- **Modifica non prevista dal brief, necessaria per il tipo**: quattro punti nei
  test dell'onda preesistenti mutavano `c.sin[...]`/`c.cos[...]` direttamente sul
  risultato di `campi()`. Da quando `campi()` restituisce `CampiMoto` (un'unione),
  TypeScript non lascia piu' accedere a `.sin`/`.cos` senza restringere su `tipo`,
  quindi ho aggiunto un cast `(c as { sin: Float32Array; cos: Float32Array })`
  prima della mutazione, esattamente lo stesso pattern che il brief stesso usa
  per il lato corrente (`(senza as { u: Float32Array }).u[...] = NaN;`). Il
  comportamento a runtime dei test non cambia: e' solo un'annotazione di tipo per
  chi legge il file.

## Prove TDD

### Rosso (Step 2)

Comando: `npx vitest run test/particelle.test.ts` (prima dell'implementazione)

```
FAIL  |default| test/particelle.test.ts > il moto della corrente > la velocita' e' il modulo...
TypeError: Cannot read properties of undefined (reading '28')
 at velocitaInCelle src/map/particelle.ts:74:19 (campi.sin[k])
...
Test Files  1 failed (1)
     Tests  5 failed | 18 passed (23)
```

Comando: `npm run typecheck` (stesso stato)

```
test/particelle.test.ts(4,41): error TS2305: Module '"../src/map/particelle"' has no exported member 'CampiMoto'.
```

Perche' questo era il rosso giusto: `vitest` usa esbuild, che spoglia i tipi
senza controllarli, quindi il file "compila" per vitest anche con `CampiMoto`
assente dall'import (e' un import `type`, sparisce a runtime); il fallimento a
runtime arriva perche' l'oggetto `{ tipo: "corrente", u, v, ... }` non ha i campi
`sin`/`cos`/`periodo` che `velocitaInCelle` legge ancora incondizionatamente.
`tsc`, che invece i tipi li controlla, fallisce esattamente dove il brief lo
prevedeva: `CampiMoto` non esportato. I due comandi insieme coprono sia "il tipo
non esiste" sia "anche se esistesse, l'implementazione non sa cosa farne".

### Verde (Step 4)

Comando: `npm run typecheck && npx vitest run test/particelle.test.ts`

```
> tsc --noEmit
(nessun errore)

Test Files  1 passed (1)
     Tests  23 passed (23)
```

23 = 18 test dell'onda preesistenti + 5 nuovi della corrente, tutti verdi.

### Suite intera (dopo l'implementazione)

Comando: `npm test`

```
Test Files  26 passed (26)
     Tests  237 passed (237)
```

237 = 232 di base + 5 nuovi, coerente.

### Step 5: i due difetti rimessi, uno alla volta

Ripristino sempre con `cp` da una copia (`particelle.ts.buono`), mai
`git checkout`, come richiesto: il file era gia' stato scritto in questa
sessione e non ancora committato al momento della prova.

**Difetto 1: mezzo giro anche sulla corrente** (`est = -u / metriAlSecondo`)

```
FAIL test/particelle.test.ts > il moto della corrente > va dove l'acqua va, senza mezzo giro
AssertionError: expected -0.0005811565472370381 to be greater than 0
Test Files  1 failed (1)
     Tests  1 failed | 22 passed (23)
```

Esattamente il test previsto dal brief, e nessun altro: rosso atteso, per la
ragione attesa (`versoEst.di` diventa negativo).

**Difetto 2: velocita' fissa** (`metriAlSecondo = 0.2`)

```
FAIL test/particelle.test.ts > il moto della corrente > dove il dato non c'e' non inventa una rotta
AssertionError: expected { di: +0, dj: -0 } to be null
Test Files  1 failed (1)
     Tests  1 failed | 22 passed (23)
```

**Questo non e' il test che il brief prevedeva** ("la velocita' e' il modulo,
non viene da una formula" restava verde). L'ho verificato algebricamente e poi a
runtime: con `est = u / metriAlSecondo` e poi `celleAlSecondo = metriAlSecondo /
(...)`, il valore di `metriAlSecondo` si elide sempre nel prodotto finale
`di = est * celleAlSecondo = u / (cos(lat) * risoluzioneM)`, qualunque sia il
valore (purche' diverso da zero) usato per normalizzare. Il rapporto
`veloce.di / lento.di` resta quindi 4 anche con velocita' fissa a 0.2: il test
"la velocita' e' il modulo" non e' sensibile a questa particolare mutazione,
per come e' costruita la formula (normalizza e poi riscala per lo stesso
fattore). Il difetto pero' rompe un'altra proprieta' reale: con `metriAlSecondo`
fisso a 0.2, il controllo di guardia `metriAlSecondo <= 0` non scatta piu' su
`correnteUniforme(0, 0)` (u=v=0), quindi la funzione restituisce una rotta
`{di: 0, dj: -0}` invece di `null`: il test "dove il dato non c'e' non inventa
una rotta" (terza asserzione) intercetta il difetto comunque, mostrando che la
mutazione e' catturata dalla suite, solo da un test diverso da quello indicato
nel brief.

Non ho modificato ne' l'implementazione ne' i test per far coincidere il rosso
con la previsione del brief: i valori dei test sono quelli forniti alla lettera,
e il codice buono (senza il difetto) e' verificato verde sopra. Segnalo questo
solo come scoperta della revisione, non come problema da correggere.

Ripristino dopo ciascun difetto: `cp particelle.ts.buono particelle.ts`, poi
`npx vitest run test/particelle.test.ts` di nuovo verde a 23/23 prima di passare
al difetto successivo (e alla fine).

## Verifica finale (Step 6)

Comando: `npm run typecheck && npm test`

```
> tsc --noEmit
(nessun errore)

Test Files  26 passed (26)
     Tests  237 passed (237)
```

## File cambiati

- `web/src/map/particelle.ts`
- `web/src/map/livelloParticelle.ts`
- `web/test/particelle.test.ts`

## Cosa ha trovato la mia autorevisione

- Ho controllato che `CampiDirezione` non restasse in nessun punto del progetto
  (`grep -rn "CampiDirezione"` su tutto `web/`, incluso `e2e/`): nessun residuo.
  Non e' rimasto un alias di compatibilita', come richiesto.
- Ho riletto il diff completo di `particelle.ts`: i tre commenti originali sulle
  "cose che possono essere sbagliate in silenzio" (cerchio unitario, mezzo giro,
  correzione di Mercatore) sono intatti nel ramo onda; il ramo corrente ha il suo
  commento equivalente sulla quarta cosa (niente mezzo giro, la velocita' e' il
  modulo).
- Ho verificato che `nasci` e `avanza`, che prendono `CampiMoto` ma usano solo
  `larghezza`/`altezza` (parte di `Geometria`, comune a entrambe le varianti),
  continuano a compilare senza bisogno di restringere su `tipo`: TypeScript
  accetta l'accesso a campi comuni a tutti i membri di un'unione senza
  narrowing, quindi nessun cast serve li'.
- La scoperta piu' rilevante e' quella descritta sopra sullo Step 5: il secondo
  difetto richiesto dal brief non produce il rosso previsto, per una proprieta'
  algebrica della formula (normalizzazione e riscalatura per lo stesso fattore
  si elidono sempre). Produce comunque un rosso reale su un altro test della
  stessa suite nuova, quindi la mutazione e' comunque catturata: non e' un buco
  di copertura, e' solo un'imprecisione nella previsione testuale del brief su
  quale test specifico si sarebbe acceso.

## Dubbi

- Il dubbio principale e' gia' descritto sopra (Step 5, difetto 2): la
  previsione del brief su quale test sarebbe diventato rosso non corrisponde a
  quanto osservato, per una ragione algebrica verificabile. Non l'ho trattato
  come blocco perche' il difetto viene comunque rilevato dalla suite (da un
  test diverso), e non ho bisogno di una decisione architetturale per procedere:
  lo segnalo per trasparenza, nel caso valga la pena annotarlo nel piano o nella
  spec per chi rilegge questo task in futuro.
- Nessun altro dubbio: la firma di `cresta` e' cambiata come anticipato nelle
  istruzioni fuori brief, ed e' coperta dall'ultimo test del blocco nuovo.

---

## Giro di correzione 1

### Cosa ho provato a cambiare

In `web/test/particelle.test.ts`, dentro `describe("il moto della corrente", ...)`:

- Rinominato il test preesistente "la velocita' e' il modulo, non viene da una
  formula" in "raddoppiando la corrente su un solo asse raddoppia lo
  spostamento", con un commento che non promette piu' di provare che la
  velocita' e' il modulo (il rilievo del revisore era corretto: su un solo asse
  non lo prova).
- Aggiunto un nuovo test, "compone u e v come un vettore unico, non asse per
  asse", con una corrente diagonale (u=0.3, v=0.4), che ricostruisce la
  velocita' in metri al secondo invertendo la correzione di Mercatore e la
  confronta con `hypot(0.3, 0.4) = 0.5`, piu' un controllo sul verso
  (`v.di / v.dj`) per escludere che uno scambio di segno su un solo asse
  passi inosservato.

**Non ho toccato `particelle.ts`**: il codice di produzione non e' cambiato in
questo giro (per la ragione spiegata sotto).

### La scoperta: il test richiesto non chiude i due rilievi

Prima di fidarmi del test ho fatto quello che il giro di correzione chiedeva
esplicitamente: scritto il test, vistolo passare sul codice buono, poi rimesso
a mano il difetto e guardato se diventava rosso. **Non e' diventato rosso**, e
questo mi ha portato a verificare la cosa fino in fondo invece di insistere.

Comando (test nuovo scritto, codice ancora buono):

```
cd web && npx vitest run test/particelle.test.ts
```

Esito: 24/24 verdi (18 dell'onda, 6 della corrente: i 5 originali piu' il
nuovo). Il test diagonale passa con `Math.hypot`, come atteso.

Poi ho rimesso a mano, in `velocitaInCelle`, ramo `corrente`, la riga
`metriAlSecondo = Math.hypot(u, v);` sostituita con
`metriAlSecondo = Math.abs(u) + Math.abs(v);` (la norma di Manhattan indicata
dal revisore) e rieseguito lo stesso comando:

```
Test Files  1 passed (1)
     Tests  24 passed (24)
```

**Nessun test diventa rosso**, incluso quello nuovo. Ho ripetuto con altre due
varianti dello stesso difetto, per escludere che fosse un caso isolato di
quella formula specifica:

- `metriAlSecondo = 2 * Math.hypot(u, v)` (fattore due): 24/24 verdi.
- `metriAlSecondo = 0.2` (il difetto gia' visto nel giro precedente): 23/24, ma
  il rosso e' sullo stesso test di prima ("dove il dato non c'e' non inventa
  una rotta", terza asserzione, `correnteUniforme(0, 0)`), non sul test
  diagonale ne' su quello del modulo.

Ho ripristinato con `cp` da una copia (`particelle.ts.buono`), mai
`git checkout`, tra un tentativo e l'altro, e riverificato 24/24 verdi e
typecheck pulito prima di procedere. Ho ripulito lo script Node usato per la
verifica algebrica preliminare (`web/check-cancellazione.mjs`), non era
destinato a restare nel repository.

### Perche' succede, e perche' non e' un buco lasciato per fretta

E' una proprieta' algebrica di come `velocitaInCelle` e' scritta, non un
effetto collaterale di una formula sbagliata. Nel ramo corrente:

```
metriAlSecondo = f(u, v)              // qualunque f non negativa, zero solo se u=v=0
est = u / metriAlSecondo
nord = v / metriAlSecondo
...
celleAlSecondo = metriAlSecondo / (cos(lat) * risoluzioneM)
di = est * celleAlSecondo
   = (u / metriAlSecondo) * (metriAlSecondo / (cos(lat) * risoluzioneM))
   = u / (cos(lat) * risoluzioneM)
```

Il fattore `metriAlSecondo` si elide sempre nel prodotto finale, qualunque sia
`f`, purche' diverso da zero e usato in entrambi i passaggi (come e' qui). Lo
stesso vale per `dj`. Quindi `di` e `dj` sono sempre e soltanto
`u / (cos(lat) * risoluzioneM)` e `-v / (cos(lat) * risoluzioneM)`,
**indipendentemente** dalla formula scritta per il modulo: nessun test
sull'esito di `velocitaInCelle` puo' distinguere `Math.hypot(u, v)` da
`Math.abs(u) + Math.abs(v)`, da una costante o da un fattore raddoppiato, ne'
su una corrente diagonale ne' su nessun'altra. L'ho verificato sia
algebricamente sia sul codice vero, con tre formule diverse: nessuna cambia
l'esito, tranne quando tocca lo zero esatto (u=v=0), dove qualunque norma da'
zero comunque, quindi anche li' non distingue `Math.hypot` da un'alternativa.

Perche' l'onda non ha questo problema, come gia' notava il coordinatore: la'
la direzione (`est`, `nord`) si normalizza per il modulo di **seno e coseno**
(che vale sempre circa 1, ed e' solo un controllo di validita'), mentre la
velocita' viene da una variabile indipendente, il periodo. Nella corrente,
direzione e velocita' derivano **dalla stessa coppia (u, v)**: dividerle per
il loro stesso modulo e poi ri-moltiplicarle per quel modulo (nel codice
condiviso a valle, comune ai due rami apposta per non duplicare la correzione
di Mercatore) e' un'identita' matematica, non un calcolo. Non e' un difetto
introdotto da questo task: e' una conseguenza necessaria dell'aver messo a
fattor comune il codice a valle fra onda e corrente, che il brief originale
voleva esplicitamente ("tutto quello che sta a valle... e' identico: separarle
vorrebbe dire due copie di quella roba").

**Conseguenza pratica**: la mutazione che il revisore e il coordinatore temono
(un refactoring futuro che rompe la composizione dei due assi) non farebbe
fallire nessun test, ma non farebbe nemmeno **cambiare il comportamento
osservabile dell'app**: qualunque formula non negativa e nulla solo in (0,0)
produce esattamente la stessa animazione, pixel per pixel. Non e' un bug
nascosto: e' un tratto di codice dove piu' implementazioni sono davvero,
dimostrabilmente, equivalenti.

### Cosa ho tenuto, e con quale onesta'

Ho tenuto il test diagonale perche' non e' inutile: le cinque prove originali
usano sempre un asse a zero, quindi nessuna si accorgerebbe di uno scambio fra
`u` e `v`, di un segno invertito su un solo asse, o di una correzione di
Mercatore applicata a una sola componente. Il test nuovo controlla proprio
questo (modulo **e** verso di `(di, dj)` insieme, con entrambe le componenti
diverse da zero), e questa parte **e' rossa se rotta**: l'ho provato scambiando
mentalmente il ruolo di `est`/`nord` nella formula e verificando che il
rapporto `v.di / v.dj` cambierebbe.

Quello che non ho fatto e' lasciare che il commento del test affermasse una
cosa che ho appena dimostrato falsa. La prima versione che avevo scritto
diceva che il test "rende visibile la differenza fra una norma euclidea vera e
una scorciatoia per-asse": l'ho riscritta per dire esplicitamente che il test
**non** prova quale formula calcola il modulo, con la dimostrazione in breve
dentro il commento e un suggerimento su come si farebbe se servisse davvero
(isolare il calcolo del modulo in una funzione propria e provare quella in
isolamento). Un commento che promette una garanzia che il codice sotto non da'
e' esattamente il tipo di errore che le convenzioni di questo progetto
chiedono di non fare.

### Stato dei due rilievi

Nessuno dei due e' chiuso dal test come specificato:

- **Rilievo 1** (del revisore): l'affermazione tecnica specifica ("divergono su
  una corrente diagonale vera") e' verificata **falsa** su questa
  implementazione, sia algebricamente sia sul codice reale.
- **Rilievo 2** (del coordinatore): confermato, e il test diagonale non lo
  chiude per lo stesso motivo: qualunque valore assoluto di velocita' (il
  modulo vero, una costante, il doppio) produce lo stesso `(di, dj)`.

Tre strade possibili, che richiedono una decisione:

1. **Accettare il limite** e lasciare il commento che spiega perche' nessun
   test sull'esito di `velocitaInCelle` puo' certificare la formula del
   modulo per la corrente (quello che ho scritto ora). Costo se sbagliato:
   se in futuro il codice condiviso a valle cambia (per esempio smette di
   ri-scalare per lo stesso fattore), il commento invecchia e va riletto.
2. **Isolare il calcolo del modulo** in una funzione propria esportata (es.
   `moduloCorrente(u, v)`) e provare quella in isolamento. Chiude il rilievo
   alla lettera, ma prova "e' scritto Math.hypot" piuttosto che "il
   comportamento e' quello giusto": un test sull'implementazione, non sul
   comportamento, in un file che altrove evita apposta questo stile.
3. Qualcos'altro che il revisore o il coordinatore preferiscano.

Non ho scelto da solo fra le tre: e' un fork sulla filosofia dei test di
questo file (comportamento vs implementazione), non un dettaglio di codifica.

### Comandi eseguiti in questo giro (stato finale, dopo il ripristino)

```
cd web && npx vitest run test/particelle.test.ts
```
```
Test Files  1 passed (1)
     Tests  24 passed (24)
```

```
cd web && npm run typecheck
```
```
> tsc --noEmit
(nessun errore)
```

### File cambiati in questo giro

- `web/test/particelle.test.ts` (modificato, non ancora committato)
- `web/src/map/particelle.ts` (invariato: stesso contenuto del commit
  `89cde3a`, verificato dopo il ripristino)

**Nessun commit** in questo giro: la modifica e' pronta ma dichiarare chiuso il
giro di correzione sarebbe scorretto finche' non si decide fra le tre strade
sopra. Il rilievo minore differito dal coordinatore (i quattro cast nei test
dell'onda) resta come segnalato, non toccato.

---

## Giro di correzione 1, seguito: la misura del coordinatore e la decisione

Il coordinatore ha rifatto la misura per conto proprio, confermato che il
rilievo del revisore era falso al livello dell'uscita (con hypot, Manhattan,
costante e doppio, `di`/`dj` escono identici alla nona cifra, diagonale
compresa), e trovato il difetto vero: applicare alla corrente la costante
dell'onda (`VELOCITA_PER_SECONDO_DI_PERIODO`) su un solo lato della divisione,
cioe' disaccoppiare la variabile usata per normalizzare da quella usata per
riscalare in celle. Decisione: il codice di produzione non si tocca (resta
`Math.hypot(u, v)`, forma parallela al ramo onda, perche' afferma la fisica);
il test diagonale si tiene e si riformula per provare **quello**, non "quale
norma"; un commento nel codice registra la misura per chi la ritrovera' dopo.

### Cosa ho cambiato

In `web/test/particelle.test.ts`:

- Il test diagonale (rinominato "compone u e v come un vettore unico, e non
  porta un fattore spurio") ha lo stesso corpo di prima (ricostruzione della
  velocita' in m/s da (di, dj) invertendo la correzione di Mercatore, piu' il
  controllo sul verso), ma il commento e' riscritto in due parti come chiesto:
  cosa prova (l'assenza di un fattore spurio, con la misura 0,780655 invece di
  0,5) e cosa non prova e perche' (quale norma, perche' si elide; il solo
  punto osservabile e' la guardia a zero, gia' coperta altrove).
- Il test sopra (quello su un solo asse) resta con il commento gia' corretto
  nel giro precedente, che non promette piu' di provare che la velocita' e' il
  modulo.

In `web/src/map/particelle.ts`, accanto a `metriAlSecondo = Math.hypot(u, v);`
nel ramo `corrente` di `velocitaInCelle`: un commento che dice che quella riga
e' un'affermazione di fisica, non un calcolo con conseguenze osservabili fuori
dalla guardia a zero; che la cancellazione e' stata misurata con tre formule
diverse; che non va "semplificata" in `est = u; nord = v` perche' la forma
regge il significato anche se il numero non cambierebbe; e che il difetto
reale che questa forma previene e' il fattore spurio da riga copiata, con la
stessa misura (0,780655) e un rimando al test che lo prova.

### Il rosso sul difetto giusto (non Manhattan)

Ho riprodotto esattamente il difetto descritto (la costante dell'onda su un
lato solo), rimpiazzando nel ramo corrente:

```ts
metriAlSecondo = Math.hypot(u, v);
if (metriAlSecondo <= 0) return null;
est = u / metriAlSecondo;
nord = v / metriAlSecondo;
```

con:

```ts
const modulo = Math.hypot(u, v);
if (modulo <= 0) return null;
est = u / modulo;
nord = v / modulo;
metriAlSecondo = VELOCITA_PER_SECONDO_DI_PERIODO * modulo;
```

(la normalizzazione usa `modulo`, la riscalatura condivisa usa
`metriAlSecondo`: due variabili dove prima ce n'era una sola, esattamente la
"riga copiata dal ramo accanto"). Copia di sicurezza con `cp` prima di
modificare, mai `git checkout`.

Comando: `cd web && npx vitest run test/particelle.test.ts`

```
❯ |default| test/particelle.test.ts (24 tests | 1 failed) 6ms
     × compone u e v come un vettore unico, e non porta un fattore spurio 2ms

 FAIL  |default| test/particelle.test.ts > il moto della corrente > compone u e v come un vettore unico, e non porta un fattore spurio
AssertionError: expected 0.7806550144780123 to be close to 0.5, received difference is 0.28065501447801233, but expected 5e-7

Test Files  1 failed (1)
     Tests  1 failed | 23 passed (24)
```

Rosso sul test giusto, e su nessun altro: `0.7806550144780123` combacia con la
misura del coordinatore (0,780655) alla settima cifra. Ripristinato con
`cp particelle.ts.buono particelle.ts` (mai `git checkout`), poi riverificato
verde.

### Verifica finale, dopo il ripristino e il commento di produzione

Comando: `cd web && npx vitest run test/particelle.test.ts`

```
Test Files  1 passed (1)
     Tests  24 passed (24)
```

Comando: `cd web && npm run typecheck`

```
> tsc --noEmit
(nessun errore)
```

### Commit

`26e111a` "test(spa): la corrente diagonale prova l'assenza di un fattore
spurio, non la norma" (2 file: `web/src/map/particelle.ts`,
`web/test/particelle.test.ts`).

### Autorevisione

- Verificato che il numero misurato a mano (0,7806550144780123) coincide con
  quello riportato dal coordinatore (0,780655) prima di scrivere il commento
  che lo cita, invece di fidarmi della loro cifra senza rifare la prova.
- Riletto il commento di produzione chiedendomi se un futuro lettore che vuole
  davvero "semplificare" (rimuovere `Math.hypot` e scrivere `di = u/(cos*ris)`
  direttamente) capirebbe cosa perde: la risposta e' che perderebbe la frase
  "la velocita' di una corrente e' il modulo delle sue componenti" come fatto
  visibile nel codice, non un numero diverso. L'ho scritto esplicitamente
  perche' non restasse implicito.
- Non ho toccato il rilievo minore differito (i quattro cast nei test
  dell'onda): resta fuori da questo giro come richiesto.

### Dubbi

Nessuno: la misura del coordinatore ha risolto il fork che avevo segnalato nel
giro precedente (accettare il limite vs isolare il modulo in una funzione
propria), scegliendo la terza strada che non avevo considerato: cambiare cosa
il test afferma, non cosa il codice fa. Non ho altro da segnalare.
