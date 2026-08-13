# Ondata di correzioni dalla revisione finale, branch `feat/ingestore`

Stato: **DONE_WITH_CONCERNS**. Tutti e tredici i rilievi sono stati affrontati.
Due correzioni si discostano dalla lettera di quanto deciso (I3 e I1) e sono
segnalate qui sotto, insieme a tre limiti noti che restano.

Suite: da 105 a 127 test nella suite predefinita, tutti verdi, piu' i 4 dietro
il marcatore `rete`, che non sono stati eseguiti (scaricano 23 MB per test).
`uv run ruff check .` pulito. Nessun avviso silenziato.

Metodo: un rilievo alla volta, con la causa riprodotta prima di scrivere
qualsiasi cosa, il test rosso eseguito e catturato, la correzione minima, la
suite intera, e un commit per rilievo.

---

## I6. Nessuno esegue la suite di test

**Fatto per primo, come richiesto.** Aggiunto `.github/workflows/ci.yml`: su
`push` e `pull_request` esegue `uv sync`, `uv run ruff check .` e
`uv run pytest`. I test di rete restano esclusi da `addopts` in
`pyproject.toml`, quindi la CI non dipende dalla disponibilita' di ARPAE.

Non c'e' un test: e' un file di configurazione della piattaforma, e non ha
senso verificarlo in locale. La sua correttezza si vede al primo push.

Commit: `9d600dc`.

---

## C1. Livello del mare: 5 frame su 6 si sovrascrivono

**Causa confermata.** `frame_key` formattava `%Y-%m-%dT%H` mentre
`sampling_for("qck_sl", "an")` vale `"full"`.

**Test scritto per primo** (`tests/test_frames.py::test_ogni_istante_sotto_l_ora_ha_una_chiave_propria`),
con una fixture nuova `write_sealevel_file` a passo di 10 minuti. Rosso contro
il codice esistente:

```
>       assert len(set(percorsi)) == 6
E       AssertionError: assert 1 == 6
E        +  where 1 = len({'frames/sealevel/an/20260813/2026-08-12T01.bin'})

>       == 'frames/hwave/an/20260813/2026-08-12T0100.bin'
E       AssertionError: assert 'frames/hwave...-08-12T01.bin' == 'frames/hwave...8-12T0100.bin'
```

Il test non conta solo le chiavi distinte: rilegge l'istante dal percorso e lo
confronta con il `valid_time` del record, cosi' fallisce anche una chiave
distinta ma che mente sull'orario (per esempio un contatore progressivo).

**Correzione.** `%Y-%m-%dT%H%M` per tutte le variabili, una convenzione senza
rami. Aggiornate le sezioni 4.2 e 4.7 della spec, da cui il difetto nasceva: la
4.2 ora dice esplicitamente perche' i minuti valgono per tutte le variabili, e
la 4.7 ha un paragrafo "Conseguenza sul layout" che lega la piena risoluzione
alla forma della chiave. Aggiornato anche l'esempio di manifest in 4.5.

Dopo: `9 passed` in `test_frames.py`, `106 passed` sulla suite.

Commit: `2f21125`.

---

## C2. I tre gruppi di profili si sovrascrivono a vicenda

**Causa confermata.** `column_key(station_id, date)` senza segmento di gruppo,
e `_pubblica_profili` chiamata una volta per gruppo.

**Test scritto per primo**
(`tests/test_reconcile.py::test_i_gruppi_di_profilo_non_si_sovrascrivono`), che
fa passare i tre gruppi attraverso `process_file` con file sintetici. Rosso:

```
>       assert len(chiavi) == 3, f"i tre gruppi si sono sovrascritti: {chiavi}"
E       AssertionError: i tre gruppi si sono sovrascritti: ['stations/boa-prova/columns/2026-08-13.bin']
E       assert 1 == 3

>           profiles.column_key("boa-nausicaa-2", "his_temp", "20260813")
E       TypeError: column_key() takes 2 positional arguments but 3 were given
```

**Correzione.** `stations/{id}/columns/{gruppo}/{YYYY-MM-DD}.bin`, e un
`ColumnRecord` nel `RunManifest` del gruppo con `station_id`, `path`, `group`,
`variables`, `shape`, `dims`, `dtype`, `scale`, `sha256`.

