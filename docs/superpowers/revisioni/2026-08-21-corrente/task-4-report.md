# Task 4: lo shader a quattro texture, rapporto

## Cosa ho implementato

Il livello del campo ora tiene **quattro** texture di dato invece di due, e sa
disegnare il modulo di un campo vettoriale. La capacita' c'e' ma e' **spenta**:
l'unico chiamante passa una lista di una voce, `u_modulo` resta falso e a schermo
non cambia niente.

### `web/src/map/shader.ts`

Tre uniform nuove (`u_a2`, `u_b2`, `u_modulo`) e il blocco che calcola `valore`
riscritto come nel brief. La cosa che conta e' l'**ordine**: si interpolano nel
tempo le due componenti, ognuna col suo peso, e solo dopo si prende
`length(vec2(c1, c2))`. Il commento porta il motivo (all'inversione di marea una
componente passa da +0,3 a -0,3, il valore vero a meta' e' zero e la media dei
moduli darebbe 0,3, cioe' un mare che non sta mai fermo).

Due commenti in piu' rispetto al testo del brief, entrambi sul "cosa costa se e'
sbagliato":

- sul guardiano `u_modulo && pesoA2 <= 0.0 && pesoB2 <= 0.0`: meta' di un vettore
  non e' un vettore, e dare zero alla componente che manca darebbe una corrente
  piu' lenta del vero;
- sul modulo preso sui valori **grezzi**: e' lecito solo perche' le due
  componenti hanno la stessa scala di archiviazione (0,001 per entrambe nel
  catalogo vero). Il brief rimandava a "App.tsx e il suo test", che oggi non
  esiste: ho scritto invece che il controllo sta a chi mette insieme le
  componenti, che arriva col task che accende la corrente, e che questo shader ci
  conta.

Quando `u_modulo` e' falso le due `media()` in piu' non si eseguono: stanno dentro
un ternario, che in GLSL ES 3.00 valuta un solo ramo. Il costo per il percorso
scalare di oggi e' un confronto per frammento.

### `web/src/map/campo.ts`

- `ComponenteFrame` esportato, con il motivo per cui e' un tipo e non quattro
  parametri: in una firma a otto parametri scambiare due `Int16Array` adiacenti
  compila e disegna un campo sbagliato in silenzio.
- `texA2` / `texB2`, create in `onAdd` con `texturaDato` e distrutte in
  `onRemove`; `chiaveA2` / `chiaveB2`; `modulo = false`.
- `imposta(componenti: ComponenteFrame[], frazione: number)`: il numero di voci
  decide `modulo`, quindi non c'e' un interruttore da tenere allineato a mano con
  quante texture sono state davvero caricate.
- `render`: `u_modulo` passato, e le due texture nuove legate alle unita' 5 e 6.

### `web/src/map/animazione.ts` e `web/test/animazione.test.ts`

Il chiamante passa `[{ a, chiaveA, b, chiaveB: b ? chiaveB : null }]`, cioe' il
comportamento identico a prima. Il finto livello dei test dell'animazione segue la
firma nuova.

## Due scostamenti dal brief, entrambi perche' il brief citava cose che non ci sono

1. **`imposta` ha un solo chiamante di produzione, non due.** Il brief (e il
   messaggio di dispaccio) dicono `web/src/ui/MapView.tsx` riga 304 e seguenti.
   Verificato: in `MapView.tsx` non esiste nessuna chiamata a
   `LivelloCampo.imposta`. Quella a riga 355 e' `particelle.imposta(...)`, cioe'
   `LivelloParticelle`, una classe diversa con una firma diversa (sei
   `Int16Array` piu' tre numeri) che questo task non tocca. L'unico chiamante e'
   `animazione.ts:282`.
   Il chiamante che il brief non nomina e c'era davvero e' il **doppio nei test**:
   `web/test/animazione.test.ts` implementava la firma vecchia di `imposta`, e
   senza aggiornarlo il typecheck cade. E' l'unico file di test toccato, e non
   aggiunge casi: adatta il doppio.
2. **`web/test/campo.test.ts` non esiste** e non l'ho creato: lo step 7 del brief
   lo mette nell'aggiunta all'indice, ma lo step 1 dello stesso brief dice che qui
   non si scrivono test. Ho seguito lo step 1.

## Come ho scelto le unita' di texture

Oggi `render()` costruisce un array `[texture, nome]` e usa **l'indice come
unita'**: `u_a`=0, `u_b`=1, `u_costa`=2, `u_maschera`=3, `u_palette`=4. Le due
nuove le ho **accodate** (5 e 6) invece di infilarle accanto a `u_a` e `u_b`, che
sarebbe stato piu' ordinato da leggere: accodando, nessuna delle cinque che
c'erano cambia unita', quindi un errore mio qui non poteva presentarsi come
"costa e palette scambiate", cioe' come un difetto di resa lontano dalla causa.
Il limite minimo garantito da WebGL2 e' 16 unita' nel frammento, quindi sette non
e' vicino a niente.

Le due texture nuove si allocano sempre, anche per l'altezza d'onda che non le
usa. `texturaDato` non chiama `texImage2D`, quindi finche' non arriva un dato
sono una `createTexture` e nessuna memoria di immagine; allocarle solo al bisogno
vorrebbe dire creare texture dentro `imposta()`, che gira dentro il ciclo di
disegno. Restano legate alle unita' 5 e 6 anche quando `u_modulo` e' falso, cioe'
sempre oggi: lo shader non le campiona, e il caso "texture allocata e mai
popolata, legata e non letta" e' lo stesso che il livello ha gia' oggi fra il
montaggio e il primo `imposta` (vedi il commento su `alPrimoDisegno`). I 38 end
to end confermano che il disegno non cambia.

## Comandi e output

### Partenza, prima di toccare (step 2)

```
$ cd web && npm run typecheck && npm test && npx playwright test
> tsc --noEmit          (nessun errore)
 Test Files  26 passed (26)
      Tests  245 passed (245)
  38 passed (1.9m)
```

**38 su 38.** Il dispaccio avvisava di una base a 37 su 38 con
`e2e/coerenza.spec.ts` intermittente: in questo giro quel test e' passato, quindi
la mia riga di partenza e' 38 verdi e non ho avuto bisogno di rieseguire niente
da solo.

### Arrivo, sull'albero finale (step 6)

```
$ cd web && npm run typecheck
> tsc --noEmit          (nessun errore)

$ cd web && npm test
 Test Files  26 passed (26)
      Tests  245 passed (245)

$ cd web && npx playwright test
  38 passed (1.9m)
```

Confronto: **38 su 38 alla partenza, 38 su 38 all'arrivo**, gli stessi test.
Nessun rosso nuovo, e in particolare la mappa parte: se lo shader non compilasse,
`onAdd` solleverebbe e cadrebbero tutti insieme.

Il giro end to end finale l'ho eseguito **due volte**: il primo era partito prima
dell'ultima modifica (un paragrafo di commento in `campo.ts`), e anche se un
commento in un JSDoc non puo' cambiare il comportamento, la riga che riporto e'
quella misurata sull'albero che ho committato.

Verificato anche a mano che nessuno dei quattro file contenga i due caratteri di
punteggiatura piu' lunghi del meno ASCII: ho scritto le modifiche con uno script
python, e l'hook che li blocca copre gli strumenti di scrittura, non python.

## File cambiati

- `web/src/map/shader.ts` (tre uniform, blocco del valore riscritto)
- `web/src/map/campo.ts` (tipo `ComponenteFrame`, due texture, due chiavi,
  `modulo`, `imposta` nuova, `render`)
- `web/src/map/animazione.ts` (la chiamata, una voce)
- `web/test/animazione.test.ts` (il doppio segue la firma nuova)

## Test nuovi: nessuno, e con che rete ho lavorato

Nessun test nuovo, e non e' una dimenticanza.

- `LivelloCampo` non ha ne' ha mai avuto test unitari. Riverificato oggi: in
  `web/test/` non esiste `campo.test.ts` e non esiste nessun doppio di
  `WebGLRenderingContext`. Il codice grafico di questo repo si prova end to end.
- Un doppio di `gl` proverebbe **la contabilita' delle texture** (quante
  `texImage2D`, su quale unita'), che non e' dove sta il rischio: il rischio e'
  l'ordine fra interpolazione e modulo, e quello vive nel GLSL, che un doppio non
  esegue.
- **La rete sono stati i 38 end to end**, che il percorso a una componente
  attraversa per intero (compreso il progetto sul bundle compilato). Il percorso
  a **due** componenti resta scoperto: nessun test, oggi, accende `u_modulo`.
  Sara' provato quando la corrente si accende.

## Cosa ha trovato la mia autorevisione

Una cosa, e l'ho scritta nel codice: **`u_haB` e' uno solo per tutte e due le
componenti**. Se un chiamante passasse una componente con l'ora t+1 e l'altra
senza (facile: le due componenti si leggono da due cache indipendenti, e in
`MapView` la direzione fa proprio cosi' con tre campi), lo shader entrerebbe nel
ramo `u_haB` e interpolerebbe la seconda componente verso `texB2`, che contiene
il fotogramma che le era rimasto dentro. `pesoB2` sarebbe maggiore di zero,
quindi nessun guardiano scatterebbe: verrebbe fuori un modulo continuo,
plausibile e costruito su due istanti diversi.

Non ho aggiunto un guardiano in `imposta`, perche' non e' una decisione mia da
prendere qui: significherebbe scegliere se il livello **spegne** l'interpolazione
(sicuro ma silenzioso) o **solleva** (rumoroso ma dentro il ciclo di disegno), e
il percorso a due componenti non ha ancora chiamanti. Ho scritto l'invariante nel
commento di `imposta`, in grassetto, con cosa costa se non lo si rispetta e con
l'indicazione operativa: chi legge da due cache passa `b: null` a **entrambe** se
a una manca, che e' quello che `MapView` fa gia' per le particelle
(`q.dopo && chiesti.every(([, b]) => b) ? q.frazione : 0`).

**Questo e' il punto da guardare nel task che accende la corrente.**

Altre due cose viste e ritenute non problemi:

- passando da due componenti a una, `texA2` e `chiaveA2` restano con il dato
  vecchio. `modulo` diventa falso, quindi non si legge; e se si torna alla stessa
  componente, la chiave combacia e la texture non si ricarica, che e' corretto e
  gratis.
- `render` lascia `activeTexture` sull'unita' 6 invece della 4. La lasciava gia'
  sulla 4 invece della 0, quindi non e' una regola nuova che si rompe, ed e' la
  ragione in piu' per cui il giro end to end completo (che include il bundle
  compilato) era obbligatorio e non una formalita'.

## Dubbi

1. **Il difetto del brief sui chiamanti** (un solo chiamante di produzione, non
   due; e il chiamante vero non nominato era il doppio nei test) e' documentato
   sopra. Se il piano dei task successivi da' per assodato che `MapView` chiami
   `LivelloCampo.imposta`, va corretto: il campo si imposta **solo** da
   `Animazione.disegna`, quindi l'accensione della corrente passa da la' o da un
   secondo `Prefetcher` che arriva fino a la'.
2. **`u_haB` condiviso**: vedi l'autorevisione. Non e' un difetto di questo task,
   e' un contratto che il task successivo deve rispettare o cambiare.
3. Il commento del brief citava `App.tsx e il suo test` per il controllo delle
   scale uguali. Non esiste ancora: l'ho scritto come un rimando al task che
   accende la corrente. Se quel controllo finira' altrove, va aggiornata quella
   riga in `shader.ts`.
