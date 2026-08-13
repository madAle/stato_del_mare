# Stato del lavoro

**Aggiornato:** 2026-08-13 · **Branch:** `develop` · **Fase:** spec approvata e committata, piano di implementazione da scrivere (nessun codice esiste ancora)

Questo file va letto per primo. Poi:

- [docs/superpowers/specs/2026-08-13-stato-del-mare-design.md](docs/superpowers/specs/2026-08-13-stato-del-mare-design.md), il design approvato: modello dati, formato del pacchetto, pipeline, architettura SPA, test. È la fonte di verità su cosa costruire.
- `CLAUDE.md`, contesto stabile e divieti.

## 1. Cos'è il progetto

Mappa interattiva dello stato del mare in Adriatico dai dati pubblici ARPAE, con timeline navigabile avanti e indietro e riproduzione automatica.

## 2. Dove sta il codice e cosa fa ogni pezzo

**Non esiste ancora codice.** Il repo contiene solo la spec. La struttura prevista dalla spec:

```
ingest/           ingestore Python, gira su GitHub Actions una volta al giorno
  config.py       elenco variabili, endpoint, parametri di griglia
  source.py       listing ARPAE, HEAD, download verificato
  grid.py         griglia Mercator e indice di ricampionamento
  encode.py       quantizzazione int16, gzip, direzioni in sin/cos
  frames.py       campi 2D verso frame
  profiles.py     colonne sigma sulle stazioni
  stations.py     parsing BUFR di realtime.jsonl
  storage.py      client R2 (boto3)
  manifest.py     manifest di run e deduplica
  catalog.py      index/ e catalog.json
  reconcile.py    orchestratore
web/
  src/data/       TS puro: fetch da R2, cache LRU, prefetch, scelta an/fc
  src/map/        TS puro: MapLibre, custom layer WebGL, ciclo rAF, shader
  src/ui/         React: scrubber, play/pausa, legenda, status bar
```

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

**Divieti espliciti:**

- Niente trattini lunghi nei file (i due caratteri Unicode di punteggiatura più lunghi del segno meno ASCII): un hook blocca la scrittura. Usare virgole, due punti o parentesi.
- Documentazione e messaggi di commit in italiano.
- Non introdurre un backend applicativo senza rimettere in discussione la sezione 1 della spec.

## 4. Cosa è aperto

### 4a. Blocca il resto, e solo l'utente può farlo

1. **Push del repo su GitHub.** `origin` è configurato (`git@github.com:madAle/stato_del_mare.git`) ma non è mai stato raggiunto: `origin/develop` non esiste. I due commit sono solo locali.
2. **Rendere il repo pubblico.** Su repo pubblici i minuti di GitHub Actions sono illimitati, e questo progetto scarica circa 1,9 GB al giorno. Su repo privato i 2.000 minuti mensili gratuiti diventano un vincolo.
3. **Account Cloudflare, bucket R2, API token, accesso pubblico in lettura, CORS.** Senza credenziali R2 l'ingestore non ha dove scrivere e non si può testare oltre i test unitari.

Punto pratico: finché l'ingestore non gira, **ogni giorno che passa è storico perso per sempre** (finestra ADRIAC di 8 giorni). Questo dà priorità all'ingestore sulla presentabilità della SPA.

### 4b. Attende materiale o terzi

Niente.

### 4c. Da scrivere, in questo ordine

1. **Il piano di implementazione** in `docs/superpowers/plans/`, tramite la skill `superpowers:writing-plans`. Era iniziato e si è interrotto qui.
2. Poi i task del piano, con `superpowers:subagent-driven-development` o `superpowers:executing-plans`.

**Tre correzioni alla spec emerse mentre scrivevo il piano, da applicare prima o durante:**

