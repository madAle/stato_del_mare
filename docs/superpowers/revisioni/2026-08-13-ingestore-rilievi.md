# Rilievi della revisione finale, branch `feat/ingestore`

Verdetto: **non pronto al merge.** Tre difetti critici distruggono o etichettano male dati
archiviati, tutti su percorsi che nessun test tocca. Due nascono dalla spec, non
dall'implementazione: vanno corretti anche a monte o torneranno.

L'archivio e' vuoto (nessun deploy e' mai avvenuto), quindi nessuna correzione qui
richiede migrazione dei dati.

---

## C1. Livello del mare: 5 frame su 6 si sovrascrivono, e i superstiti mentono sull'orario

**Dove:** `ingest/frames.py` (`frame_key`) e `ingest/config.py` (regola di campionamento)

`frame_key` formatta l'istante valido come `%Y-%m-%dT%H`. Ma `sampling_for("qck_sl", "an")`
vale `"full"`, quindi vengono estratti tutti e 144 gli step da 10 minuti, che collassano
su 24 chiavi. Verificato eseguendo:

```
campionamento qck_sl/an : full
istanti distinti        : 6   (01:00 ... 01:50)
chiavi distinte         : 1   {'frames/sealevel/an/20260813/2026-08-12T01.bin'}
```

Non e' solo perdita di dati. **Vince l'ultima scrittura dell'ora**, quindi l'oggetto in
`...T01.bin` contiene il campo delle **01:50**, mentre `index/sealevel/an/2026-08.json`
(che indicizza al secondo) lo annuncia alle 01:00, 01:10, 01:20, 01:30, 01:40 e 01:50.
Un client che chiede le 01:00 riceve le 01:50 e non ha modo di accorgersene. E' la stessa
classe di danno di `GridMismatch`, frame plausibili con i valori nel posto sbagliato,
spostati nel tempo invece che nello spazio. Il manifest registra 144 `FrameRecord` i cui
`min`, `max` e `sha256` descrivono oggetti che a quei percorsi non esistono piu'.

La sezione 4.7 della spec spende quattro paragrafi a giustificare il costo della piena
risoluzione a 10 minuti sul ramo di analisi, e il modello di percorso della 4.2 la butta
via in silenzio. **La spec e' internamente contraddittoria e l'implementazione ha
riprodotto fedelmente la contraddizione.**

**Correzione decisa:** minuti nella chiave, `%Y-%m-%dT%H%M`, **per tutte le variabili**,
non un caso speciale per una sola. Una convenzione, nessun ramo. Aggiornare insieme la
spec 4.2 e la 4.7.

Nessun test copre questo: non esiste alcun test che faccia passare `qck_sl` attraverso
`extract_frames`. `tests/test_config.py` asserisce `sampling_for("qck_sl","an") == "full"`,
cioe' nomina la proprieta' ("piena risoluzione in analisi") e non puo' fallire per il bug
che la distrugge.

---

## C2. I tre gruppi di profili si sovrascrivono a vicenda: 3 variabili su 4 perse, la superstite indecifrabile

**Dove:** `ingest/reconcile.py` (`_pubblica_profili`) e `ingest/profiles.py` (`column_key`)

`column_key(station_id, date)` non ha un segmento per il gruppo, e `_pubblica_profili`
viene chiamata una volta per gruppo di profilo. Verificato:

```
his_temp   ('temp',)                     -> stations/boa-nausicaa-2/columns/2026-08-13.bin
his_salt   ('salt',)                     -> stations/boa-nausicaa-2/columns/2026-08-13.bin
his_cur    ('u_eastward','v_northward')  -> stations/boa-nausicaa-2/columns/2026-08-13.bin
```

Tre scritture, tre forme diverse: `(24,1,30)`, `(24,1,30)`, `(24,2,30)`. Una sola chiave.
Nell'ordine di listing ARPAE (`his_cur` < `his_salt` < `his_temp`) sopravvive la
temperatura. Salinita' e le due componenti di corrente vengono scaricate, cioe' 1,19 GB al
giorno, la voce piu' grande del bilancio di banda, e poi buttate.

Aggravanti: `put_frame` marca `Cache-Control: immutable` su un oggetto riscritto tre volte
nello stesso run, e **niente registra da nessuna parte la forma del file, l'ordine delle
variabili o `PROFILE_SCALE`**. Le colonne non compaiono in nessun manifest, indice o
catalogo. `PROFILE_SCALE = 0.01` vive solo dentro `profiles.py`. E' una violazione diretta
del principio 3.5: senza il codice che l'ha scritto, quel file e' un blob di int16
indistinto.

**Correzione decisa:** `stations/{id}/columns/{gruppo}/{YYYY-MM-DD}.bin`, e registrare gli
oggetti colonna nel `RunManifest` del gruppo con percorso, forma, ordine delle variabili e
scala. Il contratto d'archivio e' l'intero senso del modulo.

Nessun test esercita `_pubblica_profili`. Una ricerca su `tests/` non trova nessuna
occorrenza di `his_temp`, `his_salt` o `his_cur`.

---

## C3. I frame di un run morto prima degli indici restano orfani per sempre

**Dove:** `ingest/reconcile.py`, in fondo a `reconcile()`

`prodotti` raccoglie solo i manifest **appena lavorati**. Un file saltato dalla deduplica
non contribuisce, e `rebuild_indices` viene chiamata solo con `prodotti`. Quindi se un run
scrive frame e manifest e poi muore prima della fase indici (timeout del runner, sfratto,
un'eccezione dentro `rebuild_indices` o `list_keys`), quei frame sono sul bucket,
registrati in un manifest, e assenti da `index/` **per sempre**. Ogni run successivo vede
il manifest, salta il file, e non scrive mai la voce di indice. Il client non sapra' mai
che quei frame esistono.

Verificato uccidendo `rebuild_indices` nel primo run e poi rieseguendo pulito:

```
run 1: frame scritti OK   manifest scritto OK   index/ vuoto
run 2: {'planned': 1, 'processed': 0, 'skipped': 1, 'errors': 0}
       index/ ancora vuoto  -> non si autoripara
```

Contraddice direttamente il principio 3.3. E non e' ipotetico: `timeout-minutes: 90`
contro un avvio che deve ingerire 8 giorni per 1,9 GB rende **quasi certo che il primo
deploy venga ucciso a meta' run, ripetutamente**.

L'ordine di scrittura in se' e' corretto e non promette mai troppo: un browser che legge a
meta' run puo' solo vedere meno, mai un catalogo che punta a frame mancanti. Il difetto e'
nella direzione opposta, ed e' irreversibile invece che temporaneo.

**Correzione decisa (economica):** `process_file` restituisce il manifest **esistente**
quando deduplica, invece di `None`, cosi' entra in `prodotti`. `merge_index` e'
idempotente, quindi rimetterlo costa una PUT per file di indice toccato. Il contatore
`skipped` va guidato da un flag separato.

---

## I1. L'ordine del listing ARPAE decide cosa viene perso al primo run

**Dove:** `ingest/reconcile.py`, avvio dell'indice dentro il ciclo

L'indice si costruisce pigramente, dentro il ciclo, solo quando
`w.source.group == GRUPPO_DI_RIFERIMENTO`. Tutto cio' che il ciclo incontra prima registra
"indice non ancora disponibile, rimando" e passa oltre, **senza nessuna seconda passata**.
Apache ordina per nome, e dopo `his_` il byte `'2'` precede `'H'`, quindi `his_2dcur`
arriva sempre prima di `his_HPDwave`. Verificato:

```
esito: {'planned': 4, 'processed': 1, 'skipped': 0, 'errors': 1}
rimandati: [his_2dcur_an, his_2dcur_fc]
manifest scritti: ['runs/2026-08-13/an/his_HPDwave.json']
```

Notare la contabilita': 4 pianificati, 1 lavorato, 0 saltati, 1 errore. **Due file
spariscono dal conteggio**, quindi un run in questo stato puo' riportare successo e uscire
0. "Rimando" e' una promessa che il codice non mantiene mai.

A regime e' innocuo. Morde esattamente dove fa piu' male: il primo run su bucket vuoto, e
il run di recupero dopo un'interruzione, quando la data piu' vecchia sta per uscire dalla
finestra di 8 giorni. Un giorno di `ubar`/`vbar` (192 frame) va perso per sempre, che e'
precisamente il fallimento per cui esiste il principio 3.1, al momento del deploy.

**Correzione decisa:** ordinare il piano perche' il gruppo di riferimento sia lavorato per
primo, costruendo l'indice dal file `his_HPDwave` **piu' recente** del piano. Farlo dal
piu' recente ritira anche il minore differito sul doppio scaricamento, che oggi riscarica
il piu' vecchio a ogni run. Aggiungere un contatore `deferred` perche' la somma torni.

---

## I2. `StationCollision` ferma il run ma si annuncia come ritentabile

**Dove:** `ingest/__main__.py`

`_aggiorna_anagrafica` la rilancia correttamente ed e' sollevata fuori dal `try` per file,
quindi esce davvero. Ma `main` non la cattura: Python stampa un traceback ed esce **1**,
che la docstring del modulo definisce "ritentabile, il run successivo recupera" e che il
workflow rende come `::warning:: ... Ritentabile`. Una collisione di nomi nel flusso ARPAE
non si risolve da sola: il cron ritentera' due volte al giorno per sempre mentre la
notifica dice che guarira'.

**Correzione decisa:** catturarla in `main` e uscire con 2, aggiungere il ramo nel workflow
e un test in `test_cli.py`.

---

## I3. La meta' sulle unita' della guardia 6.1 non e' mai stata implementata

**Dove:** spec 6.1 contro `ingest/manifest.py` e `ingest/frames.py`

La spec dice: "Stesso trattamento per un cambio di unita' o di nome variabile, che il
manifest registra dal NetCDF e confronta con l'atteso." `RunManifest` non registra nessun
attributo NetCDF, e `units` in `FieldSpec` e' un'etichetta che il codice afferma, mai un
valore che legge e confronta.

Un rename di variabile emerge come `KeyError`, contato come errore, uscita 1, ritentato per
sempre. Un **cambio di unita'** (`Hwave` in centimetri, `Pwave_top` in millisecondi) e'
completamente silenzioso: i valori si quantizzano bene, `clipped_count` puo' restare zero,
e l'archivio si riempie di numeri plausibili e sbagliati. E' lo stesso modello di danno che
giustifica l'intero apparato di `GridMismatch`, applicato all'altra meta' della stessa
frase.

**Correzione decisa:** leggere `ds.variables[nc_name].units` in `extract_frames`,
confrontarlo con `FieldSpec.units`, registrarlo nel manifest e sollevare un'eccezione che
ferma il run in caso di scarto. Le fixture impostano gia' `units` su ogni variabile, quindi
e' testabile oggi.

---

## I4. `grid.json` fragile: il catalogo puo' uscire con `"grid": {}` invece di rifiutarsi

**Dove:** `ingest/reconcile.py`, in `ensure_index` e in fondo a `reconcile()`

`store.put_json(GRID_KEY, ...)` vive solo nel ramo di costruzione di `ensure_index`. Poi
`reconcile` fa `descrittore = store.get_json(GRID_KEY) or {}` e scrive il catalogo
comunque. Se `grid.json` manca (una `put_json` fallita dopo una `put_binary` riuscita, una
cancellazione accidentale, o semplicemente un run in cui nessun indice e' stato costruito e
niente e' riuscito) il catalogo viene pubblicato con un descrittore vuoto e **non si
autoripara mai**, perche' l'indice ormai e' in cache e il ramo di costruzione e'
irraggiungibile. Il client non puo' posizionare la texture e la pagina e' rotta con un
catalogo sintatticamente valido.

Collegato: ogni manifest cabla `grid_ref = "grid.json"`. La spec 4.4 promette descrittori
versionati ("un eventuale cambio di risoluzione produce `grid_v2.json`; i frame vecchi
restano leggibili perche' referenziano il proprio") e il codice non puo' mantenerlo:
rigenerare l'indice dopo un cambio di dominio sovrascrive `grid.json` sul posto e
ri-georeferenzia in silenzio ogni frame storico.

**Correzione decisa:** rifiutarsi di scrivere un catalogo senza un descrittore di griglia
valido (e' la stessa regola "fermarsi e' meglio che sbagliare"), e scrivere `grid.json` in
modo idempotente a ogni run.

---

## I5. L'anagrafica stazioni si ricostruisce da zero: una boa in manutenzione sparisce

**Dove:** `ingest/reconcile.py` (`_aggiorna_anagrafica`)

`realtime.jsonl` e' un'istantanea scorrevole. Una stazione in manutenzione ne esce, sparisce
dall'anagrafica, e `_pubblica_profili` smette di estrarne la colonna per tutto il tempo in
cui e' assente: dentro una finestra di 8 giorni quel dato e' perso per sempre. Non c'e'
nessuna riga di log per "una stazione che ieri c'era oggi non c'e' piu'". L'anagrafica e'
anche l'unico posto in cui e' scritto a chi appartiene un file colonna storico.

**Correzione decisa:** fondere con l'anagrafica gia' su bucket invece di sostituirla, e
registrare comparse e sparizioni nel log.

---

## I6. Nessuno esegue la suite di test

`.github/workflows/` contiene solo `ingest.yml`. 105 test, un insieme di regole ruff fissato
e un cancello sugli avvisi con tanto di controprova, e **nessun workflow li esegue** su push
o pull request. Ogni affermazione di qualita' di questo branch poggia su un umano che si
ricorda di lanciare `uv run pytest` in locale.

**Correzione decisa:** aggiungere un workflow di CI che esegua `uv run ruff check .` e
`uv run pytest`.

---

## I7. `STATO.md`, il file che il repo indica come primo da leggere, dice che il codice non esiste

Intestazione: "**Fase:** ... implementazione da iniziare (nessun codice esiste ancora)".
Sezione 2: "**Non esiste ancora codice.** Il repo contiene solo la spec."

La sezione 4c e' stata aggiornata, l'intestazione e la sezione 2 no. Dato che questo branch
ha una storia documentata di un documento falso che ha nascosto un difetto vero per dieci
task, un file da leggere per primo che si contraddice a due sezioni di distanza non deve
essere unito. Companion minore: l'intestazione della spec dice ancora "approvato in
brainstorming, da tradurre in piano di implementazione".

---

## Tre minori promossi a bloccanti

**M1 + M2 (da fare insieme, circa 6 righe e un test).** `coordinate_fingerprint` non include
la forma degli array, e `apply_index` / `build_regrid_index` non validano le forme. La
collisione realistica non e' "due domini con byte identici per caso": e' un dominio
**trasposto**, dove `(752,272)` diventa `(272,752)` con contenuto byte-identico, quindi
l'impronta coincide e la guardia tace. Non corrompe l'archivio (l'indicizzazione booleana
solleva `IndexError`), ma quell'errore viene catturato dalla clausola larga, contato come
ritentabile, e il run esce 1 "riprova domani" per sempre invece di 2 "serve un umano".

**M3.** Nessun test della suite predefinita asserisce che un pixel di mare interno finisca
sulla **cella sorgente giusta**: l'unica copertura e' in `test_coerenza.py`, dietro il
marcatore `rete`, che nessuna automazione esegue. Data la storia di questo branch, aggiungere
un'asserzione posizionale sulla geometria sintetica.

---

## Cosa NON va toccato

Gli altri 23 minori differiti restano differiti: il revisore li ha triati uno per uno e
nessuno e' portante.

Una decisione del controller viene rovesciata dal revisore, e la rovescio anch'io: la
promessa di una "passata di normalizzazione degli accenti alla fine". Si abbandona. La
fedelta' di trascrizione era l'argomento giusto durante l'esecuzione e resta giusto dopo:
una passata cosmetica su ogni file del branch produrrebbe un diff enorme e non revisionabile
sul sorgente di un archivio permanente, senza guadagno di comportamento, e romperebbe
`git blame` su tutto. Se si vogliono gli accenti, si mettono quando si tocca un file per
altri motivi.
