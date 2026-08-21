# Stato del lavoro

**Aggiornato:** 2026-08-21 · **Branch:** `develop`, release su `main` · **Fase:** ingestore e SPA in produzione. **Al riavvio: il punto 13 della sezione 4c** (arrotondamento dei valori a schermo)

**Leggi questo per primo.** Poi, se serve il dettaglio:
`docs/superpowers/specs/2026-08-13-stato-del-mare-design.md` è il design
approvato (emendato due volte, le modifiche sono citate qui);
`docs/superpowers/revisioni/2026-08-13-ingestore-decisioni.md` sono le 34
decisioni dell'ingestore con il motivo e il costo se sbagliate;
`docs/superpowers/revisioni/2026-08-18-spa-decisioni.md` sono le 89 della SPA,
scritte con la stessa regola. **Le decisioni si leggono, non si rifanno**: ognuna
porta il motivo e cosa costa se è sbagliata, ed è quello che le rende
riesaminabili invece che da riaprire.

**L'ingestore gira, e ora gira ogni ora.** Primo run reale il 2026-08-17: 72 file
su 72, 70 minuti, l'intera finestra ARPAE di otto giorni in archivio. Dal
2026-08-21 il cron è **ogni ora dalle 09 alle 19 UTC** (più una rete alle 22, al
minuto 17 e non a zero): l'ora di pubblicazione ARPAE oscilla di sei ore, e con
due soli cron su tre giorni su sette il dato del giorno si vedeva solo dalle 20
di sera. Misurato il 2026-08-20: file pubblicato alle 12:24, ingerito alle 13:12.

**La SPA è online e disegna cinque grandezze.** <https://stato-del-mare.pages.dev>
Altezza d'onda, periodo, livello del mare sono selezionabili; direzione e corrente
no (vogliono le frecce, vedi 4). Sopra il campo ci sono due sovrapposizioni
indipendenti: le **isolinee** sui confini della scala Douglas e l'**animazione a
particelle** della direzione dell'onda, con la velocità presa dalla fisica.
La suite è di **209 test unitari e 38 end to end**, typecheck pulito.

## 1. Cos'è il progetto

Mappa interattiva dello stato del mare in Adriatico dai dati pubblici ARPAE, con timeline navigabile avanti e indietro e riproduzione automatica.

## 2. Dove sta il codice e cosa fa ogni pezzo

**L'ingestore e la SPA esistono entrambi e sono in produzione**, su `develop`
(release su `main`, che è ciò che pubblica).

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
tests/            147 test nella suite predefinita, più 4 dietro il marcatore `rete`
.github/workflows/
  ci.yml          ruff e pytest su push e pull request
  ingest.yml      ingestione oraria 09-19 UTC + rete alle 22, al minuto 17
  deploy.yml      pubblica la SPA su Cloudflare Pages a ogni push su main
  basemap.yml     pubblica la basemap sul bucket (a mano, workflow_dispatch)
web/              la SPA: Vite, React 19, MapLibre 5, TypeScript
  src/data/       TS puro, non conosce React
    urls.ts       l'unico modulo che sa come è fatto un URL del bucket
    catalogo.ts   tipi e lettura di catalog.json, si ferma su uno schema ignoto
    indice.ts     indici mensili, asse dei tempi, buchi (solleva se non ordinato)
    sorgente.ts   inquadratura temporale e provenienza (analisi o previsione +Nh)
    frame.ts      lettura di un frame, si ferma se la lunghezza non torna
    cache.ts      LRU misurata in byte; `ha()` interroga senza ringiovanire
    prefetch.ts   finestra davanti al cursore, riprova i frame caduti
  src/map/        TS puro, non conosce React
    proiezione.ts lon/lat verso cella, e valore sotto il mouse senza leggere la GPU
    colormap.ts   palette cmocean, GENERATO da strumenti/colormap.py
    shader.ts     GLSL: ribaltamento, nucleo continuo, ritaglio, dissolvenza
    campo.ts      custom layer WebGL2, texture R16I, alPrimoDisegno
    mappa.ts      MapLibre, basemap pmtiles, campo sotto le etichette, zoom max 15
    animazione.ts ciclo rAF, interpolazione temporale, rapporto a 10 Hz
    strozzatore.ts strozza in entrata e in uscita: l'ultimo valore arriva sempre
    soglie.ts     la scala Douglas: gradi, confini, nome dello stato del mare
    isolineeGeometria.ts  marching squares, taglio del bordo, smusso, ancore (puro)
    isolinee.worker.ts    solo la posta: il calcolo sta nel modulo puro
    isolinee.ts   i due strati MapLibre, strozzamento a 5/s, vince l'ultima
    ricordoFotogrammi.ts  il ricordo LRU del worker: avverte quando sfratta
    particelle.ts il moto delle particelle (puro): convenzione, Mercatore, fisica
    livelloParticelle.ts  custom layer WebGL delle scie, con cinque numeri di diagnosi
    segnaposto.ts il punto fissato, ancorato a lon/lat e non ai pixel
  src/ui/         React, e solo qui
    App.tsx       composizione, stato, URL con replaceState al massimo 1 volta/s
    MapView.tsx   confine imperativo verso src/map, ref per non congelare i dati
    TimelineScrubber.tsx  asse a indici, buchi visibili, confine analisi/previsione
    PlaybackControls.tsx  play e pausa, tre velocità
    grandezze.ts  i nomi leggibili e la resa per grandezza: decide i nomi, non
                  l'esistenza (un campo sconosciuto compare comunque)
    numeri.ts     l'unico posto che scrive un valore misurato, con lo stato del mare
    Legend.tsx, StatusBar.tsx, LayerSwitcher.tsx, PaletteSwitcher.tsx, statoUrl.ts
  test/           209 test; test/vincoli.test.ts è il cancello dei tre strati
  e2e/            38 test Playwright su due progetti: `chromium` sul dev server e
                  `build` su `vite preview`, perché il bundle compilato è un
                  altro programma (vedi 6)
  public/         asset generati dagli strumenti, versionati (690 KB, vedi 43)