Il test non si ferma alla presenza dei record: rilegge ogni oggetto colonna dal
bucket, lo rimodella con la forma dichiarata e verifica che le variabili siano
nell'ordine dichiarato. Per renderlo possibile ho modificato
`write_profile_file` in modo che ogni variabile parta da un centinaio diverso:
prima due variabili dello stesso file avevano contenuto identico e uno scambio
del loro ordine sarebbe stato invisibile.

Aggiornata la spec 4.6 (segmento di gruppo obbligatorio, registrazione nel
manifest), la riga di layout in 4.2, l'esempio in 4.5 e la tabella delle
decisioni chiuse in `STATO.md`.

Dopo: `107 passed`.

Commit: `41a1b51`.

---

## C3. I frame di un run morto prima degli indici restano orfani

**Causa confermata.** `process_file` restituiva `None` sulla deduplica, quindi
un file gia' in archivio non contribuiva a `prodotti` e `rebuild_indices` non
lo vedeva mai piu'.

**Test scritto per primo**
(`tests/test_reconcile.py::test_gli_indici_si_riparano_dopo_un_run_morto_prima_della_fase_indici`).
Uccide `rebuild_indices` nel primo run, verifica lo stato lasciato sul bucket
(frame presenti, manifest presente, `index/` vuoto), poi riesegue pulito.
Rosso:

```
>       assert store.get_json("index/hwave/an/2026-08.json") == {"hours": atteso}
E       AssertionError: assert None == {'hours': {'2026-08-12T01:00:00Z': '20260813', '2026-08-12T02:00:00Z': '20260813'}}
```

Sul punto che questa correzione e' facile da scrivere in modo indistinguibile
da quella rotta, il test osserva quattro cose e non una:

1. il secondo run riporta ancora `processed == 0` e `skipped == 1`, cosi' una
   correzione che spaccia il file deduplicato per lavorato fallisce;
2. il contenuto dell'indice e' confrontato per intero con il valore atteso, non
   solo la presenza del file;
3. per ogni ora indicizzata si verifica che il frame corrispondente **esista
   davvero** sul bucket, ricostruendone la chiave: un indice rigenerato con voci
   inventate sarebbe peggio dell'assenza;
4. la premessa (indice vuoto dopo il primo run) e' asserita, quindi il test non
   puo' passare per un motivo diverso da quello che dice.

**Correzione.** `process_file` restituisce sempre un `EsitoFile(manifesto,
deduplicato)`; il manifest esistente viene ricostruito con
`RunManifest.from_dict`. Il contatore `skipped` e' guidato dal flag.

Ho rinominato `test_il_secondo_giro_non_scrive_nulla` in
`..._non_rilavora_nulla`: dopo questa correzione il secondo giro qualche
scrittura la fa (indici e catalogo riscritti identici), e il nome vecchio
sarebbe diventato falso.

Dopo: `108 passed`.

Commit: `2604ca0`.

---

## I1. L'ordine del listing ARPAE decide cosa viene perso al primo run

**Causa confermata.** Indice costruito pigramente dentro il ciclo, senza
seconda passata.

**Test scritti per primi.** Rossi:

```
>       assert store.list_keys("frames/ubar/"), "his_2dcur e' stato rimandato e mai ripreso"
E       AssertionError: his_2dcur e' stato rimandato e mai ripreso
E       assert []

>       assert "20260813" in scaricati[0]
E       AssertionError: assert '20260813' in '.../20260812_adriac_1km_his_HPDwave_an.nc.gz'
```

**Correzione.** `ordina_per_indice` mette per primo il file del gruppo di
riferimento **piu' recente** del piano. Aggiunto il contatore `deferred`, e il
test verifica che la somma dei quattro contatori sia uguale a `planned`.

**Scostamento dalla lettera.** Il rilievo chiedeva il contatore "perche' la
somma torni". Ho fatto anche uscire `1` quando `deferred > 0`, perche' il
rilievo stesso nota che "un run in questo stato puo' riportare successo e
uscire 0", e lasciare quel percorso sarebbe stato correggere meta' del difetto.
E' ritentabile nel senso giusto: basta che il run dopo trovi un file del gruppo
di riferimento.

