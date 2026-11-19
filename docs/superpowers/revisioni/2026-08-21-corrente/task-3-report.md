# Report Task 3: il valore vettoriale sotto il dito

## Cosa e' stato implementato

Aggiunta `valoreVettore` in `web/src/map/proiezione.ts`, accanto a `valoreCorrente`
(non toccata). Interpola nel tempo le due componenti u e v separatamente,
ciascuna con `valoreCorrente`, e prende il modulo (`Math.hypot`) solo dopo. Se
una delle due componenti non ha dato in quell'istante, non c'e' valore.

Aggiunto il blocco di test dal brief a `web/test/valoreInterpolato.test.ts`
(file gia' esistente, con i test di `valoreCorrente`): non e' stato creato un
nuovo file, come dice il brief ("Modificare: ... Test: ..."). Riusate le
costanti gia' definite nel file (`GRIGLIA`, `ORE`, `LON`, `LAT`,
`frameCostante`, `NODATA`) invece di ridefinirle, per non duplicare fixture.

## Verifica preliminare della firma

Controllata la firma vera di `valoreCorrente`:

```
valoreCorrente(griglia, asse, istante, prendiFrame, lon, lat, scala, offset, dissolvenza = true)
```

Coincide esattamente con l'ordine assunto dal blocco del brief. Nessun
adattamento necessario alla chiamata doppia dentro `valoreVettore`.

## TDD: rosso

Comando: `cd web && npx vitest run test/valoreInterpolato.test.ts`

Output (con i 4 test nuovi aggiunti e `valoreVettore` non ancora implementata):

```
FAIL  |default| test/valoreInterpolato.test.ts > il modulo di un vettore sotto il cursore > su un'ora esatta e' il modulo delle due componenti
TypeError: valoreVettore is not a function
FAIL  |default| ... > **interpola le componenti e poi prende il modulo**, non il contrario
TypeError: valoreVettore is not a function
FAIL  |default| ... > a tre quarti pesa di piu' l'ora dopo, componente per componente
TypeError: valoreVettore is not a function
FAIL  |default| ... > se una delle due componenti non ha dato, non c'e' valore
TypeError: valoreVettore is not a function

Test Files  1 failed (1)
     Tests  4 failed | 7 passed (11)
```

Rosso per la ragione giusta: la funzione non esiste ancora. I 7 test
preesistenti (su `valoreCorrente`) restano verdi, il che conferma che
l'aggiunta non ha toccato nulla di gia' funzionante.

## TDD: verde

Implementata `valoreVettore` come nel brief (nessun adattamento, vedi sopra).

Comando: `cd web && npm run typecheck && npx vitest run test/valoreInterpolato.test.ts`

Output:

```
> tsc --noEmit
(nessun errore)

Test Files  1 passed (1)
     Tests  11 passed (11)
```

## Prova del difetto rimesso a mano (l'ordine)

Prima di modificare, salvata una copia del file buono fuori dall'albero:
`/private/tmp/.../scratchpad/proiezione.ts.buono` (mai `git checkout` sul file,
come richiesto, per non rischiare di perdere lavoro non committato).

### Primo tentativo: lo snippet esatto del brief

Sostituito il corpo di `valoreVettore` con lo snippet indicato nel brief:

```ts
// difetto da rimettere e poi togliere
const a = Math.hypot(prendiU(ore[0])![0], prendiV(ore[0])![0]) * scala;
return a;
```

Comando: `cd web && npx vitest run test/valoreInterpolato.test.ts`

Risultato: **3 test falliscono**, non solo quello dell'inversione:

```
FAIL ... **interpola le componenti e poi prende il modulo**, non il contrario
  expected 0.3 to be close to +0
FAIL ... a tre quarti pesa di piu' l'ora dopo, componente per componente
  expected +0 to be close to 0.3
FAIL ... se una delle due componenti non ha dato, non c'e' valore
  expected 32.76937326223985 to be null

Tests  3 failed | 8 passed (11)
```

Questo non e' quello che il task chiedeva di osservare ("verifica che quel
test diventi rosso e gli altri no"). Prima di concludere che il test fosse
malfatto (e' gia' successo due volte in questo piano, dice il brief), ho
verificato con un secondo tentativo se il problema fosse nel test o nello
snippet illustrativo.

### Secondo tentativo: il difetto concettuale vero, fedele al resto del codice

