# Stato del Mare, design

Data: 2026-08-13
Stato: approvato in brainstorming, da tradurre in piano di implementazione

## 1. Obiettivo

Mappa interattiva dello stato del mare in Adriatico basata sui dati pubblici ARPAE,
con navigazione temporale avanti e indietro e riproduzione automatica.

Il sistema è composto da due programmi indipendenti:

- un **ingestore** in Python che gira una volta al giorno, scarica i dati ARPAE,
  li normalizza e li deposita su object storage;
- una **SPA** in React che legge quegli artefatti e li disegna su una mappa.

Non esiste un backend applicativo. Il dato è di sola lettura, si aggiorna a lotti
una volta al giorno, e le modalità di interrogazione sono note in anticipo: le tre
condizioni in cui un application server sarebbe cerimonia. La logica che in
un'architettura tradizionale starebbe a request-time vive nell'ingestore, a
build-time, dove è più facile da eseguire, rilanciare e correggere.

### Scope del primo rilascio

A schermo: **solo altezza d'onda significativa**, timeline con riproduzione
automatica, mappa navigabile.

In archivio: **tutti i campi 2D disponibili** più i profili verticali sulle stazioni.

L'asimmetria è deliberata ed è il principio guida del progetto (vedi 3.1).

### Fuori scope, previsto per dopo

Layer di direzione e periodo d'onda, correnti, livello del mare; marker e serie
storiche delle stazioni; visualizzazione della colonna d'acqua; confronto
previsione/analisi con mappe di differenza; ingestione dell'archivio storico
osservato dal 2006.

Il modello dati e il formato del pacchetto sono progettati fin d'ora per reggerli
tutti senza modifiche retroattive.

## 2. Fonti dati

Tutte le affermazioni di questa sezione sono state verificate scaricando i file,
non dedotte dalla documentazione.

### 2.1 ADRIAC, modello oceanografico

`https://dati-simc.arpae.it/opendata/adriac/`

Modello ROMS sull'Adriatico, risoluzione 1 km, NetCDF3 classic compresso gzip.
Un file per giorno, per gruppo di variabili, per tipo.

Nomenclatura: `{YYYYMMDD}_adriac_1km_{output}_{gruppo}_{tipo}.nc.gz`
dove `tipo` è `an` (analisi) o `fc` (previsione).

**Griglia**: curvilinea, `eta_rho=752 x xi_rho=272 = 204.544` celle, orientata
lungo l'asse dell'Adriatico. Estensione 10,8437 a 20,0915 E e 39,7624 a 46,3916 N.
121.543 celle di mare (59,4%), il resto terra. Batimetria (`h`) da 1,5 a 1.245,9 m.
30 livelli verticali sigma (`s_rho`), terrain-following, con `Cs_r` e `hc` per la
conversione in metri.

**Ritenzione: 8 giorni.** I file più vecchi vengono cancellati. Questo è il vincolo
più importante dell'intero progetto (vedi 3.1).

**Copertura temporale**, verificata sui file del 2026-08-13:

| Gruppo | Variabili | `an` | `fc` |
|---|---|---|---|
| `his_HPDwave` | `Hwave` [m], `Dwave` [gradi], `Pwave_top` [s] | 24 step orari, D-1T01 a DT00 | 72 step orari, DT01 a D+3T00 |
| `his_2dcur` | `ubar_eastward`, `vbar_northward` [m/s] | 24 step orari | 72 step orari |
| `qck_sl` | `sea_level` [m], float64 | 144 step, passo 10 min | 432 step, passo 10 min |
| `his_temp` | `temp` [C], 30 livelli | 24 step orari | 72 step orari |
| `his_salt` | `salt`, 30 livelli | 24 step orari | 72 step orari |
| `his_cur` | correnti 3D, 30 livelli | 24 step orari | 72 step orari |
| `avg_*` | come sopra ma media giornaliera | 1 step | non presente |

**Trappola verificata**: il file di analisi datato `D` contiene i dati di `D-1`.
I frame vanno datati sul contenuto di `ocean_time`, mai sul nome del file.

