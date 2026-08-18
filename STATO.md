# Stato del lavoro

**Aggiornato:** 2026-08-18 · **Branch:** `develop` · **Fase:** ingestore in produzione, archivio popolato, SPA da iniziare

**L'ingestore gira.** Primo run reale il 2026-08-17: 72 file su 72, zero errori,
70 minuti, l'intera finestra ARPAE di otto giorni in archivio. Il cron delle 18
è passato da solo la sera stessa. Il bucket è leggibile da browser, verificato
per misura (vedi la tabella in 5).

**Il punto esatto in cui riprendere:** il **piano della SPA** (4c). Adesso si può
scrivere guardando dati veri invece che una specifica, che era la condizione
posta fin dall'inizio per non progettare il client contro un formato immaginato.

Questo file va letto per primo. Poi:

- [docs/superpowers/specs/2026-08-13-stato-del-mare-design.md](docs/superpowers/specs/2026-08-13-stato-del-mare-design.md), il design approvato: modello dati, formato del pacchetto, pipeline, architettura SPA, test. È la fonte di verità **su cosa costruire**, ed è allineato al codice per la parte sull'ingestore. Da leggere prima di scrivere codice nuovo, non per riprendere il lavoro in corso: per quello vale la riga qui sopra.
- [docs/superpowers/plans/2026-08-13-ingestore.md](docs/superpowers/plans/2026-08-13-ingestore.md), il piano eseguito: 15 task in TDD. Storico, non più da eseguire. Attenzione: i frammenti di codice al suo interno sono anteriori alle correzioni della revisione finale, quindi non vanno ricopiati alla lettera.
- `CLAUDE.md`, contesto stabile e divieti.

- [docs/superpowers/revisioni/](docs/superpowers/revisioni/), i documenti della
  revisione, portati dentro il repo il 2026-08-13 perché nascevano in
  `.superpowers/`, che è in `.gitignore` e quindi non arriva a chi clona:
  - `2026-08-13-ingestore-rilievi.md`, i rilievi della revisione finale (3
    critici, 7 importanti, 3 minori) con la riproduzione di ciascuno;
  - `2026-08-13-ingestore-correzioni.md`, cosa è stato corretto e come, con
    l'elenco di **ciò che resta aperto**;
  - `2026-08-13-ingestore-decisioni.md`, le **33 decisioni** prese durante
    l'esecuzione, ognuna col motivo e col costo se è sbagliata. Serve a non
    riaprirle da zero: se una va cambiata, si cambia sapendo cosa si sta
    scambiando.

## 1. Cos'è il progetto

Mappa interattiva dello stato del mare in Adriatico dai dati pubblici ARPAE, con timeline navigabile avanti e indietro e riproduzione automatica.

## 2. Dove sta il codice e cosa fa ogni pezzo

**L'ingestore esiste ed è completo.** La SPA non è ancora iniziata.

```
ingest/           ingestore Python, gira su GitHub Actions una volta al giorno
  config.py       elenco variabili, endpoint, parametri di griglia
  source.py       listing ARPAE, HEAD, download verificato
  grid.py         griglia Mercator, indice di ricampionamento, GridMismatch
  encode.py       quantizzazione int16, gzip, direzioni in sin/cos
  frames.py       campi 2D verso frame, guardie sulla sorgente (UnitMismatch,
                  VariableMissing); read_variable è l'unico punto da cui il
                  pacchetto legge una variabile del NetCDF
  profiles.py     colonne sigma sulle stazioni
  stations.py     parsing BUFR di realtime.jsonl, fusione dell'anagrafica
  storage.py      client R2 (boto3)
  manifest.py     manifest di run, record di frame e colonne, deduplica
  catalog.py      index/ e catalog.json
  reconcile.py    orchestratore
  __main__.py     CLI e codici di uscita
tests/            134 test nella suite predefinita, più 4 dietro il marcatore `rete`
.github/workflows/
  ci.yml          ruff e pytest su push e pull request
  ingest.yml      ingestione giornaliera, due cron
web/              ancora da scrivere
  src/data/       TS puro: fetch da R2, cache LRU, prefetch, scelta an/fc
  src/map/        TS puro: MapLibre, custom layer WebGL, ciclo rAF, shader
  src/ui/         React: scrubber, play/pausa, legenda, status bar
```