strumenti/        si eseguono a mano, una volta sola
  costa_sdf.py    campo di distanza dalla costa OSM (75 s, serve GSHHG o OSM)
  maschera_dato.py campo di distanza dal bordo del dato
  colormap.py     scrive src/map/colormap.ts da cmocean
  asset.sh        estrae la basemap e carica font e sprite (lo lancia il workflow Basemap)
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
| Distanza massima di ricampionamento: **800 m** (non 1,5 km come nella prima stesura della spec) | Le celle sorgente distano 1 km fra loro: 707 m (la semidiagonale) copre ogni punto interno a una cella di mare; 800 m limita lo sbordamento sulla terraferma a meno di una cella sorgente | Confermato il 2026-08-18 contro la tentazione di allargarlo per coprire la frangia costiera: allargando a 2,4 km se ne coprirebbe solo il 48%, il raggio e' inciso nell'indice e ogni cambio lascia una cucitura permanente nell'archivio (si rilavora solo dentro 8 giorni). Il bordo si sfuma a disegno, che e' gratis e reversibile.
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

**La prima cosa da fare al riavvio è il punto 13**, l'arrotondamento dei valori
a schermo: è chiesto, è piccolo, e porta con sé una decisione da non prendere in
silenzio (il nome del grado Douglas al confine).

Gli altri punti aperti sono 7 (giudicare la palette a occhio, vuole te), 9
(Comacchio, ferma su mezza giornata in barca), 11 (gli ultimi due layer:
direzione come voce del selettore, e la corrente), 12 (dire di che onda si
tratta) e 14 (le boe, bloccata sull'accesso ai dati). Tutto il resto qui sotto è
barrato e sta solo come storia.

**La cosa che continua a lavorare mentre nessuno guarda è l'ingestione.** ADRIAC
conserva otto giorni: se il workflow `Ingestione ADRIAC` è rosso, quella è la
prima cosa da sistemare, prima di qualunque funzionalità, perché ogni giorno
saltato è archivio che non si recupera.

1. ~~Eseguire il piano dell'ingestore~~. **Fatto**: 15 task, 147 test nella suite di default (erano 134 alla fine del piano) più i 4 test di coerenza contro i dati reali (`uv run pytest -m rete`), che confrontano il valore letto da ADRIAC sulla cella di Nausicaa 2 con quello che il client leggerebbe dal frame pubblicato.
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
6. ~~Il piano della SPA~~. **Scritto e eseguito il 2026-08-18**: 16 task, un
   subagente per task e una revisione dopo ognuno, 51 commit su `feat/spa`, 121
   test unitari e 3 end to end verdi. Le 42 decisioni prese eseguendo stanno in
   `docs/superpowers/revisioni/2026-08-18-spa-decisioni.md`. Le tre decisioni che
   lo bloccavano erano state chiuse prima:
   - **ritaglio sulla costa OSM**, la stessa che disegna la basemap, con margine
     di 250 m dalla riva misurati in metri e non in pixel;
   - **tetto di zoom 15**, dove una cella del modello vale 353 pixel e il campo
     smette di risolvere sotto gli occhi di chi guarda;
   - **basemap `.pmtiles` di Protomaps nello stesso bucket**, fino a zoom 13,
     702 MB misurati, cosi' le etichette stanno sopra il campo e non serve
     nessun servizio di terzi.
7. **Da guardare sulla SPA, e vuole occhi umani** (ancora aperto al 2026-08-21). Il foglio di stile e' nato
   nell'ultima onda di correzioni, non era nel piano, e la sua palette e'
   dichiaratamente provvisoria. Le sovrapposizioni sugli schermi stretti sono
   chiuse dal 2026-08-19: la fascia alta e' un flex che va a capo invece di una
   soglia in pixel, e `web/e2e/pannelli.spec.ts` misura i rettangoli veri a
   1440, 900, 680, 500 e 390 px. Resta da giudicare a occhio la palette, e va
   fatto con la basemap vera sotto: senza, si vede solo grigio.

8. ~~Pubblicare la SPA~~. **Fatta il 2026-08-19**: online su
   <https://stato-del-mare.pages.dev>, Cloudflare Pages, progetto
   `stato-del-mare`, pubblicata da `.github/workflows/deploy.yml` a ogni push
   su `main`. Verificata aprendola in un browser vero: zero errori in console,
   zero richieste fallite, basemap e campo disegnati. Il bucket serve gia'
   `Access-Control-Allow-Origin: *` e autorizza le richieste a intervallo, che
   e' quello che serve al `.pmtiles`: nessuna configurazione CORS da fare.

   **Il dominio davanti al bucket si resta senza, deliberatamente**
   (2026-08-20). L'origine dei dati e' `pub-*.r2.dev`, che Cloudflare
   documenta cosi': *"Public access through r2.dev subdomains is rate-limited
   and should only be used for development purposes"*, e *"this is an
   unsupported access path, and we cannot guarantee consistent reliability or
   performance"*. **Motivo per restarci**: e' un progetto personale con un
   utente, e un dominio personalizzato su R2 vuole una zona gia' su
   Cloudflare, che qui non c'e'; comprarne una per questo non vale.
   **Costo se e' sbagliato**: se il limite scatta, il sintomo e' basemap a
   chiazze o fotogrammi mancanti, non un danno ai dati; si aggancia un dominio
   e si cambia **una riga** in `web/src/data/urls.ts`.

   Misurato il 2026-08-20, quanto passa dal bucket per un solo visitatore:
   aprire la pagina sono 46 richieste e 6,8 MB (4 di fotogrammi, 2,8 di
   basemap), venti secondi di riproduzione a 2 ore/s altre 40 richieste e
   7,0 MB.

   **Da rimettere in discussione quando**: il link viene dato a piu' di una
   manciata di persone, oppure compaiono 429 o basemap a chiazze. Se nel
   frattempo esiste gia' una zona Cloudflare per un altro motivo, un
   sottodominio non costa niente e tanto vale agganciarlo.

9. **Stima della corrente nei canali di Comacchio.** Richiesta del 2026-08-18.
   Due problemi diversi. **Il bacino e' bloccato**: nessun idrometro pubblico sta
   dentro le Valli. **La corrente nel portocanale no**: se il livello interno e'
   quasi fermo dipende dal solo livello del mare, che abbiamo gia' in archivio
   anche come previsione a 72 ore, e restano due incognite da stimare con una
   campagna di mezza giornata in barca. Una volta calibrata, la funzionalita'
   prevede la corrente in avanti, che e' la parte utile a chi entra o esce.
   Dettaglio e misure nella sezione 1 della spec.
10. ~~Isolinee etichettate sull'altezza d'onda~~. **Fatte il 2026-08-19,
   rifinite il 2026-08-20.** Una linea per ogni confine della scala **Douglas**
   e nessun'altra (le intermedie ARPAE sono state tolte: col mare d'agosto
   l'unica visibile era 0,8 m, una linea che non separava niente che si potesse
   dire a parole). Si possono **spegnere** dall'interruttore nella
   legenda, e spegnerle ferma anche il calcolo (la scelta viaggia nell'URL come
   `iso=0`). Sulla linea va solo l'altezza (`0,5 m`); il nome
   del grado (`mosso`) sta accanto al valore misurato, nella barra di stato e
   sul segnaposto, scritto dalla stessa funzione. Elenco unico
   in `web/src/map/soglie.ts`. Marching squares in un worker
   (`isolinee.worker.ts`), calcolo puro in `isolineeGeometria.ts`; le linee si
   smussano con un taglio d'angolo limitato a mezza cella e l'ancora del numero
   la calcoliamo noi invece di lasciarla piazzare a MapLibre. **La spec e'
   stata emendata**: il campo resta a rampa continua invece di andare a bande
   discrete, perche' con i gradini Douglas in basso l'Adriatico estivo cadrebbe
   tutto in una classe. Dettaglio nelle decisioni 57-60 e 64-70.