**Nota utile**: `ubar_eastward` e `vbar_northward` sono già proiettate su est/nord.
Non serve ruotare i vettori dalla griglia curvilinea.

Dimensioni tipiche (compresse, per giorno):

| File | `an` | `fc` |
|---|---|---|
| `his_HPDwave` | 23 MB | 63 MB |
| `his_2dcur` | 24 MB | ~72 MB |
| `qck_sl` | 126 MB | 379 MB |
| `his_temp` | 293 MB | 874 MB |
| `his_salt` | 259 MB | 771 MB |
| `his_cur` | 640 MB | 1,9 GB |

### 2.2 Stazioni osservate

`https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl`
`https://dati-simc.arpae.it/opendata/osservati/meteo/storico/{YYYY-MM}.json.gz` (dal 2006)

Formato JSONL con codici variabile BUFR/DB-All.e. Reti rilevanti: `boa`, `marefe`.

Stazioni marine individuate (22 nel campione realtime):

| Rete | Nome | Lat, Lon | Note |
|---|---|---|---|
| `boa` | Nausicaa 2 | 44,2146 / 12,4759 | Boa ondametrica direzionale, 12 variabili |
| `boa` | Calipso | 44,4287 / 12,5218 | 7 variabili |
| `boa` | Cervia Porto, Cattolica Porto | costa romagnola | Livello (`B22037`) |
| `marefe` | Porto Garibaldi, Faro, Bellocchio, Logonovo, Punta Volano, Gorino 2, Po di Goro, Manufatto | Delta del Po | Livello, temperatura acqua, salinità, pH, ossigeno disciolto |

Codici BUFR ricorrenti: `B22070` altezza significativa, `B22071` periodo di picco,
`B22073` altezza massima, `B22074` periodo medio, `B22001` direzione,
`B22043` temperatura acqua, `B22037` livello, `B22062` salinità, `B12101`
temperatura aria.

Nessuna boa ARPAE misura profili verticali: le colonne d'acqua saranno sempre
dati di modello, e vanno etichettate come tali nella UI.

### 2.3 Fonti scartate

`previsioni-mare` su `dati.arpae.it` (CKAN) rimanda anche a GRIB SWAN in
`https://dati-simc.arpae.it/opendata/swanemr/`, ferma a settembre 2025.
Considerata abbandonata.

## 3. Principi

### 3.1 L'ingestione è golosa, la visualizzazione è minimale

ADRIAC cancella dopo 8 giorni. Un giorno in cui non ingeriamo una variabile è un
giorno perso per sempre. Un layer non visualizzato si aggiunge in mezza giornata.

I due costi sono asimmetrici, quindi le due decisioni sono separate: catturiamo
tutto ciò che costa poco fin dal primo run, mostriamo solo l'altezza d'onda.

### 3.2 L'archivio non sovrascrive mai