Dopo: `111 passed`.

Commit: `9a220e1`.

---

## I2. `StationCollision` ferma il run ma si annuncia come ritentabile

**Causa confermata** revertendo solo la correzione e lasciando il test:

```
ingest/__main__.py:68: in main
    esito = reconcile(
E       ingest.stations.StationCollision: boa-prova generato sia da 'Prova' sia da 'Prova!'
```

Cioe' l'eccezione esce da `main` senza clausola: traceback e uscita 1.

**Correzione.** Clausola dedicata in `main`, uscita 2, docstring dei codici di
uscita generalizzata ("guasto che non si risolve da solo") e ramo 2 del
workflow riscritto perche' non parli piu' solo della griglia.

Dopo: `112 passed`.

Commit: `3d6f5ee`.

---

## I3. La meta' sulle unita' della guardia 6.1 non era implementata

**Causa confermata** eseguendo la pipeline su un file con `Hwave` in
centimetri:

```
units nel file: centimeter
frame prodotti: 8
hwave min/max: 0.0 0.15000000596046448 clipped: 0
record ha source_units? False
```

Otto frame scritti in silenzio, `clipped_count` zero, niente registrato.

**Test scritti per primi**, rossi con `AttributeError: module 'ingest.frames'
has no attribute 'UnitMismatch'` e mancanza di `source_units` nel record; poi,
al livello dell'orchestratore, l'eccezione veniva inghiottita dalla clausola
larga:

```
ERROR ingest.reconcile: errore su 20260813_adriac_1km_his_HPDwave_an.nc.gz
ingest.frames.UnitMismatch: Hwave: unita' attesa 'meter', trovata 'centimeter'...
FAILED tests/test_cli.py::test_il_cambio_di_unita_esce_con_due
FAILED tests/test_reconcile.py::test_un_cambio_di_unita_ferma_reconcile
```

**Scostamento dalla lettera, e il motivo.** Il rilievo diceva di confrontare
l'unita' letta con `FieldSpec.units`. **Non si puo': sarebbe stato un guasto
peggiore di quello che curava.** `FieldSpec.units` e' l'unita' dell'array
pubblicato (`m`, `s`, `1`, `m s-1`), non quella del NetCDF. Un confronto
diretto avrebbe sollevato `UnitMismatch` su ogni singolo run contro dati
perfettamente corretti, fermando l'ingestione per sempre.