11. **Le altre variabili del catalogo, una alla volta.** Fatto il 2026-08-20:
   **altezza d'onda e periodo**. Cambiando grandezza cambiano scala dei valori
   grezzi, cima della legenda, unita', presenza dello stato del mare accanto al
   numero e presenza delle isolinee. Il periodo **non si dissolve** fra un'ora e
   l'altra: prende 17 valori in tutto l'archivio (griglia delle frequenze di
   SWAN) e interpolarli inventerebbe periodi che il modello non produce.

   Fatto lo stesso giorno anche il **livello del mare**, primo campo con segno:
   la scala di colore adesso va da `minimo` a `massimo` invece che da zero, gli
   estremi sono simmetrici (-0,8 / +0,8 m, misurati) e la tavolozza e'
   divergente, perche' con una sequenziale lo zero non avrebbe un colore suo.

   La **direzione dell'onda** e' fatta il 2026-08-20, ma non come layer: e' una
   **sovrapposizione animata a particelle** (interruttore "direzione" accanto a
   "isolinee", `dir=1` nell'URL), perche' una direzione non ha grandezza da
   colorare e le frecce statiche dicono meta' della cosa. Il moto sta in
   `web/src/map/particelle.ts` (puro, dodici test), il disegno in
   `livelloParticelle.ts`. La velocita' viene dalla fisica (`c = g T / 2 pi`,
   col periodo dall'archivio), non da un numero scelto.

   Resta la **corrente**: stesso motore, ma ha un modulo, quindi puo' essere un
   layer a se' (colore = velocita', particelle = verso). E resta la voce
   "direzione dell'onda" nel selettore, che l'utente ha chiesto in aggiunta alla
   sovrapposizione: **una sola implementazione**, cioe' le stesse particelle su
   un fondo neutro, se no i due modi divergono.

   Nomi, accorpamento delle componenti e scelte di resa stanno in
   `web/src/ui/grandezze.ts`. **Vincolo da sciogliere prima della direzione**:
   oggi le grandezze disegnabili hanno un campo solo, quindi il loro id coincide
   con quello del campo nel catalogo, ed e' cio' che rende lecito passarlo a
   `leggiIndice` e a `urlFrame`.

12. **Dire sulla mappa di che onda si tratta.** Deciso il 2026-08-21 di
   **rimandare**, su richiesta ("per ora lasciamo così"). Il difetto resta ed e'
   reale: la mappa scrive "0,54 m, mosso" senza dire che quello e' il campo
   d'onda di ADRIAC, di cui **non sappiamo** se contenga il mare lungo (vedi 6).
   Chi guarda non ha modo di sapere cosa non sta vedendo, ed e' la stessa
   omissione che la provenienza analisi/previsione esiste per evitare. Costa
   dieci minuti: una riga nel selettore o accanto alla legenda.

13. **Arrotondare i valori a schermo.** Chiesto il 2026-08-21, **da fare per
   primo al riavvio**: il periodo dell'onda al **mezzo secondo** più vicino,
   l'altezza d'onda ai **5 cm**. Oggi entrambi hanno due decimali
   (`ui/numeri.ts`, `scriviValore`), che è una precisione che il dato non ha.

   Due cose misurate prima di scrivere una riga. La seconda è già risolta dalla
   scelta dei 5 cm, ma il perché va tenuto scritto: con il decimo di metro non
   avrebbe funzionato.

   - **il periodo perde cinque livelli su diciassette.** I valori possibili sono
     i diciassette della griglia SWAN, e arrotondati al mezzo secondo diventano
     dodici: `1,00` e `1,13` collassano su `1,0`; `1,28`, `1,45` e `1,65` su
     `1,5`; `1,87` e `2,11` su `2,0`; `2,40` e `2,71` su `2,5`. Nella parte
     bassa della scala, dove sta il mare d'agosto, due stati diversi del mare
     mostreranno lo stesso numero. Non è un errore, è il prezzo: va deciso
     sapendolo. (Un quarto di secondo li terrebbe tutti distinti sopra i 2 s.)
   - **l'altezza si arrotonda a 5 cm** (deciso il 2026-08-21, dopo che il decimo
     di metro aveva mostrato il problema), **e il nome del grado si calcola dal
     valore arrotondato.** Il perché è una proprietà verificata: **tutti i
     confini Douglas sono multipli esatti di 5 cm** (0,10 = 2, 0,50 = 10,
     1,25 = 25, 2,50 = 50, 4 = 80, 6 = 120, 9 = 180, 14 = 280). Quindi numero e
     nome a schermo **non possono contraddirsi**: se si legge `0,50 m`, il valore
     arrotondato è ≥ 0,50 e il nome è "mosso". Con il decimo di metro non
     funzionava, perché 1,25 non è multiplo di 0,1.
     Il residuo, dichiarato: la classificazione al confine può sbagliare di al
     più **2,5 cm** (un vero 0,475 si legge `0,50 m · mosso` mentre sarebbe
     ancora "poco mosso"). È metà del passo che il display dichiara, cioè un
     errore invisibile e limitato, e va preferito a una coppia numero-nome che si
     contraddice, perché quella si **vede**.
     Attenzione all'implementazione: arrotondare in **centimetri interi**
     (`Math.round(v * 100 / 5) * 5 / 100`), se no 1,25 esce
     `1.2500000000000002`. Il formato resta a due decimali, così `0,45` e `0,50`
     si leggono uguali: cambia solo quali valori possono comparire.

   Da toccare: `web/src/ui/numeri.ts` (l'unico posto che scrive un valore
   misurato) e i test che fissano il formato a due decimali
   (`test/ui/numeri.test.ts`, `e2e/punto.spec.ts`, `e2e/variabili.spec.ts`,
   `e2e/tocco.spec.ts`).