Analisi e previsioni della stessa ora coesistono su percorsi diversi. La precedenza
(l'analisi vince) è una regola di **visualizzazione** applicata dal client, mai di
storage. Applicarla in scrittura distruggerebbe la possibilità di confrontare
previsione e realtà, che è metà del valore scientifico del progetto.

### 3.3 Riconciliazione, non "scarica oggi"

L'ingestore confronta la finestra sorgente con il contenuto del bucket e colma la
differenza. Ne consegue che è idempotente e che recupera da solo dopo un guasto,
finché il guasto dura meno di 8 giorni.

### 3.4 Fermarsi è meglio che sbagliare

Di fronte a un'incoerenza strutturale (griglia cambiata, unità cambiate) il job si
ferma senza scrivere. Un giorno mancante si recupera; un mese di dati sbagliati in
archivio permanente no.

### 3.5 Il pacchetto è un contratto durevole

I dati su object storage devono essere decodificabili fra anni senza il codice che
li ha scritti: manifest versionato, unità e fattori di scala nel dato, provenienza
tracciata, e l'obbligo che l'ingestore sappia rileggere ogni versione passata dello
schema.

## 4. Modello dati e formato del pacchetto

### 4.1 Identità di un frame

```
(variabile, tipo, istante_di_riferimento, istante_valido)
```

`istante_di_riferimento` è il run ADRIAC di provenienza. Serve perché la stessa ora
valida viene prodotta fino a quattro volte: una dall'analisi e tre da run di
previsione successivi (orizzonte 72 h). Senza, il confronto per scadenza è
impossibile.

### 4.2 Layout sul bucket

```
grid.json                                       descrittore del raster di destinazione
catalog.json                                    variabili, intervalli, scale, colormap
index/{var}/{kind}/{YYYY-MM}.json               ore disponibili, un file per mese
frames/{var}/{kind}/{ref}/{YYYY-MM-DDTHH}.bin   campo, int16 gzip
runs/{YYYY-MM-DD}/{kind}/manifest.json          contratto d'archivio del run
static/bathymetry.bin                           batimetria, scritta una volta
static/regrid_index.npz                         indice di ricampionamento, cache
stations/stations.json                          anagrafica
stations/{id}/columns/{YYYY-MM}.bin             profili sigma grezzi
stations/{id}/obs/{YYYY-MM}.json                osservazioni misurate
```

Convenzioni sui segnaposto: `{var}` è l'id di variabile della tabella in 4.3,
`{kind}` è `an` o `fc`, `{ref}` è l'istante di riferimento in forma `YYYYMMDD`,
`{YYYY-MM-DDTHH}` è l'istante valido in UTC.

Un file per frame, non un pacchetto giornaliero: i frame sono immutabili, quindi
`Cache-Control: public, max-age=31536000, immutable`, e il client scarica solo le
ore che gli servono.

Il catalogo si scrive **per ultimo**, sempre. Se il run muore a metà il client non
vede ancora i dati nuovi, invece di vedere un catalogo che promette frame
inesistenti. Nessuna transazione necessaria.

### 4.3 Codifica dei frame

int16 little-endian, gzip, caricato su R2 con `Content-Encoding: gzip`.

Quest'ultimo dettaglio elimina codice dal client: il browser decomprime in modo
trasparente, quindi `fetch().arrayBuffer()` restituisce già byte in chiaro, pronti
per `new Int16Array(buffer)`. Nessuna libreria di decompressione.

Valore fisico: `valore = raw * scale + offset`, con `scale` e `offset` nel catalogo,
mai nel codice. Nodata: `-32768`.

Scale iniziali:

| Variabile | id | scale | Unità | Note |
|---|---|---|---|---|
| Altezza d'onda significativa | `hwave` | 0,001 | m | risoluzione mm, fondoscala ~32 m |
| Periodo di picco | `pwave` | 0,01 | s | |
| Direzione d'onda | `dwave_sin`, `dwave_cos` | 0,0001 | adimensionale | due array, vedi sotto |
| Corrente est | `ubar` | 0,001 | m/s | |
| Corrente nord | `vbar` | 0,001 | m/s | |
| Livello del mare | `sealevel` | 0,001 | m | |

**Le direzioni si memorizzano come seno e coseno, mai come angolo.** 359 e 1 grado
sono adiacenti, ma la loro media lineare è 180, cioè la direzione opposta. Sia il
ricampionamento in ingestione sia l'interpolazione nello shader sbaglierebbero.
L'angolo si ricompone con `atan2` a valle.

### 4.4 Griglia di destinazione

`grid.json` definisce il raster in Web Mercator (EPSG:3857): bbox, larghezza,
altezza, risoluzione. Alla risoluzione nativa del modello (~900 m/px) sono circa
850 x 1.000 celle: **una texture sola, nessuna piramide di tile**, ben dentro i
limiti GPU di qualsiasi dispositivo.

Web Mercator e non lat/lon regolare perché la mappa è una slippy map: alle nostre
latitudini la deformazione mercatoriana sull'altezza del dominio è circa il 30%, e
un raster equirettangolare risulterebbe schiacciato verso nord.

Il descrittore è versionato. Un eventuale cambio di risoluzione produce
`grid_v2.json`; i frame vecchi restano leggibili perché referenziano il proprio.

### 4.5 Manifest

Ogni run scrive:

```json
{
  "schema_version": 1,
  "ingested_at": "2026-08-13T11:20:00Z",
  "ingest_version": "0.1.0",
  "source": {
    "url": ".../20260813_adriac_1km_his_HPDwave_an.nc.gz",
    "sha256": "...", "bytes": 24117248,
    "last_modified": "2026-08-13T10:34:00Z"
  },
  "reference_time": "2026-08-13T00:00:00Z",
  "kind": "an",
  "grid": "grid.json",
  "frames": [
    {"var": "hwave", "valid_time": "2026-08-12T01:00:00Z",
     "path": "frames/hwave/an/20260813/2026-08-12T01.bin",
     "sha256": "...", "scale": 0.001, "offset": 0.0,
     "min": 0.02, "max": 1.87, "nodata_count": 729412, "clipped_count": 0}
  ]
}
```

`min` e `max` per frame servono al client per la scala di colore senza dover
scandire l'array a ogni cambio di istante. `clipped_count` è un segnale di
allarme: se supera zero, la scala scelta è sbagliata.

La deduplica cade fuori gratis: prima di lavorare un file, si confronta il suo
checksum con quello registrato nel manifest corrispondente. Uguale significa salta.

### 4.6 Profili verticali sulle stazioni

Catturati fin da subito, senza UI. Per ogni stazione, la cella di mare ADRIAC più
vicina; per ogni ora, i 30 valori sigma di temperatura, salinità e correnti,
salvati **grezzi**, senza conversione in metri.

Rimandare la conversione è deliberato: `s_rho`, `Cs_r`, `hc` e la batimetria sono
statici e già archiviati, quindi la profondità reale si ricostruisce in qualunque
momento. Rimandiamo la parte difficile senza perdere il dato.

Solo da file di **analisi**: i profili da previsione costerebbero circa 2,8 GB al
giorno di download aggiuntivo per un caso d'uso non previsto.

### 4.7 Livello del mare, risoluzione asimmetrica

La sorgente è a 10 minuti. Conserviamo la piena risoluzione **solo per l'analisi**;
la previsione la campioniamo a passo orario tenendo solo gli step al minuto 00,
scartando gli altri cinque **senza mediarli** (una media cambierebbe la natura
fisica del dato rispetto agli altri layer, che sono valori istantanei).

L'asimmetria riflette una differenza reale fra i due tipi. L'analisi è il documento
permanente: è l'unica ricostruzione di com'era davvero il mare quel giorno, e le
acque alte e le maree meteorologiche sono precisamente i fenomeni in cui il
dettaglio sotto l'ora conta. La previsione è effimera: viene superata dall'analisi
entro tre giorni, e il suo valore residuo è documentare cosa ci aspettavamo, non
cosa è successo. Per quello il passo orario è abbondante, e sono i tre quarti del
costo.

Cosa perdiamo sulla previsione: nulla di strutturale. Il passo orario resta
sufficiente per le maree (periodo circa 12 h) e per la sessa adriatica (circa
21,5 h il modo fondamentale, circa 10,9 h il secondo). Il dettaglio a 10 minuti
serve alla dinamica veloce della marea meteorologica, che sul ramo previsionale ha
scarso valore d'archivio.

**Conseguenza sulla UI**: il layer `sealevel` ha, in analisi, sei volte gli istanti
degli altri. La timeline resta oraria e mostra gli istanti orari; gli step
intermedi restano nell'archivio, raggiungibili quando (e se) verrà costruita una
vista a risoluzione fine. Il dato è catturato in ogni caso, che è il punto.

### 4.8 Volumi

Frame prodotti al giorno, a ingestione completa:

| Gruppo | Array | `an` | `fc` | Totale |
|---|---|---|---|---|
| Onde (`hwave`, `pwave`, `dwave_sin`, `dwave_cos`) | 4 | 96 | 288 | 384 |
| Correnti (`ubar`, `vbar`) | 2 | 48 | 144 | 192 |
| Livello (`sealevel`: `an` a 10 min, `fc` orario) | 1 | 144 | 72 | 216 |
| | | | | **792** |

Frame compresso circa 125 KB (850.000 celle int16, di cui circa il 65% nodata che
comprime a quasi nulla). Quindi **circa 99 MB al giorno, circa 36 GB all'anno**.

I 10 GB gratuiti di R2 si esauriscono verso il terzo mese e mezzo; da lì il costo è
0,015 dollari per GB al mese, cioè circa 40 centesimi al mese a fine primo anno, in
crescita di altrettanto ogni anno.

Download giornaliero dell'ingestore: circa 1,9 GB (86 MB onde, 96 MB correnti,
505 MB livello, 1,19 GB profili 3D da sola analisi).

