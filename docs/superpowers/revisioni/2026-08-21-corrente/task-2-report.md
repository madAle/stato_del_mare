# Task 2: il ritorno della scia, accanto alla cresta (report)

## Cosa e' stato implementato

`web/src/map/particelle.ts`:
- `PUNTI_SCIA = 12` e `FOTOGRAMMI_PER_PUNTO = 6`, riportati dal commit
  `a09da47^` con il loro commento originale (la misura della polvere bianca:
  una scia presa a ogni fotogramma e' lunga sei pixel a schermo).
- `Particella` ha un nuovo campo `scia: number[]` (le ultime posizioni, dalla
  piu' vecchia alla piu' recente).
- `nasci()` inizializza `scia: []`.
- `avanza()` ha un sesto parametro opzionale `registraScia = false` (default
  cambiato rispetto al codice del 2026-08-20, che era `true`): quando vero,
  accoda `(p.i, p.j)` alla scia e la tronca a `PUNTI_SCIA * 2` numeri con
  `splice`.

`web/src/map/livelloParticelle.ts`:
- Nuova costante esportata `VELOCITA_SCIA_PX_S = 45`, con il commento che
  spiega perche' sono due numeri e non uno (la velocita' apparente si misura
  in lunghezze della marca al secondo, non in pixel; una scia e' lunga il
  doppio di una cresta).
- Il costruttore prende un terzo parametro `forma: "cresta" | "scia" = "cresta"`.
  Nessun chiamante esistente (`MapView.tsx`) lo passa, quindi resta "cresta"
  ovunque in produzione.
- Il buffer `vertici` e' dimensionato sul caso piu' grande dei due
  (`PUNTI_SCIA + 1` vertici per particella, contro i `SEGMENTI` della cresta),
  non su `this.forma`: farlo dipendere da un campo del costruttore avrebbe
  legato la dimensione all'ordine di inizializzazione dei campi della classe,
  un rischio silenzioso per mezzo megabyte di margine che non vale la pena
  correre.
- `render()` sceglie fra `VELOCITA_A_SCHERMO_PX_S` e `VELOCITA_SCIA_PX_S` in
  base a `this.forma`, chiama `avanza` con
  `this.forma === "scia" && this.fotogramma % FOTOGRAMMI_PER_PUNTO === 0`, e
  biforca l'emissione dei vertici: il ramo "scia" riporta dal commit indicato
  la logica per cui la testa della striscia e' sempre la posizione **di
  adesso** (`p.i, p.j`), non l'ultimo punto registrato, con lo stesso commento
  sul perche' (altrimenti la striscia avanzerebbe a scatti di sei fotogrammi
  mentre la particella si muove a sessanta).