**Codici di uscita della CLI**, su cui il cron decide: `0` tutto bene, `1`
qualche file fallito o rimandato (ritentabile), `2` guasto che non si risolve
da solo e serve un umano (griglia cambiata, unità cambiate, variabile rinominata
o sparita, collisione fra stazioni), `3` configurazione incompleta.

**Il vincolo architetturale da non rompere:** `src/data/` e `src/map/` non devono conoscere React, e React non deve mai girare a 60 fps. Il ciclo di animazione vive in `src/map/` e riporta il tempo a React al massimo 10 volte al secondo. Se questo confine salta, il framework diventa insostituibile e l'autoplay singhiozza.

Secondo vincolo: **`src/data/` è l'unico modulo che conosce gli URL del bucket.** È il punto in cui, se un domani servisse un backend, si cambia una riga sola.

## 3. Cosa è chiuso e non va ridiscusso

| Decisione | Motivo |
|---|---|
| **Nessun backend applicativo** (niente Rails, niente DB, niente Render/Neon) | Dato di sola lettura, aggiornato a lotti una volta al giorno, query note in anticipo. Valutata e scartata esplicitamente dall'utente, che è esperto Rails. |
| SPA React + Vite + TypeScript che legge direttamente da object storage | Frame immutabili, grossi, richiesti a raffica: egress gratuito su Cloudflare R2 |
| Ingestore in Python su GitHub Actions | netCDF4 e scipy sono lì; la banda e il disco effimeri sono gratis su Actions |
| Frame in **int16 + gzip con `Content-Encoding: gzip`** | Il browser decomprime in modo trasparente: zero librerie di decompressione nel client |
| Si spediscono **numeri, non pixel colorati** | Abilita valore sotto il mouse, scala regolabile, frecce, mappe di differenza |
| Ricampionamento in **Web Mercator in ingestione** | Una trasformazione sola; il client disegna un rettangolo. La griglia sorgente è curvilinea. |
| Nearest-neighbour su **solo celle di mare** | Nessun valore attraversa la costa. Bilineare medierebbe mare e terra mascherata. |
| Direzioni memorizzate come **sin e cos**, mai come angolo | La media lineare di 359 e 1 grado è 180, cioè la direzione opposta |
| **Nessuna piramide di tile** | Il dominio intero sta in una texture sola |
| Analisi e previsione **entrambe conservate, tutte le scadenze** | Abilita l'analisi di skill per lead time |
| L'archivio **non sovrascrive mai**, solo aggiunge | La precedenza analisi-su-previsione è regola di visualizzazione, non di storage |
| Profili verticali **solo da file di analisi** | I profili da previsione costerebbero circa 2,8 GB al giorno di download |
| Livello del mare: **10 min in analisi, orario in previsione** | L'analisi è documento permanente, la previsione è superata entro 3 giorni |
| Basemap **OSM standard** + overlay OpenSeaMap attivabile | Zero setup, il seamark è nato per fondo chiaro. Sostituibile in un pomeriggio. |
| v1 mostra **solo l'altezza d'onda**, ma ingerisce tutto | ADRIAC cancella dopo 8 giorni: un layer non ingerito è perso per sempre, uno non mostrato si aggiunge in mezza giornata |
| Interpolazione temporale continua fra ore adiacenti | Il senso dell'app è l'andamento nel tempo |
| Finestra iniziale scrubber: 48 h passate + 72 h previste | |
| Avvisi guasti: **solo mail di GitHub Actions** | Scelta dell'utente, niente `health.json` né banner in pagina |
| Distanza massima di ricampionamento: **800 m** (non 1,5 km come nella prima stesura della spec) | Le celle sorgente distano 1 km fra loro: 707 m (la semidiagonale) copre ogni punto interno a una cella di mare; 800 m limita lo sbordamento sulla terraferma a meno di una cella sorgente |
| Manifest **per gruppo di file**, non per run: `runs/{data}/{kind}/{gruppo}.json` | In un giorno si lavorano più file sorgente diversi per tipo; con un manifest unico, un gruppo riuscito e uno fallito nello stesso giorno non potrebbero registrare il progresso parziale separatamente |
| Profili stazioni **giornalieri e per gruppo sorgente**: `stations/{id}/columns/{gruppo}/{YYYY-MM-DD}.bin` (non mensili) | L'object storage non supporta l'append, quindi un file mensile andrebbe riscritto ogni giorno perdendo l'immutabilità. Giornaliero costa circa 5,8 KB al giorno per stazione. Il segmento di gruppo evita che `his_temp`, `his_salt` e `his_cur` si sovrascrivano a vicenda |
| Le colonne si **registrano nel manifest del gruppo** (percorso, stazione, variabili, forma, assi, scala, sha256) | Non compaiono in nessun indice né catalogo: senza il record nel manifest sono blob di int16 illeggibili senza il codice che li ha scritti |
| Download sorgente: **3 tentativi con attesa crescente**, file parziale cancellato prima di ogni nuovo tentativo | Un errore passeggero a metà di un download da quasi 2 GB non deve costare l'intero run; senza la cancellazione, lo sha256 verrebbe calcolato su byte incompleti |
| Batimetria pubblicata **solo quando si incontra il primo file 3D** (`his_temp`), scala 0,1 | Non sta nei file d'onda. Con scala 0,01 il fondoscala sarebbe 327 m e il bacino meridionale (fino a 1.245,9 m) verrebbe tosato in silenzio; si solleva un errore se `clipped_count` non è zero |
| Dimensioni griglia reali: **858 x 844 celle** a 1.200 m Mercator, misurate contro l'archivio il 2026-08-13 | Non sono cablate: le produce `build_grid()` dai dati sorgente e finiscono in `grid.json` |