| Punto spec | Cosa dice | Cosa va corretto e perché |
|---|---|---|
| §5.2, soglia di ricampionamento | 1,5 km | Va portata a circa **800 m**. Le celle sorgente distano 1 km, quindi qualunque punto interno a una cella di mare è entro 707 m dal suo centro (semidiagonale). Con 1,5 km i pixel di destinazione fino a 1,5 km nell'entroterra pescherebbero un valore di mare, producendo una frangia colorata visibile lungo tutta la costa. 800 m copre tutti i punti di mare legittimi e limita lo sbordamento a meno di una cella sorgente. |
| §4.2, percorso dei manifest | `runs/{data}/{kind}/manifest.json` | Serve **un manifest per gruppo di file**: `runs/{data}/{kind}/{gruppo}.json`. In un giorno si lavorano 6 file sorgente diversi per tipo; con un manifest unico, se HPDwave riesce e temp fallisce non si può registrare il progresso parziale. |
| §4.6, profili stazioni | `stations/{id}/columns/{YYYY-MM}.bin` | Vanno **giornalieri**: `{YYYY-MM-DD}.bin`. L'object storage non supporta l'append, quindi un file mensile andrebbe riscritto ogni giorno perdendo l'immutabilità. Giornaliero sono circa 5,8 KB per stazione. |

Inoltre le dimensioni della griglia in §4.4 ("circa 850 x 1.000 celle") sono una stima. Il calcolo reale: il bbox in Mercator è circa 1.029 x 1.053 km, quindi a risoluzione 1.200 m Mercator (che a 43 gradi di latitudine corrisponde a circa 878 m al suolo) vengono **circa 858 x 878 celle**. Le dimensioni esatte le deve produrre `build_grid()` e finire in `grid.json`, non essere cablate.

## 5. Comandi

Nessun comando di build esiste ancora. Questi sono i comandi di ispezione usati per verificare le fonti, utili per ricontrollare senza rifare le scoperte:

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

## 6. Trappole già pagate, da non ripagare

**Il file di analisi datato `D` contiene i dati di `D-1`.** Verificato: `20260813_..._his_HPDwave_an.nc` copre dalle 01:00 del 12 alle 00:00 del 13. Datare i frame su `ocean_time`, mai sul nome del file, altrimenti tutto l'archivio slitta di 24 ore.

**La griglia ADRIAC è curvilinea, non lat/lon regolare.** `lon_rho` varia lungo la direzione eta (da 17,7150 a 10,8437 sulla colonna 0). Appoggiare l'array sulla mappa come rettangolo nord-sud lo disegna storto.

**Le velocità sono già proiettate su est/nord.** `ubar_eastward` e `vbar_northward`, e anche il file 3D `his_cur` ha dimensioni `s_rho, eta_rho, xi_rho`, cioè punti rho e non griglie sfalsate u/v. Non serve nessuna rotazione dei vettori. Verificato leggendo l'intestazione senza scaricare i 640 MB.

**Le texture intere in WebGL non supportano il filtraggio bilineare hardware.** Con `R16UI` e `usampler2D` il filtro è per forza `NEAREST`. L'interpolazione va scritta nello shader con quattro `texelFetch`, il che è anche meglio perché permette di escludere i vicini `nodata` invece di mediarli (col filtro hardware ogni costa avrebbe un alone di valori sbagliati).

**ADRIAC tiene solo 8 giorni.** Verificato: il 13 agosto il file più vecchio era del 6. Non esiste archivio storico a monte. Ogni giorno senza ingestione è perso e non recuperabile in nessun modo.

**Il dataset `swanemr` è morto.** Il CKAN `dati.arpae.it` lo elenca ancora sotto `previsioni-mare`, ma la directory è ferma a settembre 2025. Non perderci tempo.

**Il CKAN `dati.arpae.it` è quasi inutile per il mare.** Una sola ricerca utile su 259 dataset. I dati veri stanno su `dati-simc.arpae.it/opendata/`, che è un indice Apache senza API.

**Un hook blocca i trattini lunghi.** Scrivere un file che li contiene fallisce con "Contenuto bloccato". Attenzione al caso ricorsivo: anche *citare* il carattere per documentare il divieto fa fallire la scrittura. Costa una riscrittura completa del file se ci si accorge tardi.

**`netCDF4`, `numpy`, `scipy` non sono installati a livello di sistema.** Usare `uv run --with netCDF4 --with numpy python -c ...` per le ispezioni al volo. `ncdump` e `gdalinfo` non esistono su questa macchina.

## 7. Stato git

- Repo unico: `/Users/ale/source/personal/stato_del_mare`
- Branch: `develop` (nessun `main` locale)
- Working tree pulito
- Remote: `origin` = `git@github.com:madAle/stato_del_mare.git`
- **`origin/develop` non esiste: il repo non è mai stato pushato.**

```
add3603  docs: livello del mare a piena risoluzione in analisi
0c74784  docs: design di Stato del Mare
```
