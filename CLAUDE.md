# Stato del Mare

Mappa interattiva dello stato del mare in Adriatico dai dati pubblici ARPAE, con
timeline navigabile e riproduzione automatica.

**Leggi `STATO.md` per primo**: dice a che punto siamo, cosa è già deciso e cosa
non va ridiscusso. Il design approvato sta in
`docs/superpowers/specs/2026-08-13-stato-del-mare-design.md`.

## Cosa non fare

- **Niente backend applicativo.** Niente Rails, niente database, niente server
  applicativo. Il dato è di sola lettura, aggiornato a lotti una volta al giorno,
  con query note in anticipo: la SPA legge direttamente dall'object storage.
  L'utente è esperto Rails e ha scartato Rails deliberatamente. Non riproporlo
  senza rimettere in discussione la sezione 1 della spec.
- **Niente trattini lunghi nei file.** Un hook blocca la scrittura di qualsiasi
  file che contenga i due caratteri Unicode di punteggiatura più lunghi del segno
  meno ASCII. Usare virgole, due punti o parentesi. Vale anche quando si vuole
  citare il carattere per documentarlo.
- **Non mettere dati raster in un database.** Un solo giorno di superficie sono
  centinaia di milioni di valori.

## Convenzioni

- Branch di sviluppo: `develop`. `main` è di release.
- Documentazione, commenti e messaggi di commit in **italiano**.
- Spec in `docs/superpowers/specs/`, piani in `docs/superpowers/plans/`, esiti
  delle revisioni in `docs/superpowers/revisioni/`.
- Le decisioni si registrano con il **motivo** e con **cosa costano se sono
  sbagliate**, non solo con l'esito: senza quelle righe verranno rimesse in
  discussione da zero. Le 33 decisioni prese eseguendo l'ingestore stanno in
  `docs/superpowers/revisioni/2026-08-13-ingestore-decisioni.md`.
- I documenti di lavoro delle skill vivono in `.superpowers/`, che è escluso da
  git: quello che deve sopravvivere va copiato in `docs/`.

## Vincolo architetturale

La SPA ha tre strati e il confine non va rotto:

- `src/data/` e `src/map/` sono TypeScript puro e **non conoscono React**;
- `src/ui/` è React e **non gira mai a 60 fps**: il ciclo di animazione vive in
  `src/map/` e riporta il tempo a React al massimo 10 volte al secondo;
- `src/data/` è l'unico modulo che conosce gli URL del bucket.

Lato ingestore, `encode.py` e `grid.py` sono funzioni pure (dentro array, fuori
array); `source.py` e `storage.py` sono gli unici a parlare col mondo esterno e gli
unici da stubbare nei test.

## Comandi

L'ingestore Python esiste ed è completo, in `ingest/`. La SPA non è ancora
iniziata.

```bash
uv run ruff check .
uv run pytest            # suite predefinita: i test di rete restano esclusi
uv run pytest -m rete    # coerenza contro l'archivio ARPAE, scarica circa 23 MB per test
uv run python -m ingest --help
```

I comandi di ispezione delle fonti dati stanno in `STATO.md`, sezione 5. Per
ispezionare un NetCDF senza installare nulla a livello di sistema:

```bash
uv run --quiet --with netCDF4 --with numpy python -c "..."
```

## Fatti che sono costati tempo da stabilire

- I dati veri stanno su `dati-simc.arpae.it/opendata/`, un indice Apache senza
  API. Il portale CKAN `dati.arpae.it` è quasi inutile per il mare.
- **ADRIAC conserva solo 8 giorni.** Ogni giorno senza ingestione è storico perso
  per sempre. Questo dà priorità all'ingestore su tutto il resto.
- Il file di analisi datato `D` contiene i dati di `D-1`. Datare i frame su
  `ocean_time`, mai sul nome del file.
- La griglia sorgente è curvilinea e va ricampionata in Web Mercator in
  ingestione, una volta sola.