Lo snippet del brief e' un placeholder che ignora del tutto `istante` (legge
sempre l'ora 0), `dissolvenza` e il nodata: non e' davvero "modulo per ora e
poi interpolazione", e' "nessuna interpolazione e nessun controllo". Ho
scritto invece il difetto concettuale descritto nel commento del task,
riusando lo stesso percorso di `valoreCorrente` (`inquadra`, `oraPiuVicina`,
`valoreA`), ma calcolando il modulo per ciascuna ora e interpolando i moduli
invece delle componenti:

```ts
const grezza = inquadra(ore, istante);
if (!grezza) return null;
const q = dissolvenza ? grezza : oraPiuVicina(grezza);
const moduloOra = (ora: Ora): number | null => {
  const fu = prendiU(ora);
  const fv = prendiV(ora);
  const vu = fu ? valoreA(griglia, fu, lon, lat, scala, offset) : null;
  const vv = fv ? valoreA(griglia, fv, lon, lat, scala, offset) : null;
  if (vu === null || vv === null) return null;
  return Math.hypot(vu, vv);
};
const a = moduloOra(q.prima);
if (!q.dopo) return a;
const b = moduloOra(q.dopo);
if (a === null) return b;
if (b === null) return a;
return a + (b - a) * q.frazione;
```

Comando: `cd web && npx vitest run test/valoreInterpolato.test.ts`

Risultato: **fallisce solo** il test dell'inversione, esattamente come
richiesto:

```
FAIL ... **interpola le componenti e poi prende il modulo**, non il contrario
  expected 0.3 to be close to +0

Tests  1 failed | 10 passed (11)
```

Questo conferma che il test e' corretto e prova esattamente quello che
dichiara: isola l'ordine sbagliato senza toccare gli altri casi (ora esatta,
tre quarti, nodata). Il problema stava solo nello snippet-placeholder del
brief, troppo semplificato per essere un vero "modulo poi interpolazione".

### Ripristino

Ripristinato il file buono con `cp` dalla copia in scratchpad (mai
`git checkout`), verificato con `diff` che il file e' tornato identico alla
copia salvata prima di manomettere.

## Verifica finale

```
$ npm run typecheck
> tsc --noEmit
(nessun errore)

$ npx vitest run
Test Files  26 passed (26)
     Tests  245 passed (245)
```

245 = 241 di base + 4 nuovi test. Nessuna regressione.

## File cambiati

- `web/src/map/proiezione.ts`: aggiunta `valoreVettore` (34 righe, commento
  compreso), nessuna modifica a `valoreCorrente` o al resto del file.
- `web/test/valoreInterpolato.test.ts`: aggiunto l'import di `valoreVettore` e
  il describe block `"il modulo di un vettore sotto il cursore"` con 4 test.

Nessun file di appoggio lasciato nell'albero: la copia buona vive solo nello
scratchpad fuori dal repository.

## Commit

```
e11650d feat(spa): il valore di un vettore, con l'ordine giusto fra interpolazione e modulo
 2 files changed, 85 insertions(+), 1 deletion(-)
```

## Cosa ha trovato l'autorevisione

Il difetto piu' rilevante non era nel codice di produzione ma nel brief
stesso: lo snippet fornito per lo step 5 ("difetto da rimettere e poi
togliere") non implementa davvero "modulo per ora e poi interpolazione", ma
ignora `istante`, `dissolvenza` e il nodata, quindi rompe anche i test "a tre
quarti" e "nodata" oltre a quello dell'inversione. Ho verificato con
un'implementazione fedele del difetto concettuale che il test dell'ordine e'
comunque ben progettato (isola esattamente e solo quel caso), quindi non ho
toccato ne' il test ne' l'implementazione buona: ho solo documentato la
discrepanza qui, dato che il brief chiede esplicitamente di segnalare quando
la verifica non si comporta come descritto.

Per il resto: la funzione e' pura (nessun accesso a stato esterno), il nome e
l'ordine dei parametri seguono la convenzione di `valoreCorrente`, il
commento riporta motivo e costo dell'errore come richiesto dalle convenzioni
del progetto. Nessun altro chiamante esiste ancora (come da task: il
collegamento e' un task successivo), verificato con una ricerca di
`valoreVettore` nel resto di `web/src` che non trova altri usi.

## Dubbi

Nessun dubbio bloccante. L'unico punto degno di nota e' la discrepanza nello
snippet del brief per lo step 5, spiegata sopra: non ha richiesto una
decisione di design, solo una verifica supplementare per escludere che il
test fosse malfatto.