**Divieti espliciti:**

- Niente trattini lunghi nei file (i due caratteri Unicode di punteggiatura più lunghi del segno meno ASCII): un hook blocca la scrittura. Usare virgole, due punti o parentesi.
- Documentazione e messaggi di commit in italiano.
- Non introdurre un backend applicativo senza rimettere in discussione la sezione 1 della spec.

## 4. Cosa è aperto

### 4a. Blocca il resto, e solo l'utente può farlo

~~Repo pubblico, bucket R2, segreti su GitHub~~. **Tutto fatto il 2026-08-17.**
Niente è più bloccato su di te.

Restano due cose da sapere, non da fare:

- **Il bucket pubblico** è `https://pub-58d91a839da640f8ab33e576c44b89c8.r2.dev`.
  Non è un segreto: è l'origine da cui la SPA leggerà.
- **`static/regrid_index.npz` non si cancella dal bucket.** Non è una cache: è la
  memoria di com'era fatta la griglia ARPAE l'ultima volta, ed è ciò che fa
  scattare `GridMismatch` se il dominio cambia. Senza, ogni run ricostruirebbe
  l'indice dal file corrente, che coincide sempre con sé stesso, e una
  riconfigurazione del modello passerebbe inosservata riempiendo l'archivio di
  valori nel posto sbagliato.

### 4b. Attende materiale o terzi

Niente.

### 4c. Da scrivere, in questo ordine

1. ~~Eseguire il piano dell'ingestore~~. **Fatto**: 15 task, 134 test nella suite di default più i 4 test di coerenza contro i dati reali (`uv run pytest -m rete`), che confrontano il valore letto da ADRIAC sulla cella di Nausicaa 2 con quello che il client leggerebbe dal frame pubblicato.
2. ~~Allineare la spec alle correzioni~~. **Fatto**: le correzioni emerse eseguendo il piano e quelle della revisione finale (sezioni 4.2, 4.5, 4.6, 4.7 e 6.1) sono state applicate alla spec.
3. ~~Ri-revisione mirata delle 14 correzioni~~. **Fatto il 2026-08-14**: 13
   rilievi su 13 chiusi, ognuno verificato rimettendo il difetto e guardando la
   suite diventare rossa sul test scritto per quel rilievo. Le tre voci che la
   ri-revisione ha aperto sono state chiuse subito dopo, in tre commit separati:
   - il rename di una variabile sorgente usciva **1** invece di 2, cioè "riprova
     domani", e il cron avrebbe ritentato per sempre mentre la finestra di 8
     giorni scorreva via. Emergeva da due punti diversi, non uno: a bucket vuoto
     dalla maschera di mare, a regime dalla lettura delle unità;
   - `ColumnRecord.from_dict` non era eseguita da nessun test;
   - lo stesso rename nelle variabili di profilo usciva ancora 1.

   Chiuso anche il problema di fondo che le tre voci avevano in comune: tutte le
   letture della sorgente passano ora da `frames.read_variable`, e
   `tests/test_vincoli.py` cammina l'albero sintattico del pacchetto e fallisce
   se una lettura diretta ricompare. La regola non è più affidata alla
   disciplina di chi scrive.