Profili stazioni: circa 130 KB al giorno, circa 50 MB all'anno. Trascurabile.

## 5. Ingestore Python

### 5.1 Passi

```
1. Elenca la directory sorgente          parsing indice HTML: nome, size, last-modified
2. Leggi i manifest sul bucket           cosa possediamo, con quali checksum
3. Calcola la lista di lavoro            differenza fra i due insiemi
4. Per ogni file da lavorare:
     scarica, sha256, apri NetCDF
     verifica hash coordinate e unità    (vedi 6.1)
     per ogni variabile, per ogni istante:
       ricampiona, quantizza int16, gzip, carica
     estrai le colonne sigma (solo file `an` 3D)
     scrivi il manifest del run
     cancella il file locale
5. Rigenera index/{var}/{kind}/{mese}.json
6. Rigenera catalog.json                 sempre per ultimo
```

### 5.2 Indice di ricampionamento

La geometria è identica ogni giorno, quindi la corrispondenza cella Mercator verso
cella ROMS si calcola una volta e si riusa. Cache su `static/regrid_index.npz`.

Costruzione: `scipy.spatial.cKDTree` sulle **sole 121.543 celle di mare**,
interrogato con i centri delle celle di destinazione, distanza massima 1,5 km.
Vicino più prossimo, non interpolazione.