- Il frammento GLSL resta **una sola formula** (`0.55 + 0.45 * v_peso`,
  quella gia' in uso per le creste): il commento sopra spiega che il
  significato di `a_peso` cambia con la forma (distanza dal centro per la
  cresta, eta' nella scia per la scia).

`web/test/particelle.test.ts`:
- Aggiunto il blocco `describe("la scia, che serve alla corrente e non
  all'onda", ...)` con i tre test del brief.
- **Corretto il primo test rispetto al testo del brief**, come da istruzione
  esplicita ricevuta prima di cominciare: il brief chiama `avanza(...)` senza
  il sesto argomento, il che con il nuovo default `registraScia = false`
  lascerebbe la scia sempre vuota e farebbe fallire
  `toBeGreaterThan(2)` anche a codice corretto. Il test ora passa `true`
  come sesto argomento, con un commento che spiega perche'.
- Aggiornati due literal `Particella` preesistenti (righe con
  `{ i: 4, j: 3, vita: ... }`) aggiungendo `scia: []`, altrimenti non
  avrebbero piu' soddisfatto il tipo con il nuovo campo obbligatorio.

## Prova TDD

**Rosso** (comando e output):
```
cd web && npx vitest run test/particelle.test.ts -t scia
```
```
FAIL test/particelle.test.ts > la scia... > tiene le ultime posizioni e non cresce senza fine
TypeError: Cannot read properties of undefined (reading 'length')
 ❯ test/particelle.test.ts:344:22 -> expect(p[0].scia.length)...

FAIL test/particelle.test.ts > la scia... > un punto ogni tanto, non uno per fotogramma
TypeError: Cannot read properties of undefined (reading 'length')

FAIL test/particelle.test.ts > la scia... > chi non registra la scia non la accumula...
AssertionError: expected undefined to deeply equal []

Test Files  1 failed (1)
Tests  3 failed | 24 skipped (27)
```
Fallimento per la ragione giusta: `Particella`/`nasci` non producono ancora
un campo `scia`, quindi `p[0].scia` e' `undefined`. Nessun errore di sintassi
o di tipo mascherato: e' esattamente l'assenza di funzionalita' che il task
doveva aggiungere.

**Verde** (comando e output):
```
cd web && npx vitest run test/particelle.test.ts -t scia
```
```
Test Files  1 passed (1)
Tests  3 passed | 24 skipped (27)
```

Poi la suite intera del file:
```
cd web && npx vitest run test/particelle.test.ts
Test Files  1 passed (1)
Tests  27 passed (27)
```

## Verifica finale

```
cd web && npm run typecheck
> tsc --noEmit          (nessun output, pulito)

cd web && npm test
Test Files  26 passed (26)
Tests  241 passed (241)
```

Nota sul numero di test: il brief cita "la base ora e' 237"; misurato con
`git stash` prima delle mie modifiche la base era in realta' **238** (26 file,
238 test). Con i 3 test nuovi si arriva a 241, coerente.

Non ho eseguito la suite Playwright (`npx playwright test`): il costruttore di
`LivelloParticelle` in `MapView.tsx` passa solo due argomenti
(`new LivelloParticelle("direzione-onda", catalogo.griglia)`), verificato con
grep prima di cominciare, quindi `forma` resta "cresta" per default e il
disegno end to end non cambia. Il typecheck pulito conferma anche che la
firma piu' larga del costruttore non rompe quella chiamata.

## File cambiati

- `web/src/map/particelle.ts`
- `web/src/map/livelloParticelle.ts`
- `web/test/particelle.test.ts`

Un commit: `b5166fc feat(spa): torna il disegno a scia, che alla corrente
serve e all'onda no`.

## Autorevisione

Ho riletto l'intero diff (`git diff` prima del commit) verificando in
particolare:
- nessun trattino lungo unicode introdotto (`grep -P '[\x{2013}\x{2014}]'`
  sulle righe aggiunte: nessun risultato);
- il buffer `vertici` non dipende dall'ordine di inizializzazione dei campi
  (dimensionato sul massimo statico, non su `this.forma`);
- il ramo "scia" in `render()` usa lo stesso nome di attributo (`a_peso`) del
  ramo "cresta", coerente con lo shader unico richiesto dal brief;
- nessun file di appoggio lasciato nell'albero (nessuna copia `.buono`,
  nessuno script di verifica).

Non ho trovato problemi da segnalare oltre alla correzione del primo test
gia' istruita esplicitamente prima di cominciare.

## Dubbi

Nessuno bloccante. Un punto minore lasciato com'e', perche' fuori dal
perimetro del brief: il calcolo di `celleTipicheAlSecondo` in `render()`
resta basato sulla fisica dell'onda (`1.5613 * PERIODO_TIPICO_S`, cioe'
`c = g T / 2 pi`) anche quando si sceglie `forma = "scia"`. Non e' un
problema oggi: nessun chiamante passa ancora `"scia"`, e la spec (sezione 5)
lo colloca in un task successivo, quando `imposta()` iniziera' a costruire
`CampiMoto` di tipo `"corrente"`. Lo segnalo solo perche' chi affrontera'
quel task sappia che quella riga andra' probabilmente rivista insieme al
resto del cablaggio.