4. ~~Merge del branch dell'ingestore~~. **Fatto il 2026-08-14**: unito su
   `develop` con un merge non fast-forward, suite verde sul risultato del merge,
   pushato.
5. ~~Il primo run contro R2 vero~~. **Fatto il 2026-08-17**: 72 file su 72,
   zero errori, 70 minuti. L'indice si è costruito a 858 x 844 celle, cioè la
   cifra prevista per misura il 13 agosto, e la batimetria è uscita da 2,0 a
   1.245,9 m. Cinque stazioni scartate con il motivo scritto nel log (vedi 6).
6. **Il piano della SPA**, da scrivere quando l'ingestore gira e ci sono dati osservabili su R2 invece che una specifica.
7. **Stima della corrente nei canali di Comacchio.** Richiesta del 2026-08-18.
   Due problemi diversi. **Il bacino e' bloccato**: nessun idrometro pubblico sta
   dentro le Valli. **La corrente nel portocanale no**: se il livello interno e'
   quasi fermo dipende dal solo livello del mare, che abbiamo gia' in archivio
   anche come previsione a 72 ore, e restano due incognite da stimare con una
   campagna di mezza giornata in barca. Una volta calibrata, la funzionalita'
   prevede la corrente in avanti, che e' la parte utile a chi entra o esce.
   Dettaglio e misure nella sezione 1 della spec.
8. **Isolinee etichettate sull'altezza d'onda**, stile isobate, con resa a classi
   discrete sui gradini del codice stato del mare WMO. Richiesta del 2026-08-13,
   dettaglio e riferimento misurato nella sezione 1 della spec. Va con la SPA,
   non prima: non tocca l'ingestore.