Costruire l'albero solo sul mare garantisce che **nessun valore attraversi la
costa**. Un'interpolazione bilineare in ingestione medierebbe celle di mare con
celle di terra mascherate, producendo onde artificialmente smorzate lungo tutta la
linea di costa, cioè dove il dato interessa di più. La scalettatura residua del
nearest-neighbour viene smussata a valle dall'interpolazione nello shader.

### 5.3 Memoria e disco

I file 3D di previsione arrivano a 1,9 GB compressi (circa 4,7 GB scompattati)
contro i 14 GB di disco di un runner GitHub. Si lavora **un file alla volta**,
cancellandolo prima del successivo.

Per i profili si legge la fetta `variabile[t]` intera (24,5 MB) una volta per
istante e si indicizza in memoria, invece di fare 22 letture strided per ora: su
NetCDF3 contiguo è nettamente più veloce e la memoria di picco resta bassa.

### 5.4 Esecuzione

GitHub Actions, cron alle **12:00 e 18:00 UTC**. I file ADRIAC compaiono verso le
10:30 e le 10:40 UTC; il primo run ha un'ora e mezza di margine, il secondo è rete
di sicurezza e quasi sempre un no-op che costa qualche `HEAD`.

**Il repository va tenuto pubblico**: su repo pubblici i minuti di Actions sono
illimitati. Le credenziali R2 stanno nei secret, che restano privati.

### 5.5 Struttura

```
ingest/
  config.py      elenco variabili, endpoint, parametri di griglia
  source.py      listing ARPAE, HEAD, download verificato
  grid.py        costruzione e cache dell'indice di ricampionamento
  encode.py      quantizzazione int16, gzip, direzioni in sin/cos
  frames.py      campi 2D verso frame
  profiles.py    colonne sigma sulle stazioni
  stations.py    parsing BUFR di realtime.jsonl
  storage.py     client R2 (boto3): put con Content-Encoding, head
  manifest.py    lettura/scrittura manifest, deduplica
  catalog.py     generazione di index/ e catalog.json
  reconcile.py   orchestratore
```

CLI: `python -m ingest reconcile [--dry-run] [--window 8d] [--only hwave] [--force]`

