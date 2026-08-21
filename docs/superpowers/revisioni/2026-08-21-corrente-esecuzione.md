# SDD ledger, plan: docs/superpowers/plans/2026-08-21-corrente.md

(Il modello di questa riga vuole un trattino lungo, che un hook di questo
progetto vieta in qualunque file: sostituito con una virgola. La riga nomina
comunque il piano, che e' quello che serve al recupero.)

Spec: `docs/superpowers/specs/2026-08-21-corrente-design.md` (letta, e' l'autorita').
Worktree: `.claude/worktrees/feat-corrente`, branch `worktree-feat-corrente`,
allineato a `develop` con un merge ff-only (il worktree nasceva da `origin/main`,
due commit indietro, senza spec ne' piano). Base: f99e3f6.
Partenza: typecheck pulito, 232 test unitari verdi, end to end in corso.

## Scansione preliminare

### Coppie di task che condividono file o interfacce

| task A | task B | cosa produce A / cosa consuma B | esito |
| --- | --- | --- | --- |
| 1 | 2 | `CampiMoto` e la fabbrica `correnteUniforme` nel file di test / i test della scia la usano | ordine giusto, stesso file |
| 1 | 6 | `velocitaInCelle` su (u, v) / le scie della corrente | ordine giusto |
| 2 | 6 | terzo parametro del costruttore `forma` / `new LivelloParticelle("corrente-scie", griglia, "scia")` | coerente: oggi il costruttore prende (id, griglia), il 2 aggiunge il terzo |
| 2 | 8 | la scia disegnata / la sua velocita' | **CONFLITTO**, vedi rilievo B |
| 3 | 6 | `valoreVettore` / il numero sotto il dito | ordine giusto (era la lacuna trovata rivedendo il piano) |
| 4 | 5 | `ComponenteFrame` e `imposta(lista, frazione)` / i chiamanti costruiscono la lista da N prefetcher | ordine giusto |
| 4 | 6 | `u_modulo` acceso da `componenti.length > 1` / la grandezza a due campi | coerente |
| 5 | 6 | `prefetcherCampiRef` / gli step 4 e 5 lo leggono | ordine giusto |
| 5 | 6 | entrambi toccano `test/ui/grandezze.test.ts` | nessun conflitto: aggiungono test diversi |
| 6 | 8 | entrambi toccano `livelloParticelle.ts` | sequenziale, nessuna sovrapposizione |
| 7 | 6 | il test di coerenza consuma la corrente disegnata | ordine giusto |

### Ogni task contro se stesso

| task | il suo testo concorda con se stesso? |
| --- | --- |
| 1 | Quasi. Il blocco "Produce" non nomina il cambio di firma di `cresta`, che pure deve accettare `CampiMoto`: rilievo C |
| 2 | **No**: rilievo A |
| 3 | Si. Il difetto da rimettere e' illustrativo e lo dichiara |
| 4 | Si (riscritto in revisione: non chiede piu' un doppio di WebGL inesistente) |
| 5 | Si. Lo step 2 avverte che la fabbrica dei test va resa fedele al catalogo prima che il test dica qualcosa |
| 6 | Si, con una imprecisione: generalizza `LivelloParticelle.imposta`, che la tabella dei file non elenca fra i suoi. Non e' un conflitto, e la riga del commit lo include |
| 7 | Si |
| 8 | Si. `45 / (2 * 9)` fa 2,5, sopra la soglia 1,2 che il test chiede |

### Rilievi e rulings

**A. Il primo test della scia (task 2) fallirebbe per la ragione sbagliata.**
`avanza(p, correnteUniforme(0.3, 0), 0.1, () => 0.5, 5000)` non passa
`registraScia`, e il task 2 stabilisce che il default diventa `false` (perche'
l'onda non deve pagare una scia che non disegna). Con il default falso la scia
resta vuota e `toBeGreaterThan(2)` fallisce **anche a codice giusto**.
Ruling: il test passa `true` come sesto argomento. Motivo: il default falso e'
la decisione giusta (l'onda non paga), quindi si corregge il test, non il
default. Costo se sbagliato: un test che non prova il troncamento della scia,
che si vedrebbe subito perche' resterebbe rosso.

**B. La velocita' della scia arriva troppo tardi.**
Il task 8 introduce `VELOCITA_SCIA_PX_S`; fino a la' la scia disegna a 20 px/s,
che e' il numero tarato sulle **creste**. Ma il task 6 step 8 chiede di
**guardare la mappa** e giudicare, e lo farebbe su un'animazione quasi ferma:
una corrente e' dieci volte piu' lenta di un'onda, e 20 px/s su una scia da 40
px sono mezza lunghezza al secondo.
Ruling: la costante `VELOCITA_SCIA_PX_S = 45` nasce nel **task 2**, insieme alla
scia, col commento che dice perche' sono due numeri e non uno; il task 8 la
ritara a occhio e estende il test del legame. Motivo: un giudizio a occhio fatto
sul numero sbagliato e' un giudizio buttato. Costo se sbagliato: nessuno, sposta
tre righe fra due task.

**C. La firma di `cresta` cambia e il task 1 non lo dichiara.**
`cresta` chiama `velocitaInCelle`, quindi passa a `CampiMoto` anche lei. Il
test finale del task 1 lo copre, ma il blocco "Produce" non lo dice.
Ruling: lo aggiungo al brief del task 1 quando dispaccio, senza toccare il
piano. Motivo: e' informazione per chi esegue, non un cambio di progetto.
Costo se sbagliato: nessuno.

## Avanzamento
Base end to end: **37 passati, 1 fallito**, e il fallito e' `coerenza.spec.ts`,
che rieseguito da solo passa in 4 secondi. Difetto intermittente
**preesistente**, non introdotto qui.

La corsa, letta nel test: dopo `mouse.move` aspetta che `.valore` non sia vuoto
e poi lo legge. Il primo valore non vuoto puo' venire dall'ora che e' in cache,
e cambiare quando arriva il secondo fotogramma: fra l'attesa e la lettura il
numero si muove.

**Ruling (base sporca)**: si procede. Motivo: passa da solo, riguarda un test che
questo piano non tocca, e fermarsi a sistemarlo mescolerebbe due lavori. Costo se
sbagliato: un rosso intermittente durante l'esecuzione che va riconosciuto per
quello che e' invece di inseguirlo.

**Ruling (task 7)**: il test nuovo **non copia la corsa**. Nel brief del task 7
va detto di aspettare che il numero si **stabilizzi** (due letture uguali di
fila) e solo dopo confrontarlo, invece di aspettare che sia non vuoto. Motivo:
clonare un difetto intermittente raddoppia il rumore per sempre. Costo se
sbagliato: qualche secondo in piu' per test.

Minore differito per la revisione finale: `coerenza.spec.ts` ha la stessa corsa e
va sistemata allo stesso modo, ma fuori da questo piano.

Nota: questa sessione non ha uno strumento di todo, quindi il registro **e'**
l'avanzamento.

Task 1: dispacciato su sonnet, base f99e3f6. I brief dei task successivi si generano uno per volta, prima di ogni dispaccio (il guard del worktree rifiuta i cicli in bash).

### Task 1: riportato DONE_WITH_CONCERNS, commit 89cde3a (237 test, 232 base piu' 5)

Il dubbio sollevato dall'implementatore e' reale, e verificandolo ho trovato che
e' **piu' grave di come lo ha descritto lui**.

Lui dice: il secondo difetto che il brief chiedeva di rimettere (velocita' fissa,
`metriAlSecondo = 0.2`) non accende il test previsto ma un altro. Vero.

Il perche', misurato: nella formula `est = u / metriAlSecondo` seguita da
`celleAlSecondo = metriAlSecondo / (cos(lat) * risoluzioneM)`, il valore di
`metriAlSecondo` **si elide del tutto**. Provato con tre valori diversi (il
modulo, 0,2 fisso, il doppio del modulo): `di` esce **identico** in tutti e tre.

Quindi il test "la velocita' **e'** il modulo" prova solo la proporzionalita', che
per algebra vale qualunque cosa si metta in `metriAlSecondo`, purche' la si metta
in entrambi i posti. **Nessun test fissa la velocita' assoluta di una corrente**:
un errore di un fattore due passerebbe l'intera suite.

Perche' l'onda non ha lo stesso problema (controllato): la' `est` viene da seno e
coseno e la velocita' dal periodo, quindi il periodo **non** si elide, e il test
del rapporto e' significativo.

**Rilievo mio (Importante), da consegnare al giro di correzione**: aggiungere al
task 1 un test che fissa la velocita' **in valore assoluto**, con il giro di
ritorno in unita' fisiche, che non ripete la formula ma afferma la cosa fisica
("una corrente di 0,5 m/s muove la particella a 0,5 m/s di mare"):

    const c = correnteUniforme(0.5, 0);
    const v = velocitaInCelle(c, 4, 3)!;
    const metriAlSecondo = Math.hypot(v.di, v.dj) * Math.cos(latitudineDi(c, 3)) * 1200;
    expect(metriAlSecondo).toBeCloseTo(0.5, 9);

Cattura il fattore due, la velocita' fissa e una normalizzazione sbagliata, e usa
`latitudineDi` che e' esportata e provata a parte dal test di Mercatore.

Il difetto e' **nel piano che ho scritto io**, non nell'implementazione: il
codice prodotto e' quello chiesto. Non lo correggo io: va nel giro di correzione
insieme ai rilievi del revisore.

Secondo punto dal report, da far guardare al revisore senza suggerirglielo: ha
aggiunto quattro cast di tipo nei test dell'onda preesistenti, perche' l'unione
discriminata non permette piu' l'accesso diretto a `.sin`. Esiste un'alternativa
piu' pulita (dare alla fabbrica dei test il tipo della variante onda invece di
`CampiMoto`), ma la decisione la voglio dal revisore, non da me.

Revisione del task 1: dispacciata su sonnet.

Revisione task 1: aderenza **conforme** (le tre affermazioni della spec sezione 5
verificate nel codice, `CampiDirezione` sparito da tutto l'albero, un commit
solo), qualita' **da sistemare**.

Ha trovato il mio stesso difetto **indipendentemente**, e ha aggiunto una cosa
migliore: nessuno dei cinque test della corrente usa entrambe le componenti non
nulle, quindi `hypot` e una finta norma di Manhattan danno risultati **identici**
su tutti i casi esistenti (divergono solo in diagonale: 0,3 e 0,4 danno 0,5
contro 0,7). Un rifacimento che rompesse la composizione dei due assi non
farebbe fallire niente. Etichettato "imposto dal piano", che e' corretto: il
difetto e' nel piano.

La voce non verificabile dal diff (la resa a schermo con dati veri) la risolvo
io: e' giusto che non ci sia, arriva col task 6, che ha i suoi end to end.

Minore differito: quattro cast identici nei test dell'onda preesistenti
(conseguenza dell'unione discriminata). Alternativa piu' pulita: dare alla
fabbrica dei test il tipo della variante onda. **Tenuto fuori dal giro** per non
allargarlo.

Task 1: fix round 1/5 dispacciato (ripreso lo stesso implementatore, due rilievi
importanti con la stessa radice, un test diagonale li chiude entrambi; chiesto di
verificare il rosso rimettendo Manhattan al posto di hypot).

Task 1, fix round 1: tornato **NEEDS_CONTEXT**, nessun commit. L'implementatore ha
fatto il TDD come chiesto e ha scoperto che **il fix specificato non chiude i
rilievi**: ha rimesso Manhattan, il fattore due e la costante fissa, e il test
diagonale non diventa rosso per nessuno dei tre.

Verificato da me, numericamente, sulla struttura vera del ramo: con `hypot`,
`|u|+|v|`, `0.2` fisso e `2*hypot`, `di` e `dj` escono **identici alla nona
cifra**, diagonale compresa. L'intermedio si elide: `di = u / (cos * ris)`.

**Ruling 1 (rilievo del revisore respinto)**: "hypot e Manhattan divergono su una
diagonale" e' **falso al livello dell'uscita** della funzione. Il revisore ha
confuso il valore dell'intermedio (0,5 contro 0,7) con l'uscita, che non ne
dipende. Motivo: misurato con quattro varianti. Costo se sbagliato: nessuno, il
codice resta quello che il revisore ha giudicato conforme.

**Ruling 2 (il test resta, per un altro motivo)**: misurando ho trovato cosa il
test in valore assoluto **cattura**: un **fattore spurio**. Applicando alla
corrente la costante dell'onda (`C = g / 2 pi`), cioe' la riga che qualcuno
copierebbe dal ramo a dieci righe di distanza, il modulo esce **0,780655 invece
di 0,5**, e il test lo vede. Quindi non e' vacuo: non distingue *quale norma*,
distingue *se c'e' un fattore di troppo*, che e' la classe di difetto realmente
possibile qui. Costo se sbagliato: un test che copre meno di quanto il suo nome
promette, e per questo il nome e il commento devono dire esattamente cosa prova.

**Ruling 3 (il codice non si tocca)**: resta `Math.hypot(u, v)` nella forma
parallela al ramo onda, e **non** si riduce alla forma algebricamente identica
`di = u / (cos * ris)`. Motivo: quella forma nasconde la fisica, e chi la legge
non vede piu' che la velocita' di una corrente **e'** il modulo delle sue
componenti, che e' la ragione per cui il ramo esiste. Scartato anche isolare il
modulo in una funzione a parte: proverebbe l'implementazione invece del
comportamento (l'implementatore lo aveva detto, ed e' giusto). Costo se
sbagliato: tre righe di algebra che non fanno niente fuori dalla guardia a zero,
e per questo va scritto nel commento che sono un'affermazione di fisica e non un
calcolo osservabile.

Terzo fatto misurato: il valore di `metriAlSecondo` e' osservabile in **un solo
punto**, la guardia `<= 0`, ed e' per quello che il difetto della costante fissa
accendeva "dove il dato non c'e'".

Ripreso l'implementatore con i tre ruling e la richiesta di scrivere i fatti nei
commenti: e' la seconda volta oggi che tre attori diversi ci sbattono contro.

Task 1: fix round 1/5, seguito: **DONE**, commit 26e111a. Il difetto giusto (la
costante dell'onda nel ramo corrente) riprodotto sul codice vero, rosso sul test
giusto, valore misurato 0,7806550144780123 contro il mio 0,780655: combacia alla
settima cifra. Logica di produzione invariata, aggiunto solo il commento con la
misura. 24/24 verdi, typecheck pulito. Ripristinato con `cp`, mai `git checkout`.

Ri-revisione mirata del giro: dispacciata su sonnet (verdetto per rilievo, piu' la
verifica che la prova del rosso ci sia e che il numero sia coerente: un test nuovo
che sostituisce un test vacuo senza che nessuno abbia visto il suo rosso e' vacuo
a sua volta).

Brief del task 2 preparato.
Task 1: fix round 1/5 (2 chiusi, 0 aperti; commit 89cde3a..26e111a). Il
ri-revisore ha ricalcolato il numero da solo, con l'arrotondamento a Float32, e
ha trovato le stesse cifre: la prova non e' un numero copiato.
Task 1: complete (commit f99e3f6..26e111a, revisione pulita)
Task 2: dispacciato su sonnet, base 26e111a. Portati nel dispaccio i ruling A (il test passa registraScia true) e B (VELOCITA_SCIA_PX_S nasce qui), piu' le interfacce del task 1 e il debito differito dei cast (da non allargare e da non sistemare).

### Task 2: riportato DONE, commit b5166fc (241 test, base 238 e non 237: il mio brief era vecchio di un test)

Dubbio sollevato: `celleTipicheAlSecondo` in `render()` normalizza sulla fisica
dell'**onda** (`c = g T / 2 pi` con periodo tipico 3,5 s) anche nel ramo scia.
Segnalato come non bloccante oggi, perche' nessuno passa ancora `forma: "scia"`.

Misurato da me, e non e' piccolo: velocita' tipica dell'onda 5,465 m/s contro
0,057 m/s di mediana della corrente, cioe' **96 volte**. Con la normalizzazione
dell'onda una corrente mediana andrebbe a **0,47 px/s invece di 45**: 85 secondi
per percorrere una scia da 40 px. A schermo sembrerebbe **ferma**.

**Ruling (da portare al task 6)**: chi accende la corrente deve dare al fattore
una velocita' di riferimento sua. Numero da usare: **0,1 m/s**, non la mediana
0,057. Motivo: il 78 per cento del mare misurato sta sotto 0,10 m/s, quindi 0,1
e' un "tipico" che non fa strisciare il caso comune, e la mediana come
riferimento farebbe andare piu' lenta della meta' del mare. Il giudizio a occhio
del task 6 e del task 8 lo rifinisce. Costo se sbagliato: una costante, dentro
l'intervallo che il test del legame dichiara.

Questo dubbio avrebbe morso **esattamente** al controllo a occhio del task 6, ed
e' il secondo caso in cui un implementatore vede una cosa che il piano non aveva
visto.
Revisione task 2: **conforme e approvato**, nessun critico ne' importante. Ha
verificato di persona i due rischi che sapeva nominare (la firma di `avanza`, che
in produzione ha un solo chiamante, e il dimensionamento del buffer dei vertici,
`SEGMENTI = 4` contro `PUNTI_SCIA + 1 = 13`), e ha ricalcolato a mano
l'aritmetica degli indici della scia senza off-by-one.

Voce non verificabile dal diff, **risolta da me**: che il codice della scia fosse
ripreso da git e non riscritto a memoria. Estratto `a09da47^:particelle.ts` e
confrontato il blocco delle due costanti col nuovo: **identico**. Non e' una
lacuna.

Minori differiti (task 2): manca un commento sul `if (punti < 2) continue;` nel
ramo scia, dove il file non e' provato senza browser e il commento pesa il
doppio; e la chiusura `dove` ricreata per particella per fotogramma, che oggi e'
codice inerte ma il task 6 la esercitera' fino a 1800 particelle a 60 fps.

Task 2: complete (commit 26e111a..b5166fc, revisione pulita)

**Ruling (scelta del modello)**: il task 3 va su sonnet e non sul livello piu'
economico, che la skill suggerirebbe per un task il cui brief contiene il codice
completo. Motivo: due task su due hanno prodotto un rilievo vero che veniva dal
**giudizio** dell'implementatore e non dalla trascrizione (la cancellazione
algebrica, e la normalizzazione sulla fisica dell'onda), e in entrambi i casi era
la cosa che valeva il task. Costo se sbagliato: qualche gettone in piu' per task.

### Task 3: riportato DONE, commit e11650d (245 test, 241 base piu' 4)

Firma di `valoreCorrente` verificata: coincide con quella assunta dal brief,
nessun adattamento.

Dubbio, gestito bene da lui: lo snippet del difetto da rimettere che il brief
forniva era troppo rozzo (ignora istante, dissolvenza e nodata, quindi rompeva
tre test invece di uno). Ha scritto una versione **fedele** del difetto
concettuale, con lo stesso percorso interno, e ha verificato che isoli
esattamente e solo il test dell'ordine. E' piu' di quanto il brief chiedeva, ed e'
la risposta giusta: il difetto illustrativo del piano era mio e valeva meno del
suo.

Terzo caso in cui un implementatore migliora una prova che il piano aveva
specificato male. Comincia a essere un dato sul piano, non sui subagenti.

Revisione task 3: dispacciata su sonnet, con la richiesta esplicita di guardare
con sospetto la prova del rosso, perche' e' l'unica cosa che distingue un test
vero da un test vacuo e in questo piano e' gia' mancata due volte.
Revisione task 3: **conforme e approvato**, nessun critico ne' importante. Ha
ricalcolato a mano tutti e quattro i casi contro lo snippet del brief e contro la
versione fedele, e i numeri tornano (con lo snippet del brief: 0,3 invece di 0 sul
test dell'ordine, 0 invece di 0,3 su quello dei tre quarti, 32,77 invece di null
su nodata). Ha anche spiegato **perche'** tre test su quattro restano verdi con
il difetto vero: in quelli una sola componente e' non nulla, e il modulo di un
vettore con una componente a zero coincide col valore assoluto dell'altra, quindi
l'ordine non conta se non c'e' cambio di segno. Solo il test dell'inversione ha
un cambio di segno, e fallisce da solo.

Minori differiti (task 3): nessun test su `valoreVettore` con `dissolvenza =
false` (rischio basso, inoltra il flag senza logica propria e il ramo e' provato
su `valoreCorrente`); e `inquadra` ricalcolata due volte, una per componente
(costo trascurabile, e l'alternativa duplicherebbe la logica di fusione oraria).

Task 3: complete (commit b5166fc..e11650d, revisione pulita)

**Ruling (modello del task 4)**: opus, non sonnet. Motivo: e' l'unico task senza
rete di test unitari (lo shader non si prova senza browser), tocca quattro unita'
di texture, il legame degli uniform e l'ordine del modulo, e un errore la' e'
invisibile fino agli end to end. La skill vuole il modello piu' capace per i task
di progetto, e questo lo e'. Costo se sbagliato: gettoni.

### Task 4: riportato DONE_WITH_CONCERNS, commit e9cc53d

End to end 38/38 alla partenza **e** all'arrivo: l'intermittente e' passato in
entrambi i giri, quindi la sua base era 38. Unita' di texture 5 e 6, **accodate**,
nessuna delle cinque esistenti spostata, cosi' un errore la' non poteva
travestirsi da costa e palette scambiate. Ha dovuto aggiornare il doppio in
`test/animazione.test.ts`, che implementava la firma vecchia.

**Rilievo 1: il piano sbaglia sui chiamanti, ed e' colpa mia.** Verificato:
`LivelloCampo.imposta` ha **un solo** chiamante di produzione,
`animazione.ts:282`. In `MapView.tsx` l'unica `imposta(` e' a riga 355 e appartiene
a `LivelloParticelle`; le righe 304-308, che avevo letto come "il campo", leggono
i fotogrammi per le **isolinee**. Il piano dice "i due chiamanti" nel task 4 e
"MapView.tsx riga 304 e seguenti" nel task 5: sbagliato in entrambi.

**Ruling (correzione per il task 5)**: in `MapView` cio' che diventa una lista e'
`prefetcherRef`, che serve a tre cose diverse: `aggiornaIsolinee` (usa il **primo**
campo, e comunque le isolinee esistono solo per l'altezza d'onda), `aggiornaValore`
(primo campo, o primo e secondo dal task 6) e il passaggio ad `Animazione`, che e'
l'unica a impostare il campo. Costo se sbagliato: il typecheck lo prende.

**Rilievo 2: `u_haB` e' uno solo per due componenti.** Analizzato, ed e' un buco
vero anche se stretto. Se un chiamante passasse la prima componente con l'ora t+1
e la seconda senza (due cache indipendenti, cosa facile), `haB` resterebbe vero
perche' viene dalla prima, e la texture B della seconda conserverebbe un
fotogramma **vecchio**. Con frazione 0 la fusione non lo usa, `mix(va2, vb2, 0)`
da' `va2`, **ma** il ramo per pixel `if (pesoA2 <= 0) c2 = vb2` lo usa: dove la
seconda componente non ha dato all'ora t e la texture vecchia ne aveva, esce un
modulo costruito su due istanti diversi. Valori plausibili, ai bordi del dato.

**Ruling (correzione per il task 5)**: se **una qualunque** componente non ha il
fotogramma dell'ora dopo, il chiamante passa `b: null` a **tutte**, non solo
frazione 0. Cosi' `haB` e' falso e nessuna texture B viene letta. Il piano dice
`componenti.every((c) => c.b) ? q.frazione : 0`, che azzera la frazione e lascia
`haB` vero: **non basta**, e va sostituito. Motivo: una riga nel chiamante invece
di un guardiano nello shader, e nessuna scelta fra spegnere in silenzio e
sollevare dentro il ciclo di disegno (l'implementatore ha fatto bene a non
decidere da solo). Costo se sbagliato: torna il buco stretto di sopra, ai bordi
del dato.

Terzo rilievo, minore: il commento del brief rimandava a un test in `App.tsx` che
non esiste ancora; l'ha girato in un rimando al task che accende la corrente.
Corretto.
Revisione task 4: **conforme e approvato**, nessun critico ne' importante. Ha
letto il GLSL riga per riga e verificato l'ordine in **tutti** i rami, compresi
quelli di ripiego per pixel; ha verificato che le sette unita' di texture non ne
riusino nessuna (0..6, elencate); ha chiuso il rischio "texture legata e mai
popolata" con una prova invece di un ragionamento (`e2e/resa.spec.ts` legge i
pixel del canvas, quindi un `drawArrays` scartato farebbe cadere un test); e ha
verificato lui stesso l'assenza di trattini lunghi con python, perche' il report
ammetteva di aver scritto bypassando l'hook.

**Il suo primo minore e' migliore del mio ruling, e lo sostituisco.** Io avevo
deciso di imporre l'invariante nel **chiamante** (task 5: se una componente non
ha l'ora dopo, `b: null` a tutte). Lui fa notare che il **livello** ha in mano
tutto per renderla impossibile, con una riga:

    this.haB = primo.b !== null && (!secondo || secondo.b !== null);

Costa nulla sul percorso a una componente e trasforma un errore silenzioso in un
fotogramma non interpolato. E aggiunge un fatto che non avevo: se `texB2` non e'
**mai** stata popolata, `texelFetch` legge **zeri**, e zero **non e'** `NODATA`,
quindi `pesoB2 > 0` e nessun guardiano puo' scattare, nemmeno quello il cui
commento promette trasparenza. La protezione promessa esiste solo per una texture
popolata con nodata.

**Ruling (sostituisce il precedente)**: la riga va nel livello, nel task 5, che e'
il task che tocca i chiamanti. Motivo: rendere impossibile batte vietare, e il
fatto degli zeri mostra che il vietare qui non era nemmeno protetto. Costo se
sbagliato: una condizione in piu' su un percorso che oggi ha un chiamante solo.

Altri minori, portati al task 5 o al 6 secondo dove cadono:
- il ripiego per pixel puo' mescolare due istanti se i pesi delle due componenti
  divergono; per la corrente non capita perche' condividono la maschera nodata,
  ma il file non lo dice: una riga di commento (task 5);
- `ComponenteFrame` lascia esprimibile la coppia incoerente (dato presente,
  chiave nulla), e per questo il chiamante deve scrivere un ternario con tre
  righe di commento. Un'unione discriminata cancella entrambi (task 5, facoltativo);
- in modulo con l'ora dopo le `media()` diventano quattro, cioe' **100
  texelFetch per frammento** invece di 50: il numero che il task 6 incontrera',
  vale una riga (task 6);
- `imposta([])` non fa niente in silenzio, e a differenza delle voci oltre la
  seconda questo caso non e' documentato (task 5);
- **nota che vale un ruling**: `App.tsx:297` passa gia' **tre scale distinte** al
  livello delle particelle, quindi l'assunto "una sola scala" dello shader e'
  proprio la scorciatoia che il chiamante della corrente sarebbe tentato di
  violare, e **oggi non esiste nessun controllo** che le scale coincidano.

**Ruling (task 5)**: il controllo delle scale non basta come test sulla fabbrica
dei test, che non protegge dal catalogo vero che cambia. Ci vuole un controllo a
runtime dove la lista dei campi si costruisce: se le scale delle componenti non
coincidono, la grandezza non si disegna. Motivo: e' l'unico punto che vede il
catalogo vero. Costo se sbagliato: un campo che sparisce invece di disegnarsi
sbagliato, che e' il verso giusto in cui sbagliare.

Task 4: complete (commit e11650d..e9cc53d, revisione pulita)

## Interruzione: il portatile si sposta (2026-08-21)

Messo al sicuro prima di fermarsi:
- registro copiato in `docs/superpowers/revisioni/2026-08-21-corrente-esecuzione.md`
  e committato (14dc92b), perche' `.superpowers/` e' escluso da git ed e' la
  mappa di recupero. Regola di CLAUDE.md.
- `worktree-feat-corrente` spinto su origin (nuovo branch): i cinque commit dei
  task piu' il registro.
- `develop` spinto su origin (f99e3f6): spec e piano.
- `main` **non toccato**: nessun deploy.

**Stato al momento dell'interruzione**: task 1-4 completi con revisione pulita.
Task 5 dispacciato e in corso da 13 minuti, con 8 file modificati **non
committati** nel worktree; su decisione dell'utente lo lascio andare invece di
aspettarlo. Se il worktree sopravvive, i file sono la'; se sparisce, il task 5 si
rifa' dal suo brief e dai quattro ruling che il suo dispaccio conteneva (sono
tutti qui sopra: la correzione sull'unico chiamante, la riga di `haB`, il
controllo delle scale a runtime, i due commenti).

**Per ripartire**: leggere questo registro dall'inizio, poi
`git log --oneline origin/main..worktree-feat-corrente`, poi il piano
`docs/superpowers/plans/2026-08-21-corrente.md` dal task 5.

### Task 5: arrivato in tempo, DONE, commit 33e7e71 (252 test, 38/38 end to end)

Otto file, corrente ancora `disegnabile: false`, niente cambia a schermo. Ha fatto
i due test del brief piu' due sul percorso a due campi di `Animazione.disegna()`,
verificati rossi contro il difetto iniettato e verdi dopo, ripristinando con `cp`.

**Quarto difetto del piano trovato da un implementatore.** Lo snippet del brief
metteva `grandezza` (l'oggetto intero) fra le dipendenze del `useMemo` che
costruisce i prefetcher. Ma `grandezza` si ricava da un array ricalcolato a ogni
render, quindi cambia identita' continuamente: durante la riproduzione avrebbe
ricostruito un `Prefetcher` **fino a dieci volte al secondo**, per qualunque
grandezza, buttando via la cache in volo. Ha cambiato la dipendenza in
`grandezza?.campi.join()`. Corretto: e' il valore che conta davvero, e due
grandezze diverse non possono avere la stessa lista di campi.

**Ruling (per il task 6, e non e' un dettaglio)**: la prontezza dei fotogrammi
(`assicuraFinestra`, `avanza`, `chiediAvanti`) guarda ancora **solo il primo
campo**. L'implementatore lo chiama innocuo oggi, e lo e' finche' la corrente e'
spenta, ma al task 6 e' la differenza fra "la corrente si disegna" e "la corrente
non si disegna mai": e' `assicura` che **chiede** i fotogrammi, quindi se nessuno
lo chiede per `vbar`, quel campo non arriva in cache e il disegno si ferma sul
controllo "manca una componente". Va sciolto **esplicitamente** nel task 6, non
ereditato. Costo se sbagliato: un giro di correzione speso a cercare perche' lo
schermo resta vuoto.

Parte facoltativa (unione discriminata di `ComponenteFrame`) non fatta, motivata:
il beneficio non copriva il rischio. Accettato.

Revisione del task 5: **da dispacciare al ritorno**. Il lavoro e' committato e
spinto, quindi non c'e' fretta.
