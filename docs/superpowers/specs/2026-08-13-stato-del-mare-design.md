# Stato del Mare, design

Data: 2026-08-13
Stato: approvato. La parte sull'ingestore (sezioni 2, 3, 4, 5, 6, 8.1) è
implementata e allineata al codice, comprese le correzioni della revisione
finale. La parte sulla SPA (sezione 7, 8.2) è ancora da tradurre in piano.

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

### Isolinee etichettate sull'altezza d'onda

Richiesta dell'utente il 2026-08-13, con riferimento esplicito al widget ARPAE
delle previsioni d'onda ("ma fatta meglio").

L'altezza d'onda si rende a **bande discrete**, ciascuna col proprio contorno, e
sul contorno corre il valore della soglia ripetuto lungo il tracciato, come le
isobate delle carte nautiche.

**La condizione che lo rende possibile**: le soglie delle isolinee e i gradini
della scala di colore devono essere la stessa lista, da una sola fonte. Due
elenchi separati prima o poi divergono, e una linea che dice 1,25 m a due pixel
dal punto dove il colore cambia davvero è peggio di nessuna linea, perché è
credibile ed è sbagliata. Ne segue che la resa va a classi discrete: su una rampa
continua non esistono confini da etichettare.

**Le soglie**: il codice stato del mare WMO (0,1, 0,5, 1,25, 2,5, 4, 6, 9, 14 m)
in linea spessa e con l'etichetta, le suddivisioni intermedie di ARPAE (0,8, 1,8,
3,2, 5, 7, 8 m) in linea sottile e senza numero. Il numero compare dove ha un
nome, non a ogni gradino.

**Dove si calcola**: marching squares (`d3-contour`) sul campo già decodificato
nel browser, in `src/map/`, non in ingestione. Le soglie sono una scelta di
visualizzazione che vorremo ritoccare guardando le mappe; inciderle in ingestione
le congela in 792 oggetti al giorno e impone di rigenerare l'archivio a ogni
ripensamento (principio 3.5). Costo: circa 724 mila celle per soglia, quindi si
calcola al cambio di fotogramma (al massimo 10 volte al secondo), meglio in un
worker, con cache per fotogramma e insieme di soglie. Mai nel ciclo a 60 fps.

**Resa**: due strati MapLibre sulla stessa sorgente GeoJSON, uno `line` e uno
`symbol` con `symbol-placement: "line"` e `text-rotation-alignment: "map"`. È lo
stesso codice di etichettatura delle isobate della batimetria (7.5), che sono
statiche: si scrive una volta là e la seconda funzionalità costa quasi niente.

### Stima della corrente nei canali di Comacchio

Richiesta dell'utente il 2026-08-18. Le Valli di Comacchio fanno da cassa di
espansione e sfasano la marea: quando il mare e' al colmo c'e' ancora forte
corrente nei canali di collegamento, e viceversa alla bassa. L'obiettivo e'
stimare quella corrente nel portocanale di Porto Garibaldi e nel canale
Logonovo.

**La fisica.** La corrente nel canale non e' mossa dalla marea ma dal dislivello
fra le due estremita'. Se il bacino interno e' molto attenuato rispetto al mare,
il dislivello e' massimo proprio quando il mare e' al colmo o al minimo, e la
stanca cade dove il mare attraversa il livello interno. Forte attenuazione
implica forte sfasamento: e' il modello della laguna a bocca ristretta, e serve
il livello **dentro** il bacino per essere qualcosa di piu' di una descrizione.

**Il dato interno non esiste nel pubblico.** Misurato il 2026-08-18 su tutte le
undici reti del flusso `realtime.jsonl`, entro 45 km da Porto Garibaldi: nessuna
stazione riporta un livello **dentro** le Valli di Comacchio.

| Distanza | Rete | Stazione | Codice | Cos'e' |
|---|---|---|---|---|
| 0 km | marefe | Porto Garibaldi (due strumenti) | `B22037` | mare, marea, 10 min |
| 6,4 km | marefe | Bellocchio | `B13215` | foce del Reno, **non** le Valli |
| 17,2 km | marefe | Faro | `B22037` | mare, a Volano |
| 20,4 km | simnbo | Codigoro | `B13215` | sistema Po di Volano |
| 26,5 km | simnbo | Fiscaglia Monte e Valle | `B13215` | sistema Po di Volano |

Tutto il resto entro quel raggio sono idrometri fluviali dei bacini Reno, Idice,
Lamone e Savio.

**Errore da non ripetere.** In una prima stesura questa sezione accoppiava Porto
Garibaldi con Bellocchio e ne ricavava un'attenuazione del 9%, presentandola come
la misura della cassa di espansione. E' sbagliato: Bellocchio sta alla foce del
Reno, nella sacca, ed e' praticamente isolato dal mare, quindi quel numero non
descrive le Valli. Il dato stesso lo diceva e non l'ho letto: il codice di
Bellocchio e' `B13215`, che la tabella DB-All.e traduce "River level", mentre le
stazioni di mare usano `B22037`, "Tidal elevation". Lo strumento era dichiarato
come idrometro di fiume.

**Non e' solo un problema di strumento.** Il livello delle Valli non e' idraulico
ma amministrato: chiaviche e idrovore lo tengono dentro una fascia decisa. Lo
sfasamento nasce in parte dalla regolazione, quindi un coefficiente tarato su un
periodo vale finche' la regolazione non cambia.

**Cosa resta prendibile dal pubblico:**

- la forzante lato mare a Porto Garibaldi, `B22037`, passo 10 minuti, con due
  strumenti indipendenti che concordano entro 2 cm e quindi si controllano a
  vicenda;
- a Logonovo la salinita' `B22062`, che il 2026-08-18 oscillava fra 16,8 e 20,5
  parti per mille. Quell'escursione **e'** lo scambio col mare e ne da' verso e
  fase, ma e' oraria e non da' la portata.