`encode.py` e `grid.py` sono funzioni pure: dentro array, fuori array. `source.py` e
`storage.py` sono gli unici che parlano col mondo esterno e gli unici da stubbare
nei test.

## 6. Errori e casi limite

### 6.1 Il fallimento critico: griglia cambiata

Se ARPAE riconfigura il dominio o aggiorna ROMS, `lon_rho` e `lat_rho` cambiano e
l'indice in cache produce **frame plausibili con i valori nel posto sbagliato**.
Non genera errori; genera dati corrotti che entrano in archivio permanente e sono
indistinguibili da quelli buoni.

Difesa: l'indice memorizza lo SHA-256 delle matrici di coordinate sorgente,
ricalcolato e confrontato a ogni run. Mismatch significa job fermo senza scrivere.
Stesso trattamento per un cambio di unità o di nome variabile, che il manifest
registra dal NetCDF e confronta con l'atteso.

### 6.2 Gli altri

| Situazione | Comportamento |
|---|---|
| File sorgente non ancora pubblicato | Non è un errore. Salta, riprova al run dopo. |
| Download interrotto, checksum errato | 3 tentativi con backoff, poi salta e logga. |
| NetCDF corrotto, variabile assente | Salta quel file, gli altri proseguono. |
| Upload interrotto a metà | I frame caricati restano (immutabili); senza manifest, il run dopo rilavora e riscrive identico. |
| Valori fuori range int16 | Clip, conteggio nel manifest (`clipped_count`). |
| Stazione senza cella di mare entro 1,5 km | Salta con log. Possibile per le stazioni lagunari. |

Nessuno richiede intervento umano: la riconciliazione li assorbe al run successivo.

### 6.3 Notifica dei guasti

Mail automatica di GitHub Actions al fallimento del workflow. Nessun altro
meccanismo in v1.

### 6.4 Frontend

- **Frame mancante**: buco visibile nello scrubber; in riproduzione si tiene
  l'ultimo frame valido con badge esplicito. Mai fingere che ci sia un dato.
- **WebGL2 assente**: messaggio chiaro, non pagina bianca.
- **Catalogo irraggiungibile**: errore esplicito con ricarica.
- **Catalogo aggiornato a pagina aperta**: refetch ogni 15 minuti, merge non
  distruttivo, l'arrivo di dati nuovi non sposta il cursore dell'utente.
- **Tutto in UTC internamente**, formattazione locale solo al disegno.

## 7. SPA

### 7.1 Tre strati

```
src/ui/     React: scrubber, play/pausa, legenda, selettore layer
            stato: { validTime, variable, playing, speed }
                | chiamate imperative
                | callback throttled a ~10 Hz
src/map/    TS puro: MapLibre, custom layer WebGL, ciclo rAF, shader
                | getFrame(var, kind, ref, valid)
src/data/   TS puro: fetch da R2, cache LRU, prefetch, risoluzione sorgente
```

**React non gira mai a 60 fps.** Il ciclo di animazione vive in `src/map/` e
riporta il tempo corrente a React al massimo dieci volte al secondo, per far
seguire il cursore.

I due strati che contano non conoscono React: sono testabili in Node e il framework
resta la parte sostituibile.

### 7.2 src/data

**Risoluzione della sorgente**: dato un istante valido, sceglie quale frame
mostrare, cioè l'analisi se esiste altrimenti la previsione più recente. Funzione
pura.

**Cache**: LRU **a byte**, non a conteggio. Un frame pesa 125 KB in rete ma
1,7 MB decodificato. Budget circa 200 MB, cioè un centinaio di frame.

**Prefetch**: da 8 a 12 istanti avanti nella direzione di riproduzione. A 4 fps
servono circa 500 KB/s. Se il buffer si svuota **la riproduzione si mette in pausa**
con indicatore visibile, non salta fotogrammi: su un'animazione meteo saltare falsa
la percezione del fenomeno, una pausa breve si legge per quello che è.

**Unico modulo che conosce gli URL del bucket.** Se un domani servisse un backend,
si cambia qui.

### 7.3 src/map

Custom layer MapLibre: riceve contesto GL e matrice di proiezione, disegna un quad
texturizzato.