14. **Dati misurati dalle boe ondametriche, accanto al modello.** Richiesta del
   2026-08-20. Oggi la mappa non contiene **nessuna misura**: analisi e
   previsione sono lo stesso modello con due forzanti diverse (lo dice la
   descrizione del dataset ARPAE: i file `an` sono "forzati da analisi
   meteorologiche e al contorno"). Chi guarda non ha modo di sapere quanto il
   modello sbagli.

   Le fonti candidate sono due, ed **e' onda, non marea**:
   - **RON**, Rete Ondametrica Nazionale di ISPRA, quindici boe accelerometriche
     lungo le coste italiane, altezza significativa, periodo e direzione;
   - **Nausicaa 2**, la boa regionale di ARPAE al largo di Cesenatico, in
     funzione dal 2012 (la prima) e sostituita di recente: oltre all'onda
     misura corrente superficiale e temperatura di acqua e aria.

   La rete **mareografica** (RMN, sempre ISPRA) e' un'altra cosa e misura il
   livello del mare: servirebbe semmai per la variabile `sealevel`, che
   l'ingestore gia' archivia ma la SPA non disegna.

   **Cosa cambia rispetto a tutto il resto**: sono serie temporali **su punti**,
   non campi. Non sono un livello raster in piu': sono segni sulla mappa con un
   grafico nel tempo, e il loro uso naturale e' il **confronto** con il modello
   nella stessa cella e nella stessa ora. L'applicazione ha gia' il punto
   fissato che mostra il valore del modello: la misura gli si affianca, e la
   domanda "quanto ci prende" diventa leggibile invece che teorica.

   **Da stabilire prima di progettare, in questo ordine**: (a) esiste un accesso
   aperto e leggibile da programma (non una pagina da guardare) per RON e per
   Nausicaa? (b) con che passo e che ritardo pubblicano? (c) la licenza consente
   la ripubblicazione nel nostro bucket? Se la risposta ad (a) e' no, la
   funzionalita' e' bloccata su terzi e va in 4b, non qui.

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

  Ha però una seconda conseguenza, che il 2026-08-18 è diventata concreta:
  **quando una correzione cambia ciò che un file produce, i giorni già in
  archivio non la recuperano da soli**, perché il sorgente non si muove e
  nessuna intestazione HTTP lo racconta. È il caso della soglia stazioni
  passata da 800 a 1.000 m, che ha fatto rientrare le due boe di Cervia Porto
  senza produrne le colonne per i giorni precedenti. Da qui nasce
  `--rilavora` (sezione 5): ignora entrambi i livelli di deduplica per i
  gruppi indicati, e solo quelli. **Non** disattiva le guardie: `GridMismatch`
  e `UnitMismatch` continuano a fermare il run, perché `--rilavora` dice
  "riprocessa", non "fidati".
- ~~Descrittori di griglia versionati~~. **Chiuso il 2026-08-18** allineando la
  spec al codice invece del contrario: due griglie non possono mescolarsi, perché
  `GridMismatch` ferma il run prima di scrivere. La spec 4.4 ora contiene la
  procedura manuale da seguire il giorno in cui la guardia scattasse davvero.
- **`--only` su una variabile fuori dal gruppo di riferimento non può
  funzionare** (l'indice si costruisce solo nel ramo del gruppo di riferimento).
  Difetto preesistente: prima rimandava in silenzio uscendo 0, adesso lo dichiara
  e esce 1. Chi prova `--only ubar` come primo comando lo incontra.
- ~~Il file di riferimento si scarica due volte per run, circa 23 MB~~.
  **Chiuso il 2026-08-18**: il ramo che costruisce l'indice passa a
  `process_file` il file già sul disco, insieme al suo sha256, invece di
  farglielo riscaricare. La cancellazione resta a chi il file lo ha creato,
  cioè al giro di `reconcile()`, ed è nel suo `finally`: è l'unico punto
  attraversato da tutte le uscite del giro, compreso il guasto rilanciato.
  Due test lo tengono fermo, uno sul numero di scaricamenti e uno sui
  residui nella cartella di lavoro.
- ~~Il piano non è stato aggiornato~~. **Chiuso il 2026-08-18** nel solo modo
  che non mente: il piano dell'ingestore porta ora in testa un avviso che dice
  che è **eseguito e superato**, che i suoi frammenti sono anteriori alle
  correzioni e che rieseguirlo alla lettera reintrodurrebbe due dei tre critici.
  Non è stato riscritto perché un piano è il ragionamento con cui una cosa è
  nata, non un'istruzione perpetua: la verità corrente sta nel codice, nella
  spec e qui.
- **La fusione dell'anagrafica conserva le coordinate esistenti**: se ARPAE
  spostasse davvero una boa, il sistema userebbe la posizione vecchia e nessun
  log lo direbbe. Scelta coerente con un archivio permanente, ma il caso "boa
  realmente spostata" oggi si risolve solo a mano.

**Cosa il piano lascia fuori di proposito.** Le osservazioni misurate dalle boe (`stations/{id}/obs/{YYYY-MM}.json` in §4.2). ARPAE le conserva in `opendata/osservati/meteo/storico/` dal 2006, quindi **non sono deperibili**: si recuperano in qualunque momento. Il principio "l'ingestione è golosa" nasce dalla finestra di 8 giorni di ADRIAC e vale solo per ciò che ARPAE cancella. L'ingestore costruisce comunque l'anagrafica delle stazioni, che serve ai profili.

## 5. Comandi

I comandi di verifica del codice stanno in fondo, nella sezione 7.

**La SPA.** Si lavora dentro `web/`. Gli asset di `web/public/` **sono
versionati** (690 KB), quindi un clone e' subito buono: i comandi qui sotto
servono solo a rigenerarli quando cambia la griglia o la sorgente delle coste.

```bash
# solo per rigenerarli (la costa scarica 920 MB di linee OSM, 75 s di calcolo)
curl -O https://osmdata.openstreetmap.de/download/coastlines-split-4326.zip && unzip -q coastlines-split-4326.zip
uv run strumenti/costa_sdf.py --coste coastlines-split-4326 --uscita web/public
uv run strumenti/maschera_dato.py --uscita web/public \
  --frame https://pub-58d91a839da640f8ab33e576c44b89c8.r2.dev/frames/hwave/an/20260817/2026-08-16T1200.bin

npm --prefix web install
npm --prefix web run dev          # apre in locale, legge da R2
npm --prefix web test             # 209 test unitari
npm --prefix web run typecheck    # NON usare `npm --prefix web exec tsc`: exec non cambia cartella
cd web && npx playwright test     # 38 test end to end su due progetti, servono un browser e la rete
cd web && npx playwright test --project=chromium   # solo quelli sul dev server (piu' rapidi)
```

**Guardare la produzione senza pubblicarla.** `npm run preview` serve i file
compilati, non i moduli del dev server: e' l'unico modo di vedere quello che gli
utenti scaricano, ed e' cosi' che si e' scoperto che in produzione nessuna
sorgente GeoJSON caricava (vedi 6). **`preview` non ricompila**: senza `build`
prima, serve la build vecchia, e sembra che le modifiche non abbiano effetto.

```bash
cd web && npm run build && npm run preview   # http://localhost:4173
```

**La basemap.** È sul bucket dal 2026-08-19: 736 MB di tile fino a zoom 13,
tre stack di font e quattro sprite, 773 oggetti in tutto. Non si carica a mano:
si lancia il workflow `Basemap` da GitHub passando la build di Protomaps da
estrarre, perché i segreti di scrittura del bucket stanno lì e non su un
portatile.

```bash
gh workflow run Basemap --ref develop -f giorno=AAAAMMGG   # l'elenco delle build e' su build.protomaps.com
```

Il workflow finisce guardando il bucket, non il codice di uscita dello script:
una basemap incompleta non fallisce, dà una mappa senza etichette.

**Recuperare prodotti cambiati da una correzione**, su file che il manifest
dà già per ingeriti. L'elenco è di gruppi sorgente, non un interruttore
globale: rilavorare tutto vuol dire riscaricare circa 15 GB. Filtra per
gruppo di file, come `--only`. Un nome che non esiste esce 3 invece di
rilavorare zero file dicendo "tutto bene".

```bash
# prima il piano, che deve dire "rilavorazione richiesta" e non "mai ingerito"
uv run python -m ingest reconcile --dry-run --rilavora his_temp,his_salt,his_cur
uv run python -m ingest reconcile --rilavora his_temp,his_salt,his_cur
```

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

### Recupero delle colonne di Cervia, 2026-08-18

Alzando la soglia delle stazioni a 1 km, le due boe di Cervia Porto sono
rientrate, ma i giorni già in archivio non le avrebbero mai avute: la deduplica
salta i file già ingeriti senza aprirli. Recuperate con `--rilavora` sui tre
gruppi 3D di analisi, in due lotti per non rischiare il tetto di 90 minuti.

| | |
|---|---|
| Banda misurata | 8,16 GB (2,00 temp, 1,77 salt, 4,38 cur) |
| Tempo reale | 8 minuti il primo lotto, 6 il secondo |
| Recuperati | 7 giorni (11 to 17 agosto), 3 gruppi, 2 stazioni |
| **Perso** | il 10 agosto, uscito dalla finestra quella mattina stessa |

La stima iniziale era di 3 GB e il tempo temuto di 50 minuti: entrambe sbagliate
in direzioni opposte. La banda si misura con una HEAD per file, non si stima.

## 6. Trappole già pagate, da non ripagare

**Il difetto ricorrente di questo progetto ha un nome: codice che afferma più di
quello che sa.** Eseguendo il piano della SPA ne sono emersi undici casi, e sono
tutti dello stesso tipo, non undici errori diversi. I quattro che sono costati di
più, e che vale la pena riconoscere al volo:

- un **cast** che dichiarava una conversione mai fatta (`v.kinds as Variabile["tipi"]`,
  dove il JSON ha `months` e il tipo dice `mesi`). Il compilatore è stato zittito
  su una cosa falsa, l'applicazione esplodeva al primo dato vero, e **105 test
  unitari non l'hanno visto** perché controllavano le chiavi e non il contenuto;
- un **segnale di test** chiamato `__primoFrame` che significava "mappa montata".
  I test lo aspettavano e non aspettavano niente;
- un **controllo di esistenza** (`cache.prendi`) che modificava l'ordine di
  recenza: interrogare non è consumare, e confonderli faceva sfrattare proprio il
  frame che stava per andare a schermo;
- un **commento** che giurava "questo è l'unico modulo che conosce gli URL del
  bucket" mentre un altro modulo ne componeva quattro.

La domanda che li trova tutti, e che vale la pena farsi in revisione: **questa
riga sa davvero quello che dice di sapere?**

**Aggiornamento al 2026-08-21: la famiglia si è allargata a diciotto casi, e i
sei nuovi sono i più istruttivi**, perché nessuno di loro faceva fallire un test:

- **la chiave della cache dei fotogrammi non conteneva la variabile.** Finché si
  disegnava solo `hwave` dormiva; al primo secondo layer avrebbe servito i
  fotogrammi dell'onda come se fossero secondi. Chiusa **prima** di abilitare
  qualunque layer;
- **una funzione eliminata dal bundle con il riferimento lasciato in piedi**:
  MapLibre costruisce il proprio worker concatenando il *testo sorgente* delle
  proprie funzioni, e rolldown ne ha tolta una. In produzione **ogni sorgente
  GeoJSON smetteva di caricare**, con un solo `ReferenceError` in console;
- **`querySourceFeatures` legge la geometria dopo la ritilatura**, non quella
  passata a `setData`: geojson-vt risemplifica per conto suo, e per un po' ha
  fatto sembrare che lo smusso delle isolinee non funzionasse;
- **il selettore della tavolozza mostrava un nome e la mappa disegnava un'altra
  rampa**: il valore non era nell'elenco e il browser ricadeva sulla prima voce;
- **la diagnosi di un livello continuava a dichiarare i vertici dell'ultimo
  fotogramma** dopo che il livello aveva smesso di disegnare, perché `svuota()`
  non la azzerava. Il test dello spegnimento è fallito per questo;
- **una soglia in pixel che era la larghezza di *una* etichetta** invece della
  semisomma di due: due scritte centrate si toccano sotto la semisomma, e il test
  è diventato rosso da solo il giorno che l'asse si è allungato di un giorno.

**Il bundle compilato è un altro programma.** Tutti i test end to end girano sul
dev server, che serve i moduli non trasformati: un difetto che vive solo nella
build non lo vede nessuno di loro. Per questo esiste il progetto Playwright
`build`, su `vite preview`. Prima di dire che una cosa funziona, **guardare
quello che gli utenti scaricano**.

**Un'animazione che non si vede può essere spenta per cinque ragioni, e a schermo
sono tutte identiche, cioè niente.** Le particelle della direzione hanno cinque
numeri di diagnosi per questo: la prima volta la ragione vera (le scie erano
lunghe **0,27 pixel**) da uno screenshot non si sarebbe vista mai. Quando una
cosa grafica non appare, misurare i vertici prima di guardare i pixel.

**Radix, con `min` uguale a `max`, scrive `NaN` dentro un `calc()`.** Succede con
un asse di un solo istante o vuoto, che sono stati veri (una finestra con una sola
ora, oppure il caricamento). In jsdom il render fallisce con un errore di parsing
CSS; **in un browser passa in silenzio**.

**Il selettore universale `*` non raggiunge gli pseudo-elementi**, quindi
`* { box-sizing: border-box }` lascia `::before` e `::after` a `content-box`:
l'anello del punto osservato è finito 2 px fuori centro. Corollario: **quello che
deve essere misurato da un test sia un elemento vero**, perché su uno
pseudo-elemento `getComputedStyle` restituisce la larghezza dichiarata e non
quella usata, e un test che ricostruisce la scatola ripete l'assunzione che ha
causato il difetto.

**Lo strozzatore dell'URL consegna subito se la finestra è già scaduta**, quindi
legge i ref *prima* che React li aggiorni: un comando che finisce nell'URL deve
aggiornare il proprio ref **nel gestore dell'evento**, non solo al render dopo.
Con un solo cambio e la mappa ferma, il valore sbagliato resta nell'URL per
sempre. Riguardava l'interruttore delle isolinee **e la tavolozza**, che nessun
test copriva.

**Se l'onda di ADRIAC contenga il mare lungo NON LO SAPPIAMO, e la prova e'
scritta qui sotto.** (Il 2026-08-21 questa voce diceva "e' solo mare di vento":
era piu' forte di quello che c'era in mano, ed e' stata corretta lo stesso
giorno.)

Cosa e' accertato:

- il file d'onda porta **tre campi e nient'altro**: altezza significativa
  totale, direzione media, periodo di picco. **Nessuna partizione spettrale**,
  quindi anche se il mare lungo fosse dentro `Hwave` non sarebbe separabile:
  un metro di mare di vento e un metro di onda lunga sono indistinguibili;
- l'attributo `wind-induced significant wave height` **non e' una prova**: e' la
  stringa che ROMS scrive per `Hwave` a prescindere dal contenuto, non una
  dichiarazione di ARPAE. Gli attributi globali sono otto righe di metadati CF,
  nessuna traccia della configurazione della corsa;
- la catena ARPAE che il mare lungo ce l'ha e' **annidata dal Mediterraneo**
  (25 km -> 8 km -> 800 m), ed e' un altro modello: fino al 2024 SWAN-MEDITARE,
  poi WW3-MEDITA. Non e' una contraddizione fra le pagine ARPAE, e' un cambio di
  modello. Il suo dato aperto **e' morto**: `swanemr/` risponde ma ha nove file,
  l'ultimo del 30/09/2025, e WW3-MEDITA non ha directory pubblica;
- **indizio interno, non conclusivo**: nei momenti in cui l'onda entra dal bordo
  sud (direzione da ~172 gradi), al bordo l'altezza e' 9 cm e **cresce** a 24
  andando dentro. Se il bordo portasse un mare da fuori, l'altezza sarebbe
  massima al bordo, non minima. Punta verso "niente entra", ma non lo dimostra;
- **perche' non e' dimostrato**: in tutto l'archivio (9-22 agosto 2026), su tre
  punti da Otranto a Rimini, il periodo dell'onda lunga non arriva mai a 5
  secondi. Non c'e' nessun evento di mare lungo, quindi non c'era niente che
  potesse entrare.

**La prova, da eseguire al primo evento vero** (serve solo pazienza, non un
account):

1. sorvegliare l'API **Open-Meteo Marine** (gratuita, senza chiave, e porta le
   partizioni): `https://marine-api.open-meteo.com/v1/marine?latitude=40.6&longitude=18.7&hourly=wave_height,wind_wave_height,swell_wave_height,swell_wave_period`;
2. aspettare un'ora con `swell_wave_height` sopra 0,5 m **e**
   `swell_wave_period` sopra 6 s nel basso Adriatico;
3. in quell'ora confrontare `Hwave` di ADRIAC nella stessa cella con il
   **totale** e con la **sola componente di vento** di Open-Meteo. Se ADRIAC
   somiglia alla componente di vento ed e' molto sotto il totale, il mare lungo
   non c'e'. Se somiglia al totale, c'e' ed e' solo indistinguibile.

**Conseguenza pratica, valida in ogni caso**: la mappa mostra un'altezza d'onda
senza dire di quale onda si tratta, e nel dubbio va detto. Se il mare lungo non
c'e', la mappa sottostima proprio nel caso piu' insidioso per chi va in barca
(onda lunga con vento calmo). L'alternativa vera, se un giorno serve, e'
**Copernicus Marine** `MEDSEA_ANALYSISFORECAST_WAV_006_017`: orario, 1/24 di
grado (circa 4,6 km, quattro volte piu' grosso del nostro), e porta le
partizioni dichiarate (`VHM0` totale, `VHM0_WW` vento, `VHM0_SW1` onda lunga).

**`Dwave` e' la direzione DA CUI l'onda viene** (convenzione nautica, gradi orari
da nord), e il file **non lo dichiara**: l'attributo dice solo `wind-induced wave
direction - mean` in gradi. Ricavato dal dato il 2026-08-20, con un fatto fisico:
l'onda cresce mentre viaggia, quindi il gradiente dell'altezza punta nel verso in
cui si propaga. Su quattro istanti indipendenti lo scarto fra `Dwave` e la rotta
di crescita e' 150-177 gradi, cioe' mezzo giro. Preso al contrario avrebbe
capovolto ogni freccia della mappa senza che nulla sembrasse sbagliato.

**Il campo `sealevel` contiene la marea.** Verificato il 2026-08-20 estraendo la
serie temporale e cercandone le periodicita': il periodo dominante e' **12,03 h**
(semidiurno) con una seconda componente a 24,06 h, in tutti e tre i punti
provati. La firma che conferma che il segnale e' quello vero e' geografica:
l'ampiezza cresce andando a nord, da +-13 cm al largo di Bari a +-22 al largo di
Rimini a +-35 davanti a Venezia, cioe' l'onda di marea che si amplifica contro
l'estremita' chiusa del bacino. **Non e' pero' solo marea**: e' il livello
totale, marea astronomica piu' contributo meteorologico (vento che ammassa acqua
contro la costa, pressione). D'estate il secondo pezzo e' piccolo; l'acqua alta e'
quando si somma al primo. Nota pratica: l'**analisi** del livello del mare e' a
passo di **10 minuti** (1440 istanti in dieci giorni), non oraria come le altre
grandezze, quindi su questa lo scorrimento nel passato e' sei volte piu' fine.

**L'ora di pubblicazione ARPAE oscilla di sei ore, e il file delle onde e' fra
gli ultimi.** I primi file della giornata escono alle 09:00 in punto tutti i
giorni, ma `his_HPDwave_fc` e' in fondo alla catena: misurato su sette giorni
consecutivi, fra le 09:33 e le 15:31. Il commento nel workflow diceva "verso le
10:30", che e' vero per i primi file e falso per quello che ci serve. ADRIAC
pubblica **un solo ciclo al giorno** (16 file, sempre gli stessi nomi, con la
sola data nel nome), quindi ingerire piu' spesso non allunga l'orizzonte: chiude
la finestra cieca fra pubblicazione e ingestione.

**Il selettore universale `*` non raggiunge gli pseudo-elementi.** `* { box-sizing:
border-box }` lascia `::before` e `::after` a `content-box`, quindi un bordo si
aggiunge alla larghezza dichiarata invece di starci dentro. L'anello del punto
osservato e' finito 2 px in basso a destra perche' il suo scarto negativo era
calcolato sul modello sbagliato. Corollario: **quello che deve essere misurato da
un test sia un elemento vero**, perche' su uno pseudo-elemento `getComputedStyle`
da' la larghezza dichiarata e non quella usata, e un test che ricostruisce la
scatola ripete l'assunzione che ha causato il difetto.

**Un test che passa può passare per il motivo sbagliato.** Il test di resa
verificava "il campo non copre la terraferma" leggendo un pixel che cadeva fuori
dal canvas di destinazione (creato senza `width` e `height`, quindi 300x150 per
specifica). Tornava nero, l'asserzione passava, e non stava verificando niente:
proprio il difetto per cui quel test esiste. Prima di fidarsi di un'asserzione
verde, **rimettere il difetto e guardarla diventare rossa**.

**Il bundle compilato e' un altro programma.** Le isolinee non si vedevano in
produzione mentre funzionavano in sviluppo: MapLibre costruisce il proprio worker
concatenando il *testo sorgente* delle proprie funzioni, e rolldown ne elimina una
lasciandone in piedi il riferimento, quindi in una build **ogni sorgente GeoJSON
smette di caricare in silenzio** (`ReferenceError` dentro un worker, niente a
schermo). Corretto caricando il worker di MapLibre come file vero (`?url`).
Tutti i test end to end giravano sul dev server e nessuno poteva vederlo: adesso
`e2e/build.spec.ts` gira su `vite preview`. Prima di dire che una cosa funziona,
**guardare quello che gli utenti scaricano**, non quello che serve Vite.

**Un contesto WebGL non conserva il buffer di disegno dopo la composizione.**
Rileggere il canvas con `drawImage` o `getImageData` dà nero, anche quando a
schermo si vede tutto. Non è una stranezza dell'ambiente di test: serve
`preserveDrawingBuffer: true` alla creazione della mappa, e va acceso solo nei
test perché costa prestazioni.

**Strozzare solo in entrata perde l'ultimo valore.** Vale per il tempo e per il
mouse: se una chiamata cade dentro la finestra e non ne seguono altre, quel
valore non arriva mai e chi guarda resta con un'informazione vecchia a tempo
indefinito. Serve consegnare l'ultimo valore alla chiusura della finestra. Il
difetto è stato commesso due volte in due moduli diversi prima di capirlo.


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

**Nessuna grandezza a schermo deve dipendere da dove cadono i campioni.** Tre
tentativi, tre difetti diversi, la stessa causa. Contando i vicini validi sul
texel piu' vicino, l'opacita' resta costante dentro la cella e lungo la costa
compaiono riquadri da 1.200 m. Sfumando in base alla densita' del vicinato, i
filamenti larghi una cella (dato vero) compaiono a perline: erano i rombi davanti
al delta. Usando la distanza dal campione valido piu' vicino, che dentro il dato
e' la distanza dal centro del texel, l'opacita' diventa **periodica** e disegna
una scacchiera su tutto il mare aperto. Regola: l'opacita' si misura sulla
distanza dal **bordo** del dato, che dentro e' costante. E il difetto continuo ma
periodico e' il piu' pericoloso dei tre, perche' non salta all'occhio come un
blocco e sopravvive alle revisioni.

**Il campo va ritagliato sulla costa vera, non su quella del modello.** Senza
ritaglio copriva fino a 2 km di terraferma, per due cause sommate: lo shader che
dipingeva se **uno qualunque** dei quattro vicini era valido (1.200 m), e gli 800
m di sbordamento che l'ingestore mette di proposito. Il ritaglio si fa con una
maschera di **distanza con segno** dalla costa, non con una maschera binaria.
Dettaglio nella spec 7.3, ricetta in `strumenti/costa_sdf.py`.

**Le scritte coperte dal campo non si risolvono allontanandolo dalla costa.**
I nomi di baie, porti e isole stanno sotto il campo ovunque, non solo a riva. Si
risolvono mettendo il campo sotto i livelli di etichetta, che richiede una
basemap **vettoriale**: con una raster la tile e' un'immagine sola. Il margine
dalla riva (250 m) serve per i moli e la battigia, che sono un problema diverso.

**Il margine dalla riva va in metri, non in pixel di schermo.** In pixel sembra
giusto perche' la leggibilita' si misura sullo schermo, ed e' giusto per le
scritte. Ma quello che il campo copre a riva sono moli e porti, che sono oggetti
geografici: un margine in pixel vale sempre meno metri man mano che si
ingrandisce, quindi la struttura resta coperta proprio allo zoom a cui la si
guarda. In metri si scopre a ogni zoom e a zoom basso il margine scende sotto il
pixel da solo, senza bisogno di tetti.

**Il ritaglio va preso dalla stessa costa che disegna la basemap.** Non perche'
una sorgente sia piu' esatta: perche' l'occhio confronta il campo con la costa
che vede sotto, e qualunque scarto si legge come errore del campo. Con GSHHG il
campo sbordava sulla terraferma disegnata fino a 1.138 m a Venezia e 847 m sul
delta; con la costa OSM gli stessi punti scendono a 161 e 121 m, e a Unije a
zoom 13 la sovrapposizione oltre i 100 m passa da 3.260 pixel a **zero**. La
sorgente e' `coastlines-split-4326` di osmdata.openstreetmap.de. Resta il
disaccordo a zoom bassi, dove sono le **tile** a semplificare la costa.

**Il segno di una maschera va preso da una sorgente sola.** Prendendolo da OSM
vicino a riva e da GSHHG oltre 1,6 km si risparmiava calcolo, ma nella laguna di
Venezia le due coste dissentono di ben piu' di 1,6 km e il bacino di San Marco
diventava terraferma. Due sorgenti per la stessa grandezza fanno una cucitura, e
la cucitura cade sempre dove le sorgenti non sono d'accordo.

**Un campo di distanza costruito su una maschera rasterizzata non e' un campo di
distanza.** La prima generazione dell'asset era la trasformata di distanza di una
maschera a 240 m, e passava per buona: si interpola, e' continua, il commento nel
codice citava perfino i font SDF. Ma sotto i 500 m conteneva **quattro valori in
tutto** (240, 339, 480, 537) e **nessuno sotto i 240 m**: l'informazione
sub-texel era gia' distrutta, il livello zero era la scaletta della
rasterizzazione, e a zoom 14 la riva di Unije aveva gradini di 68 pixel.
Misurando la distanza dai **segmenti** i valori distinti sotto i 500 m diventano
223.821 e il gradino piu' lungo scende a 7 pixel. In piu' la vecchia maschera era
sfalsata di mezzo texel verso il mare, cioe' gonfiava la terraferma di 120 m su
tutte le coste: era quello il bordo di mare non dipinto attorno alle isole.
Diagnosi in una riga: **istogramma dei valori vicino allo zero**. Se sono pochi e
discreti, viene da una maschera.

**La y di MapLibre cresce verso sud, la riga 0 del frame e' a nord.** Senza un
ribaltamento esplicito nella coordinata di texture il campo si disegna capovolto,
e l'errore **sembra plausibile**: resta una macchia della forma giusta su un mare.
Verificato il 2026-08-18 con la fetta verticale, dove l'Adriatico correva da
Belgrado a Napoli. Per questo lo smoke test di resa deve asserire la posizione di
un pixel noto, non solo che qualcosa sia stato disegnato.

**Il dataset `swanemr` è morto.** Il CKAN `dati.arpae.it` lo elenca ancora sotto `previsioni-mare`, ma la directory è ferma a settembre 2025. Non perderci tempo.

**Il CKAN `dati.arpae.it` è quasi inutile per il mare.** Una sola ricerca utile su 259 dataset. I dati veri stanno su `dati-simc.arpae.it/opendata/`, che è un indice Apache senza API.

**Un hook blocca i trattini lunghi.** Scrivere un file che li contiene fallisce con "Contenuto bloccato". Attenzione al caso ricorsivo: anche *citare* il carattere per documentare il divieto fa fallire la scrittura. Costa una riscrittura completa del file se ci si accorge tardi.

**`netCDF4`, `numpy`, `scipy` non sono installati a livello di sistema.** Usare `uv run --with netCDF4 --with numpy python -c ...` per le ispezioni al volo. `ncdump` e `gdalinfo` non esistono su questa macchina.

## 7. Stato git

- Repo unico: `/Users/ale/source/personal/stato_del_mare`
- Branch corrente: `develop` (nessun `main` locale)
- Remote: `origin` = `git@github.com:madAle/stato_del_mare.git`
- **`develop` è allineato a `origin/develop`**, albero pulito (verificato il 2026-08-21)
- **`main` è alla pubblicazione del 2026-08-21** (commit `18ee36f`), verificata aprendo il sito: cinque grandezze nel selettore, 269 isolinee, 2000 particelle, zero errori in console. I commit di sola documentazione fatti dopo **non hanno bisogno di essere pubblicati**: `main` resta indietro di quelli, ed è corretto
- **La pubblicazione è `git push origin develop:main`**, che fa scattare il workflow `Deploy`. `main` non esiste in locale: si spinge `develop` sul suo posto
- `feat/ingestore` è stato unito con un merge non fast-forward e cancellato in locale. Resta su `origin` come `origin/feat/ingestore`: se servisse rileggere la storia dell'esecuzione commit per commit, è lì.
- Lo spazio di lavoro `.superpowers/sdd/2026-08-13-ingestore/` è stato cancellato a lavoro concluso. I documenti che contavano erano già stati copiati in `docs/superpowers/revisioni/`.

Comandi di verifica:

```bash
uv run ruff check .
uv run pytest            # suite predefinita, i test di rete restano esclusi
uv run pytest -m rete    # coerenza contro l'archivio ARPAE, scarica circa 23 MB per test
npm --prefix web run typecheck && npm --prefix web test
cd web && npx playwright test
```

**Verificare una pubblicazione guardando il sito, non il workflow.** Che il
Deploy esca verde dice che il caricamento non ha fallito, non che online ci sia
un'applicazione che funziona: in produzione le isolinee sono state assenti per un
giorno con tutti i workflow verdi. La verifica si fa aprendo
<https://stato-del-mare.pages.dev> in un browser vero e contando le cose
(isolinee, particelle, errori in console). Attenzione anche alla propagazione:
subito dopo un deploy un nodo di rete può servire ancora la versione precedente,
e si riconosce dai sintomi della versione vecchia.