**La corrente nel portocanale e' un problema piu' facile del bacino.** Richiesta
esplicita dell'utente il 2026-08-18: sapere la velocita' della corrente nel
portocanale di Porto Garibaldi sarebbe utilissimo, e per chi entra o esce con una
barca lo e' soprattutto in avanti nel tempo, non a posteriori.

Se il livello interno e' quasi fermo, e sia la regolazione con chiaviche sia
l'attenuazione dicono che lo e', la portata dipende dal solo livello del mare:

`Q = k * segno(h - h0) * radice(|h - h0|)`

Due incognite: `h0`, il livello di mare a cui la corrente si annulla, e `k`, che
raccoglie sezione e attrito. **Non serve l'idrometro dentro le Valli**: serve una
calibrazione, ottenibile con una campagna di mezza giornata (velocita' sul fondo
contro velocita' sull'acqua a motore costante, oppure un galleggiante cronometrato
fra due punti noti, ripetuto a diverse fasi di marea; sei o otto punti su un ciclo
bastano).

**La forzante e' gia' in archivio, anche in avanti.** Verificato il 2026-08-18:
`index/sealevel/fc/2026-08.json` copre 240 istanti fino al 20 agosto, e i frame
di livello previsto hanno un valore valido sulla cella di Porto Garibaldi (riga
227, colonna 130 della griglia pubblicata; 7 vicini validi su 9, quindi la
stazione non e' su un bordo fragile). Quindi il modello, una volta calibrato,
produce una **previsione a 72 ore** della corrente in canale, non solo una
ricostruzione.

Confronto preliminare fra ADRIAC previsto e mareografo, 7 istanti orari del
2026-08-18: correlazione +0,6, scarto medio -4,1 cm (quasi tutto differenza fra
lo zero del modello e lo zero nazionale). **Non dimostra nulla**: sette punti, in
quadratura d'agosto, con 15 cm di escursione e previsione a oltre un giorno. La
forma pero' torna e il modello sembra anticipare di circa un'ora. Prima di
fidarsi serve un confronto su settimane, possibilmente in sizigie.

**Cosa resta bloccato davvero:** il modello del bacino, cioe' ricostruire il
livello dentro le Valli. Per quello un idrometro interno servirebbe, e non
esiste nel pubblico.

### Il riferimento ARPAE, misurato il 2026-08-13

Widget Leaflet a `apps.arpae.it/widgets/meteo-mare-mappe-previsione/`, alimentato
da `apps.arpae.it/REST/meteo_mappe_previsione_<variabile>`. Il campo è un **PNG
piatto** steso con `L.imageOverlay` su coordinate fisse: 72 immagini orarie per
emissione, circa 190 KB l'una, quindi circa 13,7 MB per variabile per emissione
solo per animare. Ha già scrubber e autoplay.

Cosa vogliamo fare diversamente, e perché:

| Loro | Noi | Motivo |
|---|---|---|
| Pixel colorati | Griglia int16 già in Web Mercator | Valore sotto il mouse, nitidezza a ogni ingrandimento, isolinee calcolate dal campo |
| Palette arcobaleno, prime due classi due blu quasi identici | cmocean percettivamente uniforme | L'Adriatico passa gran parte dell'anno sotto i 0,5 m: là la loro mappa è di un colore solo |
| Legenda fuori dalla mappa | Numero sul contorno | Toglie il viaggio dell'occhio |
| WW3 su tutti i mari italiani, maglia larga | ADRIAC a 1 km, solo Adriatico | Risoluzione contro copertura: vedi la domanda aperta qui sotto |
| Frecce a passo fisso nella griglia del dato, lunghezza costante | Passo fisso a schermo | A passo fisso nel dato si accavallano o spariscono secondo l'ingrandimento |

**Domanda aperta, non decisa**: ADRIAC copre solo l'Adriatico. Se la copertura
contasse quanto la qualità servirebbe una seconda sorgente (WW3), con un secondo
ingestore e un secondo dominio. Non è previsto in v1.

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
frames/{var}/{kind}/{ref}/{YYYY-MM-DDTHHMM}.bin campo, int16 gzip
runs/{data}/{kind}/{gruppo}.json                contratto d'archivio, un file per gruppo
static/bathymetry.bin                           batimetria, scritta una volta
static/regrid_index.npz                         indice di ricampionamento, cache
stations/stations.json                          anagrafica
stations/{id}/columns/{gruppo}/{YYYY-MM-DD}.bin profili sigma grezzi, giornalieri
stations/{id}/obs/{YYYY-MM}.json                osservazioni misurate
```

Convenzioni sui segnaposto: `{var}` è l'id di variabile della tabella in 4.3,
`{kind}` è `an` o `fc`, `{ref}` è l'istante di riferimento in forma `YYYYMMDD`,
`{YYYY-MM-DDTHHMM}` è l'istante valido in UTC, `{data}` è la data del file
sorgente in forma `YYYY-MM-DD` e `{gruppo}` è il gruppo di file sorgente
(per esempio `his_HPDwave`).

**I minuti stanno nella chiave per tutte le variabili**, comprese quelle che
oggi hanno solo istanti orari. È una convenzione sola, senza rami. Senza
minuti, il livello del mare in analisi (144 step da 10 minuti, vedi 4.7)
collasserebbe su 24 chiavi: sei frame per ora si sovrascriverebbero a vicenda,
sopravviverebbe l'ultimo scritto, e l'indice mensile (che registra l'istante
valido al secondo) continuerebbe ad annunciarli tutti e sei. Un client che
chiede le 01:00 riceverebbe il campo delle 01:50 senza alcun modo di
accorgersene: è lo stesso danno della griglia cambiata (valori plausibili nel
posto sbagliato) spostato nel tempo invece che nello spazio.

Il manifest è per gruppo di file e non per run: in un giorno si lavorano più
file sorgente diversi per tipo, e con un manifest unico un gruppo riuscito e
uno fallito nello stesso giorno non potrebbero registrare il progresso
parziale separatamente.

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
altezza, risoluzione. Alla risoluzione di 1.200 m Mercator (circa 878 m al
suolo a 43 gradi di latitudine, cioè la risoluzione nativa del modello ADRIAC)
sono **858 x 844 celle**, valore reale prodotto da `build_grid()` e misurato
contro l'archivio il 2026-08-13: **una texture sola, nessuna piramide di
tile**, ben dentro i limiti GPU di qualsiasi dispositivo. Le dimensioni non
vanno mai cablate: le calcola il codice dai dati.

Web Mercator e non lat/lon regolare perché la mappa è una slippy map: alle nostre
latitudini la deformazione mercatoriana sull'altezza del dominio è circa il 30%, e
un raster equirettangolare risulterebbe schiacciato verso nord.

**Il descrittore non è versionato, e la scelta è deliberata.** Una prima stesura
prevedeva `grid_v2.json` con i frame che referenziano il proprio descrittore. Non
è stato implementato, e la spec è stata allineata al codice invece del contrario,
per questo motivo: il rischio da cui la versionatura proteggerebbe, cioè due
griglie diverse mescolate nello stesso archivio, non può verificarsi, perché
`GridMismatch` ferma il run **prima di scrivere qualsiasi cosa** appena
l'impronta delle coordinate sorgente cambia. Resta uno scenario raro in cui serve
una decisione umana, e per quello vale una procedura scritta, non della
macchinaria costruita oggi contro un evento di forma ignota.

**Procedura se un giorno `GridMismatch` scatta davvero.** Il run esce 2 e non
scrive. A quel punto, verificato che ARPAE abbia effettivamente riconfigurato il
dominio e non si tratti di un file corrotto:

1. l'archivio esistente resta valido e leggibile con il `grid.json` attuale:
   **non va toccato**;
2. si sposta il prefisso corrente sotto un nome che ne dichiari l'epoca (per
   esempio `epoca-1/`), oppure si apre un bucket nuovo;
3. si cancella `static/regrid_index.npz`, che è la memoria della vecchia griglia,
   così che il run successivo ricostruisca l'indice sulla griglia nuova;
4. il client legge un'epoca alla volta: la continuità della serie attraverso un
   cambio di griglia è un problema di visualizzazione, e va affrontato quando e
   se accadrà, con i dati veri davanti.

Il costo di questa scelta, se è sbagliata: il giorno del cambio serve un
intervento manuale di qualche minuto invece di zero.

### 4.5 Manifest

Ogni run scrive:

```json
{
  "schema_version": 2,
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
     "path": "frames/hwave/an/20260813/2026-08-12T0100.bin",
     "sha256": "...", "source_units": "meter", "scale": 0.001, "offset": 0.0,
     "min": 0.02, "max": 1.87, "nodata_count": 729412, "clipped_count": 0}
  ],
  "columns": [
    {"station_id": "boa-nausicaa-2", "group": "his_cur",
     "path": "stations/boa-nausicaa-2/columns/his_cur/2026-08-13.bin",
     "variables": ["u_eastward", "v_northward"],
     "shape": [24, 2, 30], "dims": ["ocean_time", "variable", "s_rho"],
     "dtype": "int16", "scale": 0.01, "sha256": "..."}
  ]
}
```

`columns` è vuoto per i gruppi 2D e `frames` è vuoto per i gruppi di profilo:
un gruppo sorgente produce l'uno o l'altro, mai entrambi.

`min` e `max` per frame servono al client per la scala di colore senza dover
scandire l'array a ogni cambio di istante. `clipped_count` è un segnale di
allarme: se supera zero, la scala scelta è sbagliata.

La deduplica cade fuori gratis: prima di lavorare un file, si confronta il suo
checksum con quello registrato nel manifest corrispondente. Uguale significa salta.

### 4.6 Profili verticali sulle stazioni

Catturati fin da subito, senza UI. Per ogni stazione, la cella di mare ADRIAC più
vicina; per ogni ora, i 30 valori sigma di temperatura, salinità e correnti,
salvati **grezzi**, senza conversione in metri.

Un file **giornaliero per stazione e per gruppo sorgente**:
`stations/{id}/columns/{gruppo}/{YYYY-MM-DD}.bin`. L'object storage non
supporta l'append, quindi un file mensile andrebbe riscritto ogni giorno
perdendo l'immutabilità. Il costo è trascurabile, circa 5,8 KB al giorno per
stazione.

**Il segmento `{gruppo}` è obbligatorio.** Le quattro variabili arrivano da tre
file sorgente distinti (`his_temp`, `his_salt`, `his_cur`), lavorati in tre
passaggi separati: senza quel segmento le tre scritture finiscono sullo stesso
oggetto, marcato per giunta `immutable`, e ne sopravvive una sola. Sarebbero
1,19 GB al giorno scaricati (la voce più grande del bilancio di banda) per poi
buttarne tre quarti.

**Le colonne si registrano nel manifest del gruppo** (vedi 4.5), con percorso,
identificativo di stazione, ordine delle variabili, forma dell'array, ordine
degli assi, scala e sha256. Non compaiono in nessun indice e in nessun
catalogo, quindi il manifest è l'unico posto in cui resta scritto cosa
contengono: senza, quel file è un blob di int16 indistinto, leggibile solo da
chi ha sottomano il codice che lo ha prodotto. È il principio 3.5 applicato
alla lettera.

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

**Conseguenza sul layout** (vedi 4.2): tenere la piena risoluzione ha senso solo
se i sei istanti di ogni ora finiscono su sei oggetti distinti. Per questo la
chiave di un frame porta i minuti, `{YYYY-MM-DDTHHMM}`, per tutte le variabili e
non solo per il livello del mare. Una chiave troncata all'ora annullerebbe in
silenzio proprio ciò che questa sezione paga: cinque frame su sei sovrascritti,
e il superstite annunciato dall'indice a sei orari diversi.

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
interrogato con i centri delle celle di destinazione, distanza massima **800 m**.
Vicino più prossimo, non interpolazione.

La soglia è geometrica: le celle sorgente distano 1 km fra loro, quindi
qualunque punto interno a una cella di mare è entro 707 m dal suo centro
(la semidiagonale). 800 m copre tutti i punti di mare legittimi e limita lo
sbordamento sulla terraferma a meno di una cella sorgente. Una soglia più
larga, per esempio 1,5 km, farebbe pescare un valore di mare fino a 1,5 km
nell'entroterra, producendo una frangia colorata visibile lungo tutta la
costa.

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
registra dal NetCDF e confronta con l'atteso. L'unità attesa è `source_units`
in `FieldSpec`, che è cosa dichiara il file sorgente (`meter`), non `units`,
che è l'unità dell'array pubblicato (`m`): sono due stringhe diverse, e per le
componenti di direzione sono anche due grandezze diverse (gradi in ingresso,
adimensionale in uscita). Uno scarto solleva `UnitMismatch` e ferma il run con
uscita 2, come `GridMismatch`: un cambio di unità è silenzioso, i valori si
riquantizzano bene e `clipped_count` può restare zero. Un nome variabile che non
c'è più solleva `VariableMissing` e ferma il run allo stesso modo: non è un file
storto da riprovare domani, e nessun run successivo lo rimedia da solo.

**Ogni lettura di una variabile sorgente passa da `frames.read_variable`**, che è
il punto in cui il nome assente diventa `VariableMissing`. Una lettura diretta di
`ds.variables[...]` lo farebbe emergere come `KeyError`, che la clausola larga di
`reconcile()` conta come fallimento passeggero: uscita 1, cioè "riprova domani",
e il cron ritenterebbe per sempre. È già successo due volte, sui campi 2D e sulle
colonne dei profili, quindi la regola non è affidata alla disciplina:
`tests/test_vincoli.py` cammina l'albero sintattico del pacchetto e fallisce se
una lettura diretta ricompare fuori da `read_variable`.

**Fin dove arriva la guardia.** Il file si apre solo se vale la pena scaricarlo:
se dimensione e data di modifica non sono cambiate, la deduplica lo salta senza
leggerne il contenuto (vedi 5.1), quindi un cambio di contratto interno resta
invisibile finché l'intestazione HTTP non si muove. È il compromesso deliberato
per non riscaricare 1,9 GB al secondo run giornaliero. Perché il buco si
materializzi servirebbe un rename che produce un file della stessa identica
lunghezza in byte, con la stessa data di modifica: il costo è un giorno di
ritardo nell'accorgersene, non un dato perso, perché il file resta nella finestra
di 8 giorni e il run successivo lo riprende appena l'intestazione cambia.

### 6.2 Gli altri

| Situazione | Comportamento |
|---|---|
| File sorgente non ancora pubblicato | Non è un errore. Salta, riprova al run dopo. |
| Download interrotto, checksum errato | 3 tentativi con backoff, poi salta e logga. |
| NetCDF corrotto, variabile assente | Salta quel file, gli altri proseguono. |
| Upload interrotto a metà | I frame caricati restano (immutabili); senza manifest, il run dopo rilavora e riscrive identico. |
| Valori fuori range int16 | Clip, conteggio nel manifest (`clipped_count`). |
| Stazione senza cella di mare entro 800 m | Salta con log. Possibile per le stazioni lagunari. |

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

**Texture intera, interpolazione a mano.** Il frame va in GPU come `R16I` letta con
`isampler2D`. Le texture intere non supportano il filtraggio bilineare hardware,
quindi l'interpolazione è scritta nello shader: quattro `texelFetch` e una
miscelazione pesata. È una decina di righe di GLSL e permette di **ignorare i vicini
nodata** invece di mediarli; col filtraggio hardware ogni tratto di costa avrebbe un
alone di valori sbagliati.

Una prima stesura diceva `R16UI` con `usampler2D`. Corretto dopo la verifica del
2026-08-18: il dato è int16 **con segno**, quindi con una texture senza segno
servirebbe rimettere il segno nello shader (sottrarre 65536 sopra 32767) e il
confronto col nodata diventerebbe un numero magico diverso da quello scritto nel
formato. Con `R16I` il valore arriva già firmato e `NODATA == -32768` si legge
identico da entrambe le parti del confine.

**Interpolazione temporale**: due texture (ora `t` e `t+1`) fuse con un fattore
continuo, così il campo si deforma con continuità invece di saltare di ora in ora.
Costa una texture unit. Le direzioni si interpolano correttamente perché
memorizzate come seno e coseno (vedi 4.3).

**Colormap**: texture 1D di 256 colori RGBA da **cmocean**. Il catalogo pubblica
solo il **nome** della palette per variabile (`amp` per l'altezza d'onda, `tempo`
per il periodo, `phase` per le direzioni, `speed` per le correnti, `balance` per
il livello), e i colori stanno nella SPA. Palette percettivamente uniformi: una
palette arbitraria su dati geofisici introduce artefatti visivi che sembrano
struttura fisica e non lo sono.

Una prima stesura diceva che la tavolozza sarebbe stata generata in Python e
servita col catalogo. **Non e' andata cosi' e la decisione si allinea al fatto**:
verificato il 2026-08-18, il bucket non contiene nessun asset di colormap, mentre
il catalogo il nome ce l'ha gia'. I colori sono una scelta di presentazione, non
un dato: metterli nel pacchetto d'archivio significherebbe versionare l'estetica
insieme alla misura. Restano generati da cmocean, ma da uno **script che scrive un
modulo TypeScript** (`strumenti/colormap.py`), cosi' i valori sono provatamente
cmocean e non scelti a occhio, e il client non paga una richiesta in piu' ne' un
modo di fallire in piu'. Costo se e' sbagliato: aggiungere una palette richiede un
rilascio della SPA invece di un run dell'ingestore.

**Ordine dei livelli**: basemap vettoriale, campo dati, seamark OpenSeaMap,
marker stazioni, **etichette della basemap sopra il campo**. Il campo si inserisce
con `beforeId` uguale all'id del primo livello di simboli della basemap, cosi' i
nomi di luoghi e porti restano leggibili senza togliere niente al campo. La
basemap deve essere vettoriale proprio per questo: con una raster non esiste un
livello di etichette sotto cui infilarsi.

**La basemap e' un `.pmtiles` di Protomaps nello stesso bucket R2.** Deciso il
2026-08-18. Un file solo, che il browser legge a richieste di intervallo: nessun
server di tile, nessuna chiave, nessun limite di frequenza di terzi, e soprattutto
**la stessa proprieta' architetturale del resto**, cioe' la SPA che legge da
object storage e basta. Un servizio pubblico di tile (OpenFreeMap, MapTiler)
costerebbe zero lavoro ma metterebbe una dipendenza di esecuzione su qualcosa che
non controlliamo, dentro un progetto costruito apposta per non averne.

Si estrae dal pianeta senza scaricarlo, perche' il file remoto accetta richieste
di intervallo:

    pmtiles extract https://build.protomaps.com/AAAAMMGG.pmtiles adriatico.pmtiles \
      --bbox=10.8,39.8,20.1,46.4 --maxzoom=13

Misurato il 2026-08-18 sul riquadro del dominio, 3 minuti di estrazione:

| fino a zoom | peso |
|---|---|
| 12 | 350 MB |
| **13** | **702 MB** |
| 14 | 1.316 MB |

**Si prende il 13.** Le tile vettoriali si sovra-ingrandiscono bene, quindi al
tetto di zoom 15 restano due livelli di sovra-ingrandimento: la geometria e' un
po' larga, ma le etichette le disegna il client e restano nitide. Il 14 raddoppia
il peso per un dettaglio da livello stradale che su una mappa del mare non serve;
il 12 lo dimezza ma a zoom 15 la citta' diventa troppo povera per orientarsi, che
e' l'unico lavoro che la basemap deve fare qui.

Costo se e' sbagliato: 700 MB nel bucket (circa un centesimo al mese di
archiviazione, e l'uscita da R2 non si paga) e tre minuti per rifarlo a un altro
zoom. La basemap non e' deperibile: si rigenera quando fa comodo, non ogni
giorno.

**Valore sotto il mouse**: nessuna lettura dalla GPU. Si inverte la proiezione fino
all'indice di cella e si legge dall'`Int16Array` già in memoria.

### Ritaglio sulla costa vera

Il campo si disegna solo in mare, ritagliato sulla linea di costa reale e non su
quella del modello. Servono due regole distinte, trovate misurando il 2026-08-18
(prima erano entrambe assenti e il campo copriva fino a 2 km di terraferma).

**Regola 1, un nucleo continuo invece dei quattro vicini.** Il valore e' la media
pesata dei soli campioni validi entro due celle, con un nucleo che si annulla con
derivata nulla al proprio bordo e una finestra centrata sulla cella piu' vicina.
La finestra si centra con `round` e non con `floor`: con `floor` scivola di una
cella nel momento in cui il frammento attraversa un confine, e i campioni ai
margini entrano e escono di colpo. Cosi' nessuna grandezza salta passando da una
cella all'altra.

Una prima stesura mediava i quattro vicini e dipingeva se **uno qualunque** era
valido: il campo si allargava di una cella intera oltre il proprio bordo, cioe'
1.200 m di terra colorata con un dato che li' non esiste. Misurato: il centro di
Cervia risultava dipinto mentre la sua cella e' `nodata`.

**Regola 2, la maschera di costa come campo di distanza.** Un'immagine statica
che per ogni punto porta la **distanza con segno dalla costa**, positiva in mare
e negativa a terra. Lo shader la campiona, scarta i pixel a terra e sfuma il
bordo su un pixel di schermo con `fwidth`.

La distanza con segno, non una maschera binaria: fra 0 e 1 una maschera booleana
non dice **dove** passi il confine dentro il texel, quindi interpolandola restano
i gradini. Interpolando la distanza il confine si ricostruisce dentro il texel,
ed e' la stessa ragione per cui un font SDF resta nitido ingrandito.

**La distanza si misura dai segmenti della costa, non da una maschera
rasterizzata.** Questa riga e' costata due generazioni dell'asset. La prima era
la trasformata di distanza di una maschera a 240 m, e sembrava la stessa cosa:
e' un campo di distanza, si interpola, il commento nel codice citava perfino i
font SDF. Ma una trasformata di distanza su maschera **non conosce nessun valore
sotto il texel**. Misurato sull'asset di prima generazione: sotto i 500 m
esistevano quattro valori in tutto, cioe' 240, 339, 480 e 537, che sono un texel,
la sua diagonale e i loro multipli, e **nessun valore sotto i 240 m**.
L'informazione sub-texel era stata distrutta prima che lo shader la vedesse, e
il livello zero era la scaletta della rasterizzazione: nessuna interpolazione la
raddrizza. A ingrandimento 14 la riva di Unije aveva gradini lunghi 68 pixel.

Con la distanza dai segmenti, sotto i 500 m i valori distinti diventano 223.821 e
il minimo non nullo 0,12 m. Sulla stessa vista il gradino piu' lungo scende da 68
a 7 pixel, e i gradini da 20 pixel in su, che erano l'1,1% del bordo, spariscono.

**La costa e' quella di OpenStreetMap, non GSHHG.** Terza generazione
dell'asset, e la ragione non e' che una sorgente sia piu' esatta dell'altra:
e' che **l'occhio confronta il campo con la costa che vede disegnata sotto**.
Qualunque scarto fra il ritaglio e la basemap si legge come un errore del
campo, chiunque abbia ragione sulla posizione vera della riva. Quindi il
ritaglio deve venire dalla stessa sorgente delle tile.

Misurato sulle stesse otto viste, contando i pixel dipinti che cadono oltre 100 m
dentro la terraferma disegnata:

| vista | GSHHG | OSM |
|---|---|---|
| Unije, zoom 13 | 3.260 px, fino a 370 m | **0 px**, fino a 91 m |
| Venezia, zoom 11 | 19.709 px, fino a 1.138 m | 102 px, fino a 161 m |
| delta del Po, zoom 11 | 5.298 px, fino a 847 m | 42 px, fino a 121 m |
| Ancona, zoom 12 | 622 px, fino a 294 m | 3 px, fino a 114 m |
| Dalmazia, zoom 10 | 8.873 px, fino a 988 m | 9.526 px, fino a 1.252 m |

L'unica riga che peggiora e' la Dalmazia a zoom 10, e li' non e' la maschera a
sbagliare: a quello zoom sono le **tile** a disegnare una costa semplificata. Il
segnale pulito e' Unije a zoom 13, dove il disegno e' a piena risoluzione e la
sovrapposizione oltre i 100 m sparisce del tutto.

**Il segno viene dalla regola della mano.** In OSM la costa e' orientata con la
terra a sinistra del verso di percorrenza: e' una convenzione imposta e
verificata a monte. Sui vertici la normale di un solo segmento sbaglia dentro il
cuneo, quindi si somma alla normale del segmento adiacente. Verso confermato per
confronto con GSHHG: con quello sbagliato l'accordo era dell'1,2% invece che del
98,8%.

**Una sola sorgente per il segno, mai due.** Il primo tentativo prendeva il segno
da OSM entro 1,6 km dalla riva e da GSHHG oltre, per non pagare il calcolo su
tutta la griglia. Nella laguna di Venezia le due coste dissentono di molto piu'
di 1,6 km, e il bacino di San Marco risultava terraferma. Due sorgenti per la
stessa grandezza vuol dire una cucitura, e la cucitura cade sempre dove le
sorgenti non sono d'accordo. Il calcolo su 18 milioni di punti costa 75 secondi
una volta sola.

**Conseguenza accettata: dentro le lagune il campo non si disegna.** La costa
OSM non entra nella laguna di Venezia ne' in quella di Marano, che le tile pero'
disegnano azzurre. ADRIAC qualche cella li' dentro ce l'ha. La si lascia
scoperta: uno stato del mare a celle da 1 km dentro una laguna non significa
niente, e disegnarlo darebbe autorevolezza a un numero che non ce l'ha.
**Condizione che la fa riaprire**: se serve la corrente nei canali di
collegamento (la funzionalita' di Porto Garibaldi, sezione 1), quel dato va
preso dalle stazioni e non dal campo, quindi la decisione non lo blocca.

Ricetta e trappole stanno in `strumenti/costa_sdf.py`, che va eseguito una volta
sola: la costa non cambia in fretta.

Misure dell'asset in uso:

| | |
|---|---|
| Sorgente | `coastlines-split-4326` da osmdata.openstreetmap.de, 920 MB, rigenerata ogni giorno |
| Nel riquadro | 7.389 polilinee, 911.012 nodi, 16.593 km di costa |
| Griglia | 4290 x 4220, cioe' 5 volte il dato, 240 m |
| Riquadro | identico a quello del dato, quindi stesse coordinate di texture |
| Metodo | distanza dai segmenti infittiti a 40 m, segno dalla regola della mano |
| Codifica | distanza limitata a 1,6 km e quantizzata in 8 bit, passo 6,3 m |
| Peso | **0,44 MB** in PNG: oltre il fondoscala il campo e' saturo e si comprime a niente |
| Formato in GPU | `R8` con filtraggio `LINEAR`, a differenza del dato che e' intero |
| Costruzione | 75 secondi su 18,1 milioni di punti |

Il fondoscala e' sceso da 2 km a 1,6 km apposta: il byte e' lo stesso e il passo
di quantizzazione scende da 15,7 a 6,3 m, che e' quello che serve vicino a riva.
Lontano da riva il valore non serve a niente.

**Perche' non lisciare il bordo del dato invece di portare la costa da fuori.**
Uno splining del contorno a 1.200 m produrrebbe una curva morbida che passa dove
passa quella a gradini: stessa posizione sbagliata, aspetto piu' convincente.
ADRIAC ha celle da 1 km e non sa dov'e' la costa meglio di cosi'; l'informazione
va presa da una fonte che ce l'ha.

**Margine dalla riva: 250 m, misurati in metri e non in pixel di schermo.**
Anche con il ritaglio sulla costa giusta, il campo che tocca la riva copre la
fascia di battigia, i moli e i porti, cioe' proprio il dettaglio che si guarda
su una carta costiera.

La prima stesura metteva il margine in **pixel di schermo**, con questo
argomento: la leggibilita' si misura sullo schermo, e una scritta occupa gli
stessi pixel a ogni zoom. L'argomento e' giusto e riguarda la cosa sbagliata.
Quello che il campo copre vicino a riva non sono le scritte, sono **moli, porti
e dighe foranee**, che sono oggetti geografici lunghi qualche centinaio di
metri. Un margine in pixel vale sempre **meno metri** man mano che si
ingrandisce: a 18 pixel, a zoom 16 restano 31 m di stacco, e il porto canale
sta ancora sotto il campo proprio allo zoom a cui lo si sta guardando.

In metri il molo si scopre a qualunque ingrandimento, e a zoom basso il margine
scende sotto il pixel da solo: nessun tetto, nessun caso particolare. Lo stacco
a 250 m vale 146 pixel a zoom 16, 73 a zoom 15, 37 a zoom 14 e 5 a zoom 11.

Costo, misurato: il mare dipinto scende dal 98,4% all'80,9% a Unije a zoom 14, e
dall'86,8% al 57,9% su Rimini a zoom 15, dove la vista e' quasi tutta sotto
costa e quindi la fascia si mangia una quota grande di quel che si vede. A zoom
11 il costo e' sotto l'1%.

**Come si sceglie il numero, se va rimesso in discussione.** Non a occhio su una
vista: si guarda il porto piu' lungo che deve restare scoperto. Il margine deve
valere almeno quanto sporge in mare la struttura che si vuole leggere.

**Le scritte sul mare non si risolvono con il margine, e non vanno provate a
risolvere cosi'.** I nomi di baie, porti e isole stanno sotto il campo ovunque,
non solo vicino a riva: nessuna distanza dalla costa li recupera. Si recuperano
mettendo il campo **sotto i livelli di etichetta**, il che richiede una basemap
**vettoriale**: con una raster la tile e' un'immagine sola e non c'e' niente
sotto cui infilarsi. Nella SPA il custom layer va inserito con `beforeId` uguale
all'id del primo livello di simboli. Costo se si sbaglia: si finisce ad alzare il
margine per rimediare a un problema che il margine non tocca, cancellando mare
buono senza recuperare una sola scritta.

**Cosa resta visibile, ed e' giusto che resti.** Dove il modello non ha celle di
mare, per esempio davanti alla foce del Reno per 3,6 km, non c'e' dato e non si
disegna niente. Quella striscia resta scoperta: e' assenza di dato, e riempirla
vorrebbe dire disegnare qualcosa che non abbiamo. Quello che si sfuma e' il
**bordo** dell'assenza, non l'assenza.

**Il bordo del dato si sfuma, non si estende.** Il modello ha celle da 1 km e
considera terra tutta la fascia costiera, e l'ingestore riempie solo entro 800 m
da una cella di mare: fra il bordo del dato e la costa vera resta una frangia
scoperta. Finche' il campo veniva dipinto anche a terra la frangia era nascosta
dallo sbordamento; ritagliando sulla costa vera e' venuta fuori.

Misurata il 2026-08-18 sul frame del 16 agosto:

| | |
|---|---|
| Frangia scoperta entro 2 km dalla costa | 828 celle, circa 1.192 km2 |
| Distanza mediana dal dato piu' vicino | 2,7 km |
| Coperta allargando il riempimento a 2,4 km | 48% |
| Coperta allargando a 3,6 km | 57% |
| Coperta allargando a 5 km | 62% |

**Decisione: si sfuma, non si allarga.** Il campo abbassa l'opacita' dove il dato
si dirada. Non inventa valori: dichiara che li' il dato sta finendo.

**L'opacita' misura quanto si sta estrapolando: la distanza dal BORDO del dato.**
Qui ci sono voluti tre tentativi, e i primi due sbagliavano per la stessa
ragione, cioe' misuravano una cosa che dipende da dove cadono i **campioni**
invece che da dove finisce il **dato**.

Il primo tentativo sfumava in base alla **densita'** di dato intorno al pixel.
Penalizza i filamenti larghi una cella, che sono dato vero al cento per cento, e
li fa comparire a perline dove per caso superano la soglia: erano quelle le
chiazze a rombo davanti al delta del Po. La misura lo ha dimostrato invece di
suggerirlo, perche' il dato del dominio e' un **unico blocco connesso**, zero
isole, quindi le perline non potevano essere dato isolato.

Il secondo tentativo usava la **distanza dal campione valido piu' vicino**, e il
ragionamento sembrava chiuso: zero dentro il dato anche su un filamento sottile,
crescente fuori, continua nella posizione dentro la cella. Sbagliato, e il difetto
si vedeva su tutto il mare aperto. Dentro il dato quella distanza **e' la
distanza dal centro del texel piu' vicino**: continua si', ma **periodica**, con
il passo della griglia. Ogni cella diventava un punto pieno che sfumava verso i
propri angoli, cioe' una scacchiera da un capo all'altro dell'Adriatico. Continuo
e periodico resta visibile: la continuita' non bastava, serviva che la grandezza
fosse **costante** dentro il dato.

La misura giusta e' la **distanza con segno dal bordo del dato**, che vale il
massimo dappertutto dentro e cala solo uscendo. Si porta con un secondo campo di
distanza, costruito come quello della costa ma sulla maschera del modello. Non e'
un costo ricorrente: la maschera di terra del modello **non cambia da un frame
all'altro**, quindi e' un file statico per gruppo di variabili, non per istante.

L'opacita' e' piena fino a 600 m oltre l'ultima cella di dato e si spegne a 1,8
km, cioe' esattamente dove finisce la portata del nucleo che calcola il valore:
le due distanze vanno tenute uguali, se no il campo si spegne mentre ha ancora
valore da mostrare, o peggio si taglia di netto mentre e' ancora visibile.

Verifica: su una vista di mare aperto tutto valido, dipingendo un colore costante
per separare l'opacita' dal dato, lo scarto della luminosita' e' **0,000** e il
picco dello spettro e' **0,000**. La scacchiera non puo' tornare perche'
nell'espressione dell'opacita' non compare piu' nessun termine legato al reticolo.

**La regola generale che vale oltre questo caso.** Qualunque grandezza che
finisce a schermo deve dipendere dalla posizione **solo attraverso il campo che
si vuole mostrare**. Se dipende anche da dove cadono i campioni, il reticolo si
vede: come blocchi se e' costante dentro la cella, come scacchiera se e' continua
ma periodica. La prima forma si nota subito, la seconda no, e sopravvive alle
revisioni proprio per questo.

Le ragioni, in ordine di peso. **La sfumatura serve comunque**: allargando si
copre meta' della frangia, e l'altra meta' e' acqua che il modello non simula
affatto (lagune, canali riparati, insenature), dove non c'e' niente da estendere.
**Gli 800 m hanno un argomento**, la semidiagonale di 707 m che copre ogni punto
interno a una cella di mare; sostituirlo perche' in uno screenshot si vede una
striscia scoperta scambierebbe un ragionamento con una convenienza. **Il raggio
e' inciso nell'indice**, quindi cambiarlo obbliga a rilavorare l'archivio, e
siccome si puo' rilavorare solo dentro la finestra di 8 giorni ogni cambio lascia
una cucitura permanente fra il prima e il dopo.

Costo se la decisione e' sbagliata: una striscia di mare scoperta a ridosso della
costa, larga in mediana 2,7 km, che sfuma invece di terminare a gradini.

**Condizione che la fa riaprire**: se guardando la mappa in uso per piu' giorni e
con stati del mare diversi la frangia risulta un ostacolo alla lettura, e non
solo un fastidio estetico. In quel caso il valore va scelto misurando, non
scegliendo il primo numero che copre lo screenshot del giorno.

**Tetto di zoom: 15.** La maschera rende nitida la **costa**, non il dato: il
campo resta a 1 km. Una cella del modello, alla latitudine dell'Adriatico, vale
22 pixel di schermo a zoom 11, 88 a zoom 13, 353 a zoom 15 e 706 a zoom 16.

Il tetto sta a 15 e non piu' in basso perche' la domanda vera che si fa a questa
mappa e' "com'e' il mare **alla mia spiaggia**", e per rispondere bisogna poter
arrivare sulla spiaggia. A zoom 15 lo schermo mostra circa due celle, quindi il
campo **smette di risolvere sotto gli occhi di chi guarda**, e questo e' il modo
onesto di dire "qui c'e' un numero solo": meglio di un tetto piu' basso, che
nasconde il limite invece di mostrarlo.

Regge perche' l'interpolazione e' liscia e non fabbrica struttura: ingrandendo si
vede una sfumatura, non un dettaglio inventato. Se invece si passasse a un
disegno a classi discrete (le isolinee della sezione 1), il tetto va riesaminato,
perche' una classe con un bordo netto **sembra** una misura precisa anche quando
copre un chilometro.

Costo se il numero e' sbagliato: chi vuole collocare esattamente il proprio
tratto di spiaggia non ci arriva. Si cambia in una riga e non tocca il dato.

### Verificato per esecuzione, 2026-08-18

Una fetta verticale buttabile (una pagina, nessun React) ha caricato un frame vero
dal bucket in una texture intera e lo ha disegnato sopra MapLibre. Esito: il
percorso regge, con quattro fatti da portare nel piano.

1. **MapLibre 5 dà un contesto WebGL2** e la texture `R16I` si carica senza errori
   GL. Il cuore dell'architettura non ha sorprese.
2. **La firma del custom layer è cambiata**: in MapLibre 4 `render(gl, matrice)`,
   in MapLibre 5 `render(gl, opzioni)` con la matrice in
   `opzioni.defaultProjectionData.mainMatrix`. Va scritto nel piano, altrimenti si
   scopre a esecuzione iniziata.
3. **Il quad si posiziona** convertendo `bounds_lonlat` del catalogo con
   `MercatorCoordinate.fromLngLat`. Verificato a zoom 9 sulla costa romagnola: il
   campo segue la battigia da Ravenna a Fano, le isole dalmate restano nodata, e a
   quella scala si vede la scalettatura dei 1.200 m, che è la risoluzione vera.
4. **Costo di disegno trascurabile**: 60 fotogrammi al secondo perfino con resa
   software (SwiftShader), e 1,4 MB scaricati in circa 300 ms.

**La trappola trovata, che il piano deve prevenire.** Le coordinate Mercatore di
MapLibre hanno la **y crescente verso sud**, mentre la riga 0 del frame è quella a
**nord**: senza un ribaltamento esplicito nella coordinata di texture il campo si
disegna capovolto. Il punto non è l'errore, che si corregge in una riga, ma che
**sembra plausibile**: resta una macchia colorata della forma giusta su un mare, e
solo conoscendo la geografia si nota che l'Adriatico corre da Belgrado a Napoli
invece che da Trieste a Otranto. Ne segue che lo smoke test di resa (8.2) non può
limitarsi a "qualcosa è stato disegnato": deve **asserire la posizione**, per
esempio che un pixel al largo di Rimini sia colorato e uno su Bologna no.

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

MapLibre GL JS 5.x. Basemap **vettoriale** Protomaps servita da un `.pmtiles`
sullo stesso bucket (vedi 7.3), con attribuzione OSMF. Overlay nautico OpenSeaMap
(`tiles.openseamap.org/seamark/`), attivabile: sono tile PNG RGBA da circa 1 KB,
trasparenti al 99,6%, quindi un overlay e non una basemap.

Una prima stesura metteva una basemap **raster** OSM, con questa motivazione:
zero setup e sostituibile in un pomeriggio. Superata il 2026-08-18 per una
ragione che il raster non puo' soddisfare: le etichette devono stare **sopra** il
campo, e in una tile raster non esiste un livello di etichette sotto cui
infilarsi. Il pomeriggio e' stato quello.

Con la basemap vettoriale vanno ospitati anche **font e sprite**, se no le
etichette non si disegnano: si copiano nel bucket da `protomaps/basemaps-assets`
(76 KB per intervallo di glifi, 20 KB di sprite). Lasciarli sul dominio di terzi
farebbe finta di non avere dipendenze di esecuzione avendole.

L'overlay seamark è raster e non stilizzabile, con etichette pensate per fondo
chiaro: vincola la basemap a restare chiara. È il motivo per cui non adottiamo una
basemap scura in v1.

La basemap resta il componente piu' intercambiabile dell'architettura: cambiarla
non tocca né il modello dati, né il pacchetto, né il custom layer.

**Versione di MapLibre: 5.x, non 6.** La 6 esiste dal 2026, ma la firma del custom
layer e' gia' cambiata fra la 4 e la 5 (vedi 7.3) ed e' esattamente il genere di
rottura che non si annuncia. La 5 e' verificata per esecuzione su questo dato. Il
passaggio alla 6 si fa quando qualcuno rifa' la stessa fetta verticale su quella
versione, non prima.

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
| Basemap vettoriale Protomaps `.pmtiles` sullo stesso bucket | Le etichette devono stare sopra il campo, e sotto una tile raster non c'e' niente sotto cui infilarsi. Nessuna chiave, nessun servizio di terzi |
| MapLibre 5.x e non 6.x | La firma del custom layer e' gia' cambiata fra la 4 e la 5. La 5 e' verificata per esecuzione su questo dato |
| Colori delle palette nella SPA, non nel pacchetto | I colori sono presentazione, non misura: nel pacchetto si versionerebbe l'estetica insieme al dato |