**Texture intera, interpolazione a mano.** Il frame va in GPU come `R16UI` letta con
`usampler2D`. Le texture intere non supportano il filtraggio bilineare hardware,
quindi l'interpolazione è scritta nello shader: quattro `texelFetch` e una
miscelazione pesata. È una decina di righe di GLSL e permette di **ignorare i vicini
nodata** invece di mediarli; col filtraggio hardware ogni tratto di costa avrebbe un
alone di valori sbagliati.

**Interpolazione temporale**: due texture (ora `t` e `t+1`) fuse con un fattore
continuo, così il campo si deforma con continuità invece di saltare di ora in ora.
Costa una texture unit. Le direzioni si interpolano correttamente perché
memorizzate come seno e coseno (vedi 4.3).

**Colormap**: texture 1D di 256 colori RGBA da **cmocean**, cioè `amp` per l'altezza
d'onda, `thermal` per la temperatura, `haline` per la salinità, `phase` (ciclica)
per le direzioni. Generata in Python e servita col catalogo. Palette
percettivamente uniformi: una palette arbitraria su dati geofisici introduce
artefatti visivi che sembrano struttura fisica e non lo sono.

**Ordine dei livelli**: basemap OSM, campo dati, seamark OpenSeaMap, marker
stazioni. Inserito dichiarativamente prima di un id noto.

**Valore sotto il mouse**: nessuna lettura dalla GPU. Si inverte la proiezione fino
all'indice di cella e si legge dall'`Int16Array` già in memoria.

### 7.4 src/ui

`MapView`, `TimelineScrubber`, `PlaybackControls`, `Legend`, `LayerSwitcher`,
`StatusBar`.

In v1 il `LayerSwitcher` ha una sola voce (`hwave`) e legge l'elenco dal catalogo:
non va cablato sull'unica variabile visualizzata, altrimenti aggiungere un layer
significherebbe modificare la UI invece che l'ingestione.

Lo **scrubber** non è uno slider su un intervallo continuo ma su un asse di ore che
può avere buchi. Deve mostrarli invece di scavalcarli, e marcare in modo netto il
confine fra zona di analisi e zona di previsione: è l'unico punto della UI in cui
l'utente capisce che sta guardando due cose scientificamente diverse.

La **StatusBar** mostra sempre la provenienza del frame a schermo, cioè `analisi`
oppure `previsione +18h`. Senza, la mappa mente per omissione.

Finestra iniziale: **48 h passate più 72 h previste**, cursore su "adesso", con un
controllo per allargare a tutto l'archivio.

### 7.5 Mappa

MapLibre GL JS. Basemap raster OSM standard (`tile.openstreetmap.org`), con
attribuzione OSMF. Overlay nautico OpenSeaMap (`tiles.openseamap.org/seamark/`),
attivabile: sono tile PNG RGBA da circa 1 KB, trasparenti al 99,6%, quindi un
overlay e non una basemap.

L'overlay seamark è raster e non stilizzabile, con etichette pensate per fondo
chiaro: vincola la basemap a restare chiara. È il motivo per cui non adottiamo una
basemap scura in v1.

La basemap è l'unico componente completamente intercambiabile dell'architettura:
sostituirla con Protomaps/PMTiles sullo stesso bucket non tocca né il modello dati,
né il pacchetto, né il custom layer.

**Batimetria**: le isobate si generano dal campo `h` di ADRIAC, completo e uniforme
su tutto il dominio, non dai dati crowd-sourced di OpenSeaMap che sono sparsi. È un
campo statico, trasformato una volta in GeoJSON.

### 7.6 Stato nell'URL

`?t=2026-08-13T14:00Z&var=hwave&z=8&c=44.21,12.48`

Rende l'app condivisibile: un link punta a un fotogramma esatto.

### 7.7 Dipendenze

In v1: MapLibre GL JS, React, Vite, TypeScript, Radix UI (slider, toggle, popover:
lo scrubber accessibile da tastiera è difficile da scrivere bene a mano),
TanStack Query (catalogo, **non** i frame: quelli vogliono una LRU con prefetch,
che è logica di dominio), d3-scale, Vitest, Playwright (smoke test di rendering,
vedi 8.2).