Ho quindi aggiunto un campo distinto `FieldSpec.source_units`. E per non
riempirlo a indovinare (sbagliare quelle stringhe equivale a bloccare
l'ingestore) **ho letto le intestazioni reali dell'archivio ARPAE** con
richieste range da 400 KB, non scaricando i file interi:

| Variabile | `units` nel NetCDF |
|---|---|
| `Hwave` | `meter` |
| `Pwave_top` | `second` |
| `Dwave` | `degrees` |
| `ubar_eastward`, `vbar_northward` | `meter second-1` |
| `sea_level` | `meter` |

Le fixture sintetiche usavano gia' queste stesse stringhe, quindi coincidono
con la realta' verificata e non solo fra loro.

**Correzione.** `extract_frames` verifica le unita' di tutti i campi del gruppo
**prima** di scrivere qualsiasi cosa (un file storto non deve lasciare meta'
archivio nuovo e meta' vecchio), le registra in `FrameRecord.source_units`, e
solleva `UnitMismatch` su uno scarto o sull'assenza dell'attributo. `reconcile`
la rilancia insieme a `GridMismatch`; la CLI esce 2. Spec 6.1 aggiornata con la
distinzione fra `units` e `source_units`.

Dopo: `117 passed`.

Commit: `807c7a0`.

---

## I4. `grid.json` fragile

**Causa confermata**, entrambe le meta':

```
>       assert store.get_json(reconcile.GRID_KEY) == atteso
E       AssertionError: assert None == {'crs': 'EPSG:3857', 'x_min': ..., ...}

>       assert store.get_json("catalog.json") is None
E       AssertionError: assert {'schema_version': 1, ..., 'grid': {}, ...} is None
```

Il secondo e' letteralmente il catalogo con `'grid': {}` descritto nel rilievo.

**Correzione.** `_pubblica_griglia` viene chiamata anche sul ramo che rilegge
l'indice dalla cache, ed e' idempotente. `reconcile` valida il descrittore con
`grid.grid_dict_is_valid` e, se manca o e' monco, registra un errore e **non
scrive il catalogo**, lasciando in piedi quello precedente.

**Non fatto, e non era stato deciso.** Il rilievo segnala anche che `grid_ref`
e' cablato a `"grid.json"` e che la spec 4.4 promette descrittori versionati
(`grid_v2.json`) che il codice non puo' mantenere. La correzione decisa non
comprendeva i descrittori versionati e non li ho introdotti: **quella
divergenza fra spec 4.4 e codice resta aperta.**

Dopo: `119 passed`.

Commit: `611288c`.

---

## I5. L'anagrafica stazioni si ricostruisce da zero

**Causa confermata:**

```
>       assert finale == {"boa-ferma", "boa-attiva", "boa-nuova"}
E       AssertionError: assert {'boa-attiva', 'boa-nuova'} == {...}
E         Extra items in the right set: 'boa-ferma'
```

**Correzione.** `stations.merge_stations` fonde per identificativo:
le stazioni assenti dal flusso restano, quelle presenti si aggiornano.
`_aggiorna_anagrafica` registra comparse e sparizioni nel log. Aggiunta
`stations_from_dict`, usata anche da `_pubblica_profili` al posto della
costruzione a mano che c'era li'.

**Decisione presa dentro la correzione.** Le coordinate di una stazione gia'
nota non si aggiornano: e' la stessa regola gia' scritta in `_accumula` per un
singolo run, e spostarle a meta' archivio cambierebbe il significato delle
colonne gia' scritte. Un test lo fissa
(`test_la_fusione_non_sposta_una_stazione_gia_nota`). Conseguenza: una
rilocazione vera di una boa non verrebbe recepita, e servirebbe un intervento
a mano.

Dopo: `121 passed`.

Commit: `6dd38ca`.

---

## M1 + M2. Impronta senza forma, forme non validate

**Causa confermata** eseguendo il caso realistico:

```
byte identici: True
impronta a: 011b35774fc7f6cf
impronta b: 011b35774fc7f6cf
collidono: True
apply_index solleva: IndexError boolean index did not match indexed array along axis 0...
build_regrid_index solleva: IndexError boolean index did not match indexed array along axis 0...
```

Una precisazione sulla causa: la collisione si ottiene con un **rimodellamento**
(`reshape`), non con una trasposizione matematica, che invece cambia i byte in
ordine C. Il rilievo la chiama trasposizione; il difetto e' esattamente quello
descritto, il meccanismo e' il reshape. Il test lo documenta asserendo prima
l'uguaglianza dei byte, poi la differenza delle impronte.

**Correzione, un solo commit come richiesto.** La forma entra nell'impronta.
`build_regrid_index` e `apply_index` validano le forme e sollevano
`GridMismatch`, che per questo si sposta in `grid.py` e resta riesportata da
`reconcile` (un tipo diverso sarebbe finito nella clausola larga, cioe' uscita
1 invece di 2). Un test asserisce `grid.GridMismatch is reconcile.GridMismatch`,
perche' e' quell'identita' a reggere la differenza fra i due codici di uscita.

Ho scritto e poi **rimosso** un terzo test (impronta di lon e lat scambiate):
passava identico prima e dopo la correzione, quindi non osservava nulla.

Dopo: `125 passed`.

Commit: `b5b6ced`.

---

## M3. Nessuna asserzione posizionale nella suite predefinita

Il test esistente asseriva `np.count_nonzero(fuori == 42.0) >= 1`, cioe' che il
valore compaia da qualche parte.

**Il nuovo test ha teeth, e l'ho dimostrato invece di dichiararlo.** Non c'era
un bug da riprodurre (il rilievo e' un test mancante), quindi ho iniettato il
guasto che deve intercettare, invertendo la corrispondenza dentro `apply_index`:

```
E           AssertionError: il pixel sopra la cella (0,0) porta 15.0 invece di 0.0
FAILED tests/test_grid.py::test_ogni_cella_di_mare_finisce_sul_pixel_che_le_sta_sopra
1 failed, 1 passed
```

`1 passed` e' il test vecchio: **con la corrispondenza invertita continuava a
passare.** Il guasto iniettato e' stato rimosso subito dopo (verificato: nessuna
occorrenza del marcatore resta nel sorgente).

Il test calcola la posizione attesa per conto proprio dai centri dei pixel,
senza passare da `idx.indices`, usa un campo in cui ogni cella ha un valore
diverso, copre tutte le celle di mare e asserisce quante ne ha verificate, cosi'
una maschera vuota non lo renderebbe vacuo.

Dopo: `126 passed`.

Commit: `6029851`.

---

## I7. `STATO.md` dice che il codice non esiste

Aggiornati intestazione e sezione 2 (che dicevano "nessun codice esiste
ancora"), piu' due sezioni ferme allo stesso momento e altrettanto false: la 4a
(diceva che `origin/develop` non esiste, mentre esiste) e la 7 (stato git di due
commit fa). Aggiornati i conteggi dei test e i puntatori di ripartenza.
L'intestazione della spec, che diceva "da tradurre in piano di implementazione",
ora distingue la parte sull'ingestore (implementata) da quella sulla SPA.

Ho segnalato in `STATO.md` che i frammenti di codice dentro il piano sono
anteriori a questa ondata e non vanno ricopiati alla lettera.

Commit: `a073302`, piu' `6653bde`: la prima stesura indicava come punto di
ripartenza un file dentro `.superpowers/`, che e' in `.gitignore` e quindi non
arriva a chi clona. Corretto: il punto di ripartenza e' la spec, versionata, e i
documenti locali sono segnalati per quello che sono.

---

## Aggiunta non prevista dai rilievi: `SCHEMA_VERSION` a 2

**Non e' un rilievo: e' una conseguenza delle mie stesse correzioni**, e la
segnalo come tale.

C2 ha aggiunto `columns` al manifest, I3 ha aggiunto `source_units` a ogni
frame, C1 ha cambiato le chiavi dei frame. `SCHEMA_VERSION` era rimasta a 1,
quindi due formati diversi avrebbero convissuto sotto lo stesso numero di
versione, e un manifest nel formato vecchio avrebbe fatto sollevare `KeyError`
a `RunManifest.from_dict` (contato come errore, ritentato per sempre: proprio
la classe di guasto che questa ondata ha corretto altrove).

Test rosso prima della modifica:

```
>       assert not manifest.already_ingested(vecchio, "abc123")
E       AssertionError: assert not True
```

Sull'archivio vuoto non cambia niente di osservabile. Aggiornato l'esempio in
spec 4.5.

Commit: `b0c49ac`.

---

## File modificati

Questo report vive in `.superpowers/`, che e' in `.gitignore`: **non e'
versionato** e non arriva a chi clona il repo.

```
.github/workflows/ci.yml                  (nuovo)
.github/workflows/ingest.yml
STATO.md
docs/superpowers/specs/2026-08-13-stato-del-mare-design.md
ingest/__main__.py
ingest/config.py
ingest/frames.py
ingest/grid.py
ingest/manifest.py
ingest/profiles.py
ingest/reconcile.py
ingest/stations.py
tests/conftest.py
tests/test_catalog.py
tests/test_cli.py
tests/test_frames.py
tests/test_grid.py
tests/test_manifest.py
tests/test_profiles.py
tests/test_reconcile.py
tests/test_stations.py
```

---

## Cosa non ho fatto, e cosa resta aperto

**1. I 4 test dietro il marcatore `rete` non sono stati eseguiti** (istruzione
esplicita: scaricano 23 MB per test). Li ho letti: usano `extract_frames`,
`build_regrid_index` e `apply_index`, tutti toccati da questa ondata, ma non
usano `frame_key` ne' `column_key`, quindi C1 e C2 non li riguardano. L'unica
dipendenza nuova e' la guardia sulle unita', ed e' proprio quella che ho
verificato contro le intestazioni reali dell'archivio. **Restano comunque non
eseguiti: questa e' un'inferenza, non una misura.**

**2. Descrittori di griglia versionati (spec 4.4).** Il rilievo I4 nota che il
codice non puo' mantenere la promessa di `grid_v2.json`. La correzione decisa
non lo comprendeva e non l'ho introdotto. La divergenza fra spec e codice resta.

**3. `--only` su una variabile fuori dal gruppo di riferimento non puo'
funzionare.** `ensure_index` viene chiamata solo dentro il ramo del gruppo di
riferimento, quindi `--only sealevel` o `--only ubar` rimandano tutto, anche su
un bucket caldo dove l'indice esiste gia'. **E' un difetto preesistente**, non
introdotto qui: prima rimandava in silenzio e usciva 0, adesso lo dichiara con
`deferred` e esce 1. Non l'ho corretto perche' non e' fra i rilievi, ma un umano
che prova `--only ubar` come primo comando lo incontrera'.

**4. Doppio scaricamento del file di riferimento.** Il ramo che costruisce
l'indice scarica il file, e `process_file` lo riscarica subito dopo: circa 23 MB
in piu' per run. Il rilievo I1 lasciava intendere che ordinare dal piu' recente
ritirasse questo minore differito; **ritira lo spreco di riscaricare ogni volta
il file piu' vecchio, che a regime nessun altro passo richiede, ma il doppio
scaricamento in se' resta.** Toglierlo vuol dire far accettare a `process_file`
un file gia' su disco, che non era fra le correzioni decise.

**5. Il piano (`docs/superpowers/plans/2026-08-13-ingestore.md`) non e' stato
aggiornato.** Contiene frammenti di test con le vecchie chiavi
(`2026-08-12T01.bin`) e la vecchia firma di `column_key`. Le correzioni decise
nominavano le sezioni della spec, non il piano, che e' un documento storico di
esecuzione. Ho aggiunto un avviso in `STATO.md`. Chi lo rieseguisse alla lettera
reintrodurrebbe C1 e C2.

---

## Revisione del proprio lavoro

Ho riletto il diff completo. Rilievi su me stesso:

- **Nessun import dentro una funzione**, verificato per lettura oltre che con
  ruff (`grep` su righe di import indentate: nessun risultato).
- **Nessun avviso e' stato silenziato.** Il solo `DeprecationWarning` incontrato
  (netCDF4 1.7.4 su NumPy 2.5) e' quello gia' esentato in `pyproject.toml`, e
  arriva dalla scrittura delle fixture, non dal codice nuovo.
- **`EsitoFile.manifesto` usa un'annotazione fra virgolette** dove non
  servirebbe. Innocuo, l'ho lasciato per non aggiungere un commit di solo
  rumore.
- **`ColumnRecord.to_dict` emette `dims` e `dtype` che `from_dict` ignora.**
  Deliberato: servono a chi legge l'archivio fra anni, non al giro di
  serializzazione. L'asimmetria e' voluta, non una dimenticanza.
- **`reconcile` chiama `rebuild_indices` su tutti i manifest a ogni run**, anche
  quelli deduplicati: e' esattamente cio' che C3 richiede, e il costo (una PUT
  per file di indice toccato) e' quello che il rilievo aveva previsto.
- **Fedelta' di trascrizione rispettata**: nessuna normalizzazione degli accenti
  nei file esistenti, come deciso in fondo al documento dei rilievi. I file
  Python usano la forma ASCII (`e'`, `piu'`), i documenti Markdown mantengono la
  convenzione che avevano gia'.

## Preoccupazioni su correzioni comunque eseguite

Una sola, ed e' su I5. La fusione dell'anagrafica **conserva le coordinate
esistenti**, quindi se ARPAE spostasse davvero una boa il sistema continuerebbe
a usare la posizione vecchia e nessun log lo direbbe. E' la scelta coerente con
la regola gia' scritta nel modulo, e per un archivio permanente conservare la
posizione con cui le colonne storiche sono state estratte e' probabilmente
giusto. Ma e' una decisione presa dentro una correzione che non la nominava, e
il caso "boa realmente spostata" oggi si risolve solo a mano.