**Cosa le correzioni hanno lasciato aperto di proposito** (dettaglio in
`docs/superpowers/revisioni/2026-08-13-ingestore-correzioni.md`, sezione "Cosa
non ho fatto"):

- ~~I 4 test di rete non sono stati eseguiti dopo le correzioni~~. **Fatto**:
  eseguiti il 2026-08-14 contro l'archivio ARPAE reale, 4 verdi.
- **La deduplica salta il file senza aprirlo** quando dimensione e data di
  modifica non sono cambiate. È una scelta deliberata per non riscaricare
  1,9 GB al secondo run giornaliero, ma restringe la portata delle guardie
  6.1: un cambio di contratto interno al file resterebbe invisibile finché
  l'intestazione HTTP non si muove. Perché il buco si materializzi servirebbe
  un rename che produce un file della stessa identica lunghezza in byte con la
  stessa data: il costo è un giorno di ritardo nell'accorgersene, non un dato
  perso, perché il file resta nella finestra.
- **Descrittori di griglia versionati**: la spec 4.4 promette `grid_v2.json`, il
  codice non lo sa fare. Divergenza nota fra spec e codice.
- **`--only` su una variabile fuori dal gruppo di riferimento non può
  funzionare** (l'indice si costruisce solo nel ramo del gruppo di riferimento).
  Difetto preesistente: prima rimandava in silenzio uscendo 0, adesso lo dichiara
  e esce 1. Chi prova `--only ubar` come primo comando lo incontra.
- **Il file di riferimento si scarica due volte per run**, circa 23 MB.
- **Il piano non è stato aggiornato** e contiene frammenti anteriori alle
  correzioni: rieseguirlo alla lettera reintrodurrebbe due dei tre critici.
- **La fusione dell'anagrafica conserva le coordinate esistenti**: se ARPAE
  spostasse davvero una boa, il sistema userebbe la posizione vecchia e nessun
  log lo direbbe. Scelta coerente con un archivio permanente, ma il caso "boa
  realmente spostata" oggi si risolve solo a mano.

**Cosa il piano lascia fuori di proposito.** Le osservazioni misurate dalle boe (`stations/{id}/obs/{YYYY-MM}.json` in §4.2). ARPAE le conserva in `opendata/osservati/meteo/storico/` dal 2006, quindi **non sono deperibili**: si recuperano in qualunque momento. Il principio "l'ingestione è golosa" nasce dalla finestra di 8 giorni di ADRIAC e vale solo per ciò che ARPAE cancella. L'ingestore costruisce comunque l'anagrafica delle stazioni, che serve ai profili.

## 5. Comandi

I comandi di verifica del codice stanno in fondo, nella sezione 7. Non esiste
ancora nessun comando di build, perché la SPA non è iniziata.

Questi sono invece i comandi di ispezione usati per verificare le fonti, utili per ricontrollare senza rifare le scoperte:

```bash
# elenco dei file disponibili nella finestra ADRIAC (8 giorni)
curl -s -L "https://dati-simc.arpae.it/opendata/adriac/" | sed -n 's/.*<a href="\([0-9]*_adriac[^"]*\)">.*/\1/p'

# dimensione di un file senza scaricarlo
curl -sI "https://dati-simc.arpae.it/opendata/adriac/20260813_adriac_1km_his_HPDwave_an.nc.gz" | grep -i content-length

# ispezione della struttura di un NetCDF senza installare niente
uv run --quiet --with netCDF4 --with numpy python -c "
from netCDF4 import Dataset, num2date
d = Dataset('file.nc')
print({k: len(v) for k, v in d.dimensions.items()})
for n, v in d.variables.items():
    print(n, v.dtype, v.dimensions, getattr(v, 'long_name', ''), getattr(v, 'units', ''))
t = d['ocean_time']; dt = num2date(t[:], t.units)
print(len(dt), dt[0].isoformat(), dt[-1].isoformat())
"

# leggere l'intestazione di un file enorme senza scaricarlo tutto
curl -s -r 0-2000000 "<url>.nc.gz" -o p.gz && (gunzip -c p.gz 2>/dev/null | head -c 300000 > p.nc; true) && strings -n 4 p.nc | head -40

# reti e stazioni presenti nelle osservazioni in tempo reale
curl -s -L "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl" -r 0-40000000 -o rt.jsonl
```

### Cifre di riferimento, misurate il 2026-08-13

| Grandezza | Valore | Non include |
|---|---|---|
| Griglia ADRIAC | 752 x 272 = 204.544 celle, 121.543 di mare (59,4%) | |
| Livelli verticali | 30 sigma (`s_rho`) | |
| Batimetria | da 1,5 a 1.245,9 m | |
| Orizzonte previsione | 72 ore esatte, passo orario | |
| Copertura analisi | 24 ore, passo orario, del **giorno precedente** | |
| `qck_sl` | 144 step a passo 10 minuti, `float64` | |
| Frame prodotti | 792 al giorno | i profili delle stazioni |
| Storage | circa 99 MB al giorno, circa 36 GB all'anno | |
| Download ingestore | circa 1,9 GB al giorno | |
| R2 gratuito | 10 GB, egress illimitato, esaurito verso il terzo mese e mezzo | |

### Il percorso di lettura, verificato il 2026-08-18

Un browser legge l'archivio senza backend. Misurato con una richiesta vera e
un `Origin` estraneo, su `frames/hwave/an/20260817/2026-08-16T1200.bin`:

| | |
|---|---|
| Byte sul filo | 152.935 |
| Byte dopo la decompressione automatica | 1.448.304, cioè esattamente 858 x 844 x 2 |
| Rapporto di compressione | 9,5 volte |
| `Content-Encoding` | `gzip`, quindi zero librerie di decompressione nel client |
| `Access-Control-Allow-Origin` | `*` |
| `Cache-Control` sul catalogo | `public, max-age=300` |
| Celle di mare nel frame | 168.712 su 724.152 |
| Valori decodificati | onda da 0 a 0,42 m, media 0,18 m (Adriatico di ferragosto) |

## 6. Trappole già pagate, da non ripagare

**Il file di analisi datato `D` contiene i dati di `D-1`.** Verificato: `20260813_..._his_HPDwave_an.nc` copre dalle 01:00 del 12 alle 00:00 del 13. Datare i frame su `ocean_time`, mai sul nome del file, altrimenti tutto l'archivio slitta di 24 ore.

**La griglia ADRIAC è curvilinea, non lat/lon regolare.** `lon_rho` varia lungo la direzione eta (da 17,7150 a 10,8437 sulla colonna 0). Appoggiare l'array sulla mappa come rettangolo nord-sud lo disegna storto.

**Le velocità sono già proiettate su est/nord e stanno su punti rho.** In 2D sono `ubar_eastward` e `vbar_northward`; in 3D il file `his_cur` espone `u_eastward` e `v_northward`, dichiarate "at RHO-points", con dimensioni `s_rho, eta_rho, xi_rho`. Niente griglie sfalsate u/v, nessuna rotazione dei vettori, nessun caso speciale nella ricerca della cella. Verificato leggendo l'intestazione senza scaricare i 640 MB.

**Le texture intere in WebGL non supportano il filtraggio bilineare hardware.** Con `R16UI` e `usampler2D` il filtro è per forza `NEAREST`. L'interpolazione va scritta nello shader con quattro `texelFetch`, il che è anche meglio perché permette di escludere i vicini `nodata` invece di mediarli (col filtro hardware ogni costa avrebbe un alone di valori sbagliati).

**ADRIAC tiene solo 8 giorni.** Verificato: il 13 agosto il file più vecchio era del 6. Non esiste archivio storico a monte. Ogni giorno senza ingestione è perso e non recuperabile in nessun modo.

**Le due soglie erano una sola, e sono state separate.** Gli 800 m nati per il
ricampionamento ("questo pixel può prendere il valore di quella cella", dove
impediscono che il colore sbordi sulla terraferma) servivano anche ad associare
una stazione alla sua cella ("quale cella rappresenta questa boa"). Al primo run
reale hanno scartato cinque stazioni: le tre lagunari del delta a 977, 2.788 e
3.003 m, giustamente, ma anche le due di Cervia Porto a 922 e 923 m, che sono
boe in mare vero a meno di una cella di distanza. Dal 2026-08-18 sono due
costanti: `MAX_NEIGHBOUR_DISTANCE_M` resta 800 e resta al ricampionamento,
`MAX_STATION_DISTANCE_M` vale 1.000 e vale solo per le stazioni. Fra Cervia a
923 m e Manufatto a 977 m ci sono 55 metri, quindi **nessuna soglia numerica
può distinguerli**: Manufatto esce per nome, tramite
`config.EXCLUDED_STATIONS`, perché la salinità misurata il 2026-08-18 è 0,02
parti per mille, cioè acqua dolce, dove la colonna del modello marino non
significa niente. Logonovo e Bellocchio restano fuori per distanza e non sono
nominati.

**Il dataset `swanemr` è morto.** Il CKAN `dati.arpae.it` lo elenca ancora sotto `previsioni-mare`, ma la directory è ferma a settembre 2025. Non perderci tempo.

**Il CKAN `dati.arpae.it` è quasi inutile per il mare.** Una sola ricerca utile su 259 dataset. I dati veri stanno su `dati-simc.arpae.it/opendata/`, che è un indice Apache senza API.

**Un hook blocca i trattini lunghi.** Scrivere un file che li contiene fallisce con "Contenuto bloccato". Attenzione al caso ricorsivo: anche *citare* il carattere per documentare il divieto fa fallire la scrittura. Costa una riscrittura completa del file se ci si accorge tardi.

**`netCDF4`, `numpy`, `scipy` non sono installati a livello di sistema.** Usare `uv run --with netCDF4 --with numpy python -c ...` per le ispezioni al volo. `ncdump` e `gdalinfo` non esistono su questa macchina.

## 7. Stato git

- Repo unico: `/Users/ale/source/personal/stato_del_mare`
- Branch corrente: `develop` (nessun `main` locale)
- Remote: `origin` = `git@github.com:madAle/stato_del_mare.git`
- **`develop` è allineato a `origin/develop`** (verificato il 2026-08-14: nessun commit locale in più), albero pulito
- `feat/ingestore` è stato unito con un merge non fast-forward e cancellato in locale. Resta su `origin` come `origin/feat/ingestore`: se servisse rileggere la storia dell'esecuzione commit per commit, è lì.
- Lo spazio di lavoro `.superpowers/sdd/2026-08-13-ingestore/` è stato cancellato a lavoro concluso. I documenti che contavano erano già stati copiati in `docs/superpowers/revisioni/`.

Comandi di verifica:

```bash
uv run ruff check .
uv run pytest            # suite predefinita, i test di rete restano esclusi
uv run pytest -m rete    # coerenza contro l'archivio ARPAE, scarica circa 23 MB per test
```