Prevista per dopo, quando arriveranno stazioni e profili: uPlot per le serie
storiche (framework-agnostic, regge decine di migliaia di punti dove Recharts si
inginocchia).

## 8. Test

### 8.1 Python

pytest, con NetCDF sintetico **generato in codice** (8x6 celle, 2 istanti), non un
binario committato: così la fixture si legge e si modifica.

- Funzioni pure: round-trip int16, clipping, direzioni sin/cos, costruzione
  dell'indice su geometria nota con verifica che nessun valore attraversi la terra.
- Integrazione: `moto` per S3, `responses` per la sorgente HTTP.
- **Round-trip completo**: NetCDF sintetico, pipeline, bucket finto, rilettura,
  confronto entro la tolleranza di quantizzazione. Protegge il contratto
  d'archivio, ed è il primo test da scrivere.
- **Idempotenza**: due esecuzioni di fila, la seconda deve produrre zero scritture.

### 8.2 TypeScript

Vitest sugli strati puri: risoluzione analisi/previsione, LRU, decodifica dei buffer
(costruiti a mano, con un nodata dentro), matematica della proiezione.

Il rendering WebGL non si testa unitariamente. Smoke test Playwright che carica la
pagina, attende il primo frame e confronta uno screenshot.

### 8.3 Il test che vale più di tutti

Coerenza end-to-end: si prende la cella ADRIAC corrispondente a Nausicaa 2, si legge
il valore dal NetCDF sorgente e lo si confronta con quello che il frontend
leggerebbe dal frame pubblicato. Se quella catena regge, cioè sorgente, griglia,
codifica, upload, decodifica e proiezione, regge tutto il sistema.

## 9. Deploy e configurazione manuale

Due account, circa quindici minuti di lavoro manuale.

| # | Cosa | Dove |
|---|---|---|
| 1 | Account Cloudflare, bucket R2, API token, accesso pubblico in lettura, CORS | dash.cloudflare.com |
| 2 | Repo **pubblico** su GitHub, secret R2 nelle Actions | github.com |

Tutto il resto (policy del bucket, CORS, workflow, build) è file nel repository.

La SPA è statica: Cloudflare Pages o lo stesso bucket R2.

### Sequenza

**Tappa 1** (punti 1 e 2): ingestore più SPA che gira in locale puntando a R2.
Da subito l'archivio comincia ad accumularsi: ogni giorno senza ingestione è
storico perso per sempre, quindi questa tappa ha priorità sulla presentazione.

**Tappa 2**: deploy pubblico della SPA.

## 10. Decisioni prese e loro motivo

| Decisione | Motivo |
|---|---|
| Nessun backend | Dato di sola lettura, aggiornato a lotti, query note in anticipo |
| Object storage letto direttamente dal browser | Frame immutabili, grossi, richiesti a raffica: egress gratuito su R2 |
| Frame in int16 con `Content-Encoding: gzip` | Valori esatti, zero librerie di decompressione nel client |
| Numeri e non pixel colorati | Abilita hover, scala regolabile, frecce, mappe di differenza |
| Ricampionamento in Web Mercator in ingestione | Una trasformazione sola; il client disegna un rettangolo |
| Nearest-neighbour sul solo mare | Nessun valore attraversa la costa |
| Direzioni come sin/cos | L'interpolazione lineare degli angoli è sbagliata a 0 e 360 gradi |
| Nessuna piramide di tile | Il dominio sta in una texture |
| Analisi e previsione entrambe conservate, tutte le scadenze | Abilita l'analisi di skill per lead time |
| Profili 3D solo da analisi | I profili da previsione costerebbero circa 2,8 GB al giorno |
| Livello del mare a 10 min in analisi, orario in previsione | L'analisi è documento permanente, la previsione è effimera (vedi 4.7) |
| React con confine imperativo verso WebGL | Ecosistema di librerie senza conflitto col ciclo di render |
| Basemap OSM standard in v1 | Zero setup, coerente con l'overlay seamark, sostituibile in un pomeriggio |
