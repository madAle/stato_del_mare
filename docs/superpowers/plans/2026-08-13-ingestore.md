# Ingestore ARPAE Implementation Plan

> **Stato al 2026-08-21: eseguito.** I 15 task sono chiusi, l'ingestore e' in
> produzione e gira ogni ora. Le decisioni prese eseguendolo stanno in
> `docs/superpowers/revisioni/2026-08-13-ingestore-decisioni.md` (34). Lo stato
> del lavoro sta in `STATO.md`: questo piano e' storia.


> **PIANO ESEGUITO E SUPERATO. Non rieseguirlo alla lettera.**
>
> L'ingestore e' stato costruito con questo piano fra il 13 e il 14 agosto 2026,
> ed e' in produzione dal 17. Da allora la revisione, la ri-revisione e il primo
> run reale hanno cambiato diverse decisioni, e **i frammenti di codice qui sotto
> sono anteriori a quelle correzioni**: rieseguirli come sono reintrodurrebbe due
> dei tre difetti critici gia' chiusi, fra cui il rename di variabile che usciva
> 1 invece di 2 e faceva ritentare il cron per sempre mentre la finestra di 8
> giorni scorreva via.
>
> Il documento resta perche' e' il ragionamento con cui l'ingestore e' nato, non
> perche' sia una istruzione valida. **La verita' corrente sta nel codice in
> `ingest/`, nella spec e in `STATO.md`**; le 33 decisioni prese eseguendolo
> stanno in `docs/superpowers/revisioni/2026-08-13-ingestore-decisioni.md`.
>
> **For agentic workers:** this plan is done. Read the spec, not this.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un programma Python che ogni giorno scarica i dati ARPAE ADRIAC, li normalizza e li deposita su object storage in un formato auto-descrittivo, idempotente e riprendibile dopo un guasto.

**Architecture:** Riconciliazione, non "scarica oggi": il programma confronta la finestra sorgente di 8 giorni con il contenuto del bucket e colma la differenza. I campi 2D vengono ricampionati una volta sola su una griglia Web Mercator, quantizzati a int16 e caricati come file gzip immutabili, uno per variabile per istante. Ogni file sorgente lavorato produce un manifest con provenienza e checksum, che è anche la base della deduplica. Il catalogo si scrive sempre per ultimo.

**Tech Stack:** Python 3.12, netCDF4, numpy, scipy (cKDTree), boto3, requests. Test con pytest, moto, responses. Gestione dipendenze con uv.

**Spec:** `docs/superpowers/specs/2026-08-13-stato-del-mare-design.md`

**Nota:** questo piano copre **solo l'ingestore**. La SPA avrà un piano separato, da scrivere quando il contratto dati esisterà davvero su R2, così da poterlo scrivere contro dati osservabili invece che contro una specifica.

**Cosa resta fuori e perché non è un problema.** La spec elenca in 4.2 anche `stations/{id}/obs/{YYYY-MM}.json`, cioè le osservazioni misurate dalle boe. Questo piano costruisce l'anagrafica delle stazioni ma non archivia le osservazioni, e la ragione è che **non sono deperibili**: ARPAE le conserva in `opendata/osservati/meteo/storico/` fin dal 2006, quindi si recuperano in qualunque momento. Il principio "l'ingestione è golosa" nasce dalla finestra di 8 giorni di ADRIAC e si applica solo a ciò che ARPAE cancella. Confondere le due cose porterebbe a scrivere subito codice che si può scrivere con comodo.

## Global Constraints

- Python 3.12 o superiore.
- **Niente trattini lunghi in nessun file** (i due caratteri Unicode di punteggiatura più lunghi del segno meno ASCII). Un hook blocca la scrittura. Vale anche nei commenti e nei messaggi di commit.
- Commenti, docstring e messaggi di commit in **italiano**.
- Branch di sviluppo: `develop`.
- `NODATA = -32768`, intervallo utile int16 da `-32767` a `32767`.
- Tutti gli istanti sono **UTC**, con `tzinfo` esplicito. Mai datetime naive fuori dal parsing.
- I frame sono **immutabili**: `Cache-Control: public, max-age=31536000, immutable`. I file JSON di catalogo e indice cambiano: `Cache-Control: public, max-age=300`.
- L'archivio **non sovrascrive mai** un frame esistente con contenuto diverso.
- `encode.py` e `grid.py` sono funzioni pure: dentro array, fuori array. Solo `source.py` e `storage.py` parlano col mondo esterno, e sono gli unici da stubbare nei test.

### Correzioni alla spec applicate da questo piano

La spec è stata approvata prima che queste emergessero. Questo piano le applica; la spec va allineata a fine implementazione.

| Punto spec | Spec dice | Piano usa | Perché |
|---|---|---|---|
| 5.2 soglia vicini | 1,5 km | **800 m** | Le celle sorgente distano 1 km, quindi un punto interno a una cella di mare è entro 707 m dal centro (semidiagonale). Con 1,5 km i pixel fino a 1,5 km nell'entroterra pescano un valore di mare e si vede una frangia colorata lungo tutta la costa. |
| 4.2 manifest | `runs/{data}/{kind}/manifest.json` | `runs/{data}/{kind}/{gruppo}.json` | In un giorno si lavorano più file sorgente per tipo. Con un manifest unico, se un gruppo riesce e un altro fallisce il progresso parziale non si registra. |
| 4.6 profili | `{YYYY-MM}.bin` | `{YYYY-MM-DD}.bin` | L'object storage non supporta l'append: un file mensile andrebbe riscritto ogni giorno, perdendo l'immutabilità. |
| 4.4 griglia | "circa 850 x 1.000 celle" | calcolata da `build_grid()` | Era una stima. Il valore reale va prodotto dal codice e scritto in `grid.json`, mai cablato. |

## File Structure

```
pyproject.toml               dipendenze, configurazione pytest e ruff
.gitignore
.github/workflows/ingest.yml cron di ingestione
docs/setup-r2.md             istruzioni per la configurazione manuale del bucket

ingest/
  __init__.py
  config.py       costanti, FieldSpec, elenco variabili, regole di campionamento
  encode.py       quantizzazione int16, direzioni in sin/cos, compressione
  grid.py         Mercator, griglia di destinazione, indice di ricampionamento
  storage.py      client S3/R2: put, get, exists
  source.py       elenco file ARPAE, HEAD, download verificato
  manifest.py     record di frame e di run, serializzazione, deduplica
  frames.py       da NetCDF a frame 2D
  stations.py     anagrafica stazioni marine da realtime.jsonl
  profiles.py     colonne sigma sulle stazioni dai file 3D
  catalog.py      indici mensili e catalog.json
  reconcile.py    orchestratore
  __main__.py     CLI

tests/
  conftest.py       fixture NetCDF sintetici
  test_encode.py
  test_grid.py
  test_storage.py
  test_source.py
  test_manifest.py
  test_frames.py
  test_stations.py
  test_profiles.py
  test_catalog.py
  test_reconcile.py
  test_coerenza.py  test di coerenza end-to-end contro dati reali
```

---

### Task 1: Scaffolding e configurazione statica

**Files:**
- Create: `pyproject.toml`
- Create: `.gitignore`
- Create: `ingest/__init__.py`
- Create: `ingest/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: niente
- Produces: `ADRIAC_BASE: str`, `OBSERVED_REALTIME: str`, `SCHEMA_VERSION: int`, `INGEST_VERSION: str`, `NODATA: int`, `INT16_MIN: int`, `INT16_MAX: int`, `GRID_RESOLUTION_M: float`, `MAX_NEIGHBOUR_DISTANCE_M: float`, `WINDOW_DAYS: int`, `OBSERVED_NETWORKS: tuple[str, ...]`, `FieldSpec` (dataclass frozen con campi `id, group, nc_name, scale, units, colormap, transform, offset`), `FIELDS: tuple[FieldSpec, ...]`, `FIELD_GROUPS: tuple[str, ...]`, `PROFILE_GROUPS: tuple[tuple[str, tuple[str, ...]], ...]`, `fields_for(group: str) -> tuple[FieldSpec, ...]`, `sampling_for(group: str, kind: str) -> str`

- [ ] **Step 1: Creare `pyproject.toml`**

```toml
[project]
name = "stato-del-mare-ingest"
version = "0.1.0"
description = "Ingestore dei dati ARPAE ADRIAC verso object storage"
requires-python = ">=3.12"
dependencies = [
    "netCDF4>=1.6",
    "numpy>=1.26",
    "scipy>=1.11",
    "boto3>=1.34",
    "requests>=2.31",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "moto[s3]>=5.0",
    "responses>=0.25",
    "ruff>=0.5",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
# Necessario perche' i test importano le fixture con `from tests.conftest
# import ...`: senza la radice sul path, pytest importa conftest come modulo
# di primo livello e quell'import fallisce.
pythonpath = ["."]
# "Output pristine" e' un vincolo del progetto: qui diventa verificabile invece
# che dichiarato. Senza questa riga un avviso passa inosservato e viene riportato
# come suite pulita, che e' esattamente quello che era successo con due
# DeprecationWarning di NumPy nelle fixture.
filterwarnings = [
    "error",
    # Unica eccezione, e va tenuta stretta: netCDF4 1.7.4 imposta `.shape` su un
    # array dentro il proprio percorso di scrittura, cosa che NumPy 2.5 ha
    # deprecato. E' codice di libreria e non esiste una versione piu' recente;
    # le due occorrenze nostre dello stesso schema sono state corrette con
    # `.copy()`. Da rimuovere quando netCDF4 si adegua: a quel punto la riga
    # diventa inerte e la sua rimozione non rompe niente.
    "ignore:Setting the shape on a NumPy array has been deprecated:DeprecationWarning",
]

[tool.ruff]
line-length = 100

[tool.ruff.lint]
# Insieme fissato in modo esplicito. Senza, il progetto eredita le regole
# predefinite del giorno, e un aggiornamento di ruff puo' far diventare rosso
# il progetto senza che nessuno abbia toccato il codice.
# E4/E7/E9 e F sono errori veri (sintassi, nomi non definiti, import inutilizzati),
# I tiene ordinati gli import. Le regole di ammodernamento stilistico restano fuori:
# qui `timezone.utc` e' usato in modo uniforme e va bene cosi'.
select = ["E4", "E7", "E9", "F", "I"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["ingest"]
```

- [ ] **Step 2: Creare `.gitignore`**

```
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.venv/
*.nc
*.nc.gz
*.npz
.env
.superpowers/
.claude/worktrees/
```

Le ultime due righe sono scratch degli strumenti di sviluppo e non devono mai finire nel repo. Se il file esiste gia' con quelle righe, conservarle e aggiungere le altre.

- [ ] **Step 3: Scrivere il test di configurazione**

Creare `tests/test_config.py`:

```python
"""La configurazione e' dati, non codice: questi test la difendono da refusi."""
from ingest import config


def test_gli_id_dei_campi_sono_unici():
    ids = [f.id for f in config.FIELDS]
    assert len(ids) == len(set(ids))


def test_ogni_campo_ha_scala_positiva():
    for f in config.FIELDS:
        assert f.scale > 0, f.id


def test_le_trasformazioni_sono_note():
    for f in config.FIELDS:
        assert f.transform in ("identity", "sin", "cos"), f.id


def test_la_direzione_ha_entrambe_le_componenti():
    trasformazioni = {f.transform for f in config.FIELDS if f.nc_name == "Dwave"}
    assert trasformazioni == {"sin", "cos"}


def test_fields_for_filtra_per_gruppo():
    onde = config.fields_for("his_HPDwave")
    assert {f.id for f in onde} == {"hwave", "pwave", "dwave_sin", "dwave_cos"}


def test_il_livello_del_mare_e_orario_solo_in_previsione():
    assert config.sampling_for("qck_sl", "an") == "full"
    assert config.sampling_for("qck_sl", "fc") == "hourly"
    assert config.sampling_for("his_HPDwave", "fc") == "full"
```

- [ ] **Step 4: Eseguire il test e verificare che fallisca**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest'`

- [ ] **Step 5: Scrivere `ingest/__init__.py` e `ingest/config.py`**

`ingest/__init__.py` vuoto.

`ingest/config.py`:

```python
"""Configurazione statica: endpoint, variabili, regole di campionamento.

Questo modulo non fa I/O e non importa nulla del progetto: e' la radice
del grafo delle dipendenze.
"""

from dataclasses import dataclass

ADRIAC_BASE = "https://dati-simc.arpae.it/opendata/adriac/"
OBSERVED_REALTIME = (
    "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl"
)

SCHEMA_VERSION = 1
INGEST_VERSION = "0.1.0"

# -32768 e' riservato al nodata, quindi l'intervallo utile e' asimmetrico.
NODATA = -32768
INT16_MIN = -32767
INT16_MAX = 32767

# Risoluzione della griglia di destinazione, in metri Web Mercator.
# A 43 gradi di latitudine corrisponde a circa 878 m al suolo, cioe' la
# risoluzione reale del modello ADRIAC (1 km).
GRID_RESOLUTION_M = 1200.0

# Distanza massima fra il centro di una cella di destinazione e il centro
# della cella di mare sorgente piu' vicina. Vedi le note in testa al piano:
# 800 m copre tutti i punti interni a una cella sorgente (semidiagonale 707 m)
# e limita lo sbordamento sulla terraferma a meno di una cella.
MAX_NEIGHBOUR_DISTANCE_M = 800.0

# ADRIAC conserva 8 giorni. Oltre questa finestra non c'e' nulla da riconciliare.
WINDOW_DAYS = 8

OBSERVED_NETWORKS = ("boa", "marefe")


@dataclass(frozen=True)
class FieldSpec:
    """Un array pubblicato.

    Piu' FieldSpec possono leggere la stessa variabile NetCDF: le direzioni
    producono due array (seno e coseno) dalla stessa sorgente.
    """

    id: str
    group: str
    nc_name: str
    scale: float
    units: str
    colormap: str
    transform: str = "identity"
    offset: float = 0.0


FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("hwave", "his_HPDwave", "Hwave", 0.001, "m", "amp"),
    FieldSpec("pwave", "his_HPDwave", "Pwave_top", 0.01, "s", "tempo"),
    FieldSpec("dwave_sin", "his_HPDwave", "Dwave", 0.0001, "1", "phase", "sin"),
    FieldSpec("dwave_cos", "his_HPDwave", "Dwave", 0.0001, "1", "phase", "cos"),
    FieldSpec("ubar", "his_2dcur", "ubar_eastward", 0.001, "m s-1", "speed"),
    FieldSpec("vbar", "his_2dcur", "vbar_northward", 0.001, "m s-1", "speed"),
    FieldSpec("sealevel", "qck_sl", "sea_level", 0.001, "m", "balance"),
)

FIELD_GROUPS: tuple[str, ...] = tuple(dict.fromkeys(f.group for f in FIELDS))

# Gruppi 3D da cui estrarre i profili verticali sulle stazioni.
# Solo da file di analisi: i profili da previsione costerebbero circa
# 2,8 GB al giorno di download per un caso d'uso non previsto.
# Tutte e tre le variabili stanno su punti rho, verificato sulle intestazioni.
PROFILE_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("his_temp", ("temp",)),
    ("his_salt", ("salt",)),
    ("his_cur", ("u_eastward", "v_northward")),
)

# "full" tiene tutti gli istanti del file, "hourly" solo quelli al minuto 00.
_SAMPLING: dict[tuple[str, str], str] = {
    ("qck_sl", "fc"): "hourly",
}
DEFAULT_SAMPLING = "full"


def sampling_for(group: str, kind: str) -> str:
    return _SAMPLING.get((group, kind), DEFAULT_SAMPLING)


def fields_for(group: str) -> tuple[FieldSpec, ...]:
    return tuple(f for f in FIELDS if f.group == group)
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS, 6 test

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml .gitignore ingest/__init__.py ingest/config.py tests/test_config.py
git commit -m "feat: scaffolding e configurazione statica dell'ingestore"
```

---

### Task 2: Codifica dei valori

**Files:**
- Create: `ingest/encode.py`
- Test: `tests/test_encode.py`

**Interfaces:**
- Consumes: `config.NODATA`, `config.INT16_MIN`, `config.INT16_MAX`
- Produces:
  - `quantize(values: np.ndarray, scale: float, offset: float = 0.0) -> tuple[np.ndarray, dict]` dove il secondo elemento ha chiavi `min`, `max`, `nodata_count`, `clipped_count`. Il primo e' `int16`. Valori non finiti diventano `NODATA`.
  - `dequantize(raw: np.ndarray, scale: float, offset: float = 0.0) -> np.ndarray` restituisce float con `NaN` dove `NODATA`.
  - `direction_component(degrees: np.ndarray, component: str) -> np.ndarray`
  - `apply_transform(values: np.ndarray, transform: str) -> np.ndarray`
  - `compress(raw: np.ndarray) -> bytes`
  - `decompress(blob: bytes) -> np.ndarray`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_encode.py`:

```python
"""La codifica e' il punto in cui i numeri diventano byte d'archivio.
Un errore qui non si vede e non si recupera, quindi si testa il giro completo.
"""
import numpy as np
import pytest

from ingest import encode
from ingest.config import NODATA


def test_giro_completo_conserva_il_valore_entro_la_quantizzazione():
    valori = np.array([0.0, 0.5, 1.234, 31.999], dtype=np.float64)
    raw, _ = encode.quantize(valori, scale=0.001)
    tornati = encode.dequantize(raw, scale=0.001)
    assert np.allclose(tornati, valori, atol=0.0005)


def test_i_valori_non_finiti_diventano_nodata():
    valori = np.array([1.0, np.nan, 2.0], dtype=np.float64)
    raw, stats = encode.quantize(valori, scale=0.001)
    assert raw[1] == NODATA
    assert stats["nodata_count"] == 1
    assert np.isnan(encode.dequantize(raw, 0.001)[1])


def test_il_nodata_non_entra_nel_minimo_e_massimo():
    valori = np.array([np.nan, 5.0, 7.0], dtype=np.float64)
    _, stats = encode.quantize(valori, scale=0.001)
    assert stats["min"] == pytest.approx(5.0, abs=0.001)
    assert stats["max"] == pytest.approx(7.0, abs=0.001)


def test_i_valori_fuori_scala_vengono_tosati_e_contati():
    # Con scale 0.001 il fondoscala e' 32,767 metri.
    valori = np.array([1.0, 40.0], dtype=np.float64)
    raw, stats = encode.quantize(valori, scale=0.001)
    assert stats["clipped_count"] == 1
    assert raw[1] == 32767


def test_il_conteggio_dei_tosati_non_si_confonde_al_limite():
    """La fascia stretta appena oltre il fondoscala.

    32767,4 in unita' grezze arrotonda a 32767, che e' rappresentabile: non
    e' stato tosato nulla. Contando sul valore non arrotondato risulterebbe
    tosato, e la statistica finirebbe falsa nel manifest permanente.
    """
    raw, stats = encode.quantize(np.array([32767.4 * 0.001]), scale=0.001)
    assert raw[0] == 32767
    assert stats["clipped_count"] == 0

    raw, stats = encode.quantize(np.array([32768.0 * 0.001]), scale=0.001)
    assert raw[0] == 32767
    assert stats["clipped_count"] == 1


def test_il_troncamento_e_simmetrico_verso_il_basso():
    raw, stats = encode.quantize(np.array([-40.0]), scale=0.001)
    assert raw[0] == -32767
    assert stats["clipped_count"] == 1


def test_un_array_tutto_nodata_non_esplode():
    valori = np.array([np.nan, np.nan], dtype=np.float64)
    raw, stats = encode.quantize(valori, scale=0.001)
    assert np.all(raw == NODATA)
    assert stats["min"] is None
    assert stats["max"] is None
    assert stats["nodata_count"] == 2


def test_le_componenti_di_direzione():
    gradi = np.array([0.0, 90.0, 180.0, 270.0])
    seno = encode.direction_component(gradi, "sin")
    coseno = encode.direction_component(gradi, "cos")
    assert np.allclose(seno, [0.0, 1.0, 0.0, -1.0], atol=1e-12)
    assert np.allclose(coseno, [1.0, 0.0, -1.0, 0.0], atol=1e-12)


def test_la_media_di_359_e_1_grado_e_zero_non_180():
    """Il motivo per cui le direzioni si archiviano come sin e cos.

    Mediando gli angoli si otterrebbe 180 gradi, cioe' la direzione opposta.
    """
    gradi = np.array([359.0, 1.0])
    s = encode.direction_component(gradi, "sin").mean()
    c = encode.direction_component(gradi, "cos").mean()
    ricostruito = np.degrees(np.arctan2(s, c)) % 360.0
    assert ricostruito == pytest.approx(0.0, abs=1e-9) or ricostruito == pytest.approx(
        360.0, abs=1e-9
    )
    assert np.mean(gradi) == 180.0  # la trappola che stiamo evitando


def test_la_direzione_conserva_il_nodata():
    gradi = np.array([90.0, np.nan])
    assert np.isnan(encode.direction_component(gradi, "sin")[1])


def test_compressione_e_decompressione():
    raw = np.array([1, -2, NODATA, 30000], dtype=np.int16)
    blob = encode.compress(raw)
    assert isinstance(blob, bytes)
    assert np.array_equal(encode.decompress(blob), raw)


def test_la_compressione_riduce_i_campi_lisci():
    raw = np.full(100_000, 1234, dtype=np.int16)
    assert len(encode.compress(raw)) < raw.nbytes // 10
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_encode.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.encode'`

- [ ] **Step 3: Scrivere `ingest/encode.py`**

```python
"""Quantizzazione, trasformazioni e compressione.

Funzioni pure: dentro array, fuori array. Nessun I/O, nessuna dipendenza
dal resto del progetto oltre alle costanti.
"""

import gzip

import numpy as np

from .config import INT16_MAX, INT16_MIN, NODATA

_COMPRESS_LEVEL = 6


def _as_float(values: np.ndarray) -> np.ndarray:
    """Porta a float64 semplice, con NaN dove l'array e' mascherato."""
    if np.ma.isMaskedArray(values):
        return np.ma.filled(values.astype(np.float64), np.nan)
    return np.asarray(values, dtype=np.float64)


def quantize(
    values: np.ndarray, scale: float, offset: float = 0.0
) -> tuple[np.ndarray, dict]:
    """Converte valori fisici in int16.

    Restituisce l'array e le statistiche che finiscono nel manifest:
    minimo e massimo in unita' fisiche (None se non c'e' nessun valore
    valido), quanti nodata e quanti valori tosati.
    """
    arr = _as_float(values)
    valid = np.isfinite(arr)

    out = np.full(arr.shape, NODATA, dtype=np.int16)
    clipped = 0
    minimo: float | None = None
    massimo: float | None = None

    if valid.any():
        # Si arrotonda prima di confrontare con i limiti, non dopo: il valore
        # memorizzato e' l'arrotondato tosato, quindi contare i troncamenti sul
        # non arrotondato dichiarerebbe tosati dei valori che l'arrotondamento
        # da solo riporta in scala (tutta la fascia fra 32767 e 32767,5).
        # clipped_count finisce nel manifest permanente: deve dire il vero.
        grezzi = np.rint((arr[valid] - offset) / scale)
        clipped = int(np.count_nonzero((grezzi < INT16_MIN) | (grezzi > INT16_MAX)))
        out[valid] = np.clip(grezzi, INT16_MIN, INT16_MAX).astype(np.int16)
        minimo = float(arr[valid].min())
        massimo = float(arr[valid].max())

    stats = {
        "min": minimo,
        "max": massimo,
        "nodata_count": int(np.count_nonzero(~valid)),
        "clipped_count": clipped,
    }
    return out, stats


def dequantize(raw: np.ndarray, scale: float, offset: float = 0.0) -> np.ndarray:
    """Inverso di quantize. I nodata tornano NaN."""
    out = raw.astype(np.float64) * scale + offset
    out[raw == NODATA] = np.nan
    return out


def direction_component(degrees: np.ndarray, component: str) -> np.ndarray:
    """Seno o coseno di una direzione in gradi.

    Le direzioni non si archiviano come angoli perche' 359 e 1 grado sono
    adiacenti ma la loro media lineare e' 180, cioe' il verso opposto.
    Interpolare seno e coseno separatamente e' invece corretto.
    """
    rad = np.deg2rad(_as_float(degrees))
    if component == "sin":
        return np.sin(rad)
    if component == "cos":
        return np.cos(rad)
    raise ValueError(f"componente non riconosciuta: {component}")


def apply_transform(values: np.ndarray, transform: str) -> np.ndarray:
    if transform == "identity":
        return _as_float(values)
    if transform in ("sin", "cos"):
        return direction_component(values, transform)
    raise ValueError(f"trasformazione non riconosciuta: {transform}")


def compress(raw: np.ndarray) -> bytes:
    """int16 little endian, gzip.

    Il file viene poi caricato con Content-Encoding: gzip, cosi' il browser
    lo decomprime da solo e il client non ha bisogno di alcuna libreria.
    """
    return gzip.compress(raw.astype("<i2").tobytes(), compresslevel=_COMPRESS_LEVEL)


def decompress(blob: bytes) -> np.ndarray:
    return np.frombuffer(gzip.decompress(blob), dtype="<i2")
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_encode.py -v`
Expected: PASS, 10 test

- [ ] **Step 5: Commit**

```bash
git add ingest/encode.py tests/test_encode.py
git commit -m "feat: quantizzazione int16, direzioni in sin/cos, compressione"
```

---

### Task 3: Griglia Web Mercator e impronta delle coordinate

**Files:**
- Create: `ingest/grid.py`
- Test: `tests/test_grid.py`

**Interfaces:**
- Consumes: `config.GRID_RESOLUTION_M`
- Produces:
  - `MercatorGrid` dataclass frozen con campi `x_min, x_max, y_min, y_max` (metri EPSG:3857), `width, height` (int), `resolution` (float)
  - `lonlat_to_mercator(lon, lat) -> tuple[np.ndarray, np.ndarray]`
  - `mercator_to_lonlat(x, y) -> tuple[np.ndarray, np.ndarray]`
  - `build_grid(lon_rho, lat_rho, resolution=config.GRID_RESOLUTION_M) -> MercatorGrid`
  - `grid_centres(grid: MercatorGrid) -> tuple[np.ndarray, np.ndarray]` centri dei pixel in metri Mercator, appiattiti in ordine C
  - `grid_to_dict(grid: MercatorGrid) -> dict`
  - `coordinate_fingerprint(lon_rho, lat_rho) -> str` SHA-256 esadecimale

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_grid.py`:

```python
"""La griglia di destinazione e l'impronta delle coordinate sorgente."""
import json

import numpy as np
import pytest

from ingest import grid


def test_giro_completo_mercator():
    lon = np.array([12.0, 20.0, -5.0])
    lat = np.array([44.0, 39.5, 60.0])
    x, y = grid.lonlat_to_mercator(lon, lat)
    lon2, lat2 = grid.mercator_to_lonlat(x, y)
    assert np.allclose(lon, lon2)
    assert np.allclose(lat, lat2)


def test_l_equatore_ha_ordinata_zero():
    _, y = grid.lonlat_to_mercator(np.array([0.0]), np.array([0.0]))
    assert y[0] == pytest.approx(0.0, abs=1e-9)


def test_la_griglia_copre_i_dati_e_ha_dimensioni_intere():
    lon = np.array([[12.0, 12.5], [12.2, 12.7]])
    lat = np.array([[44.0, 44.2], [44.5, 44.7]])
    g = grid.build_grid(lon, lat, resolution=1000.0)
    assert g.width > 0 and g.height > 0
    x, y = grid.lonlat_to_mercator(lon, lat)
    assert g.x_min <= x.min() and g.x_max >= x.max()
    assert g.y_min <= y.min() and g.y_max >= y.max()


def test_i_centri_sono_uno_per_pixel_in_ordine_c():
    lon = np.array([[12.0, 12.5], [12.2, 12.7]])
    lat = np.array([[44.0, 44.2], [44.5, 44.7]])
    g = grid.build_grid(lon, lat, resolution=5000.0)
    cx, cy = grid.grid_centres(g)
    assert cx.shape == (g.height * g.width,)
    # La prima riga e' quella piu' a nord: y decresce scorrendo l'array.
    assert cy[0] > cy[-1]
    # Dentro una riga x cresce.
    assert cx[1] > cx[0]


def test_l_impronta_cambia_se_cambiano_le_coordinate():
    lon = np.array([[12.0, 12.5]])
    lat = np.array([[44.0, 44.2]])
    prima = grid.coordinate_fingerprint(lon, lat)
    assert prima == grid.coordinate_fingerprint(lon.copy(), lat.copy())
    lon2 = lon.copy()
    lon2[0, 0] += 0.0001
    assert grid.coordinate_fingerprint(lon2, lat) != prima


def test_il_dizionario_della_griglia_e_serializzabile():
    lon = np.array([[12.0, 12.5]])
    lat = np.array([[44.0, 44.2]])
    g = grid.build_grid(lon, lat, resolution=1000.0)
    d = grid.grid_to_dict(g)
    json.dumps(d)  # non deve sollevare
    assert d["crs"] == "EPSG:3857"
    assert d["width"] == g.width
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_grid.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.grid'`

- [ ] **Step 3: Scrivere `ingest/grid.py`** (prima parte, l'indice arriva nel Task 4)

```python
"""Griglia di destinazione in Web Mercator e impronta delle coordinate sorgente.

La griglia sorgente ADRIAC e' curvilinea (ruotata lungo l'asse dell'Adriatico),
quindi non puo' essere appoggiata su una mappa come rettangolo nord-sud.
Il ricampionamento in Web Mercator si fa qui, una volta sola, in ingestione.
"""

import hashlib
from dataclasses import dataclass

import numpy as np

from .config import GRID_RESOLUTION_M

# Raggio della sfera usata da Web Mercator (EPSG:3857).
EARTH_RADIUS_M = 6378137.0


@dataclass(frozen=True)
class MercatorGrid:
    """Raster di destinazione, in metri EPSG:3857.

    L'origine dei pixel e' l'angolo in alto a sinistra: la riga 0 e' la
    piu' a nord, coerentemente con l'ordine di lettura di una texture.
    """

    x_min: float
    x_max: float
    y_min: float
    y_max: float
    width: int
    height: int
    resolution: float


def lonlat_to_mercator(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    x = np.radians(lon) * EARTH_RADIUS_M
    y = EARTH_RADIUS_M * np.log(np.tan(np.pi / 4.0 + np.radians(lat) / 2.0))
    return x, y


def mercator_to_lonlat(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    lon = np.degrees(x / EARTH_RADIUS_M)
    lat = np.degrees(2.0 * np.arctan(np.exp(y / EARTH_RADIUS_M)) - np.pi / 2.0)
    return lon, lat


def build_grid(lon_rho, lat_rho, resolution: float = GRID_RESOLUTION_M) -> MercatorGrid:
    """Costruisce il raster che contiene tutta la griglia sorgente.

    Le dimensioni si calcolano dai dati e non vanno mai cablate: se ARPAE
    cambia il dominio, il numero di celle cambia con lui.
    """
    x, y = lonlat_to_mercator(lon_rho, lat_rho)
    x_min, x_max = float(x.min()), float(x.max())
    y_min, y_max = float(y.min()), float(y.max())
    width = int(np.ceil((x_max - x_min) / resolution))
    height = int(np.ceil((y_max - y_min) / resolution))
    return MercatorGrid(
        x_min=x_min,
        x_max=x_min + width * resolution,
        y_min=y_max - height * resolution,
        y_max=y_max,
        width=width,
        height=height,
        resolution=resolution,
    )


def grid_centres(g: MercatorGrid):
    """Centri dei pixel in metri Mercator, appiattiti in ordine C.

    L'ordine e' lo stesso di un array (height, width) letto riga per riga,
    dall'alto verso il basso: e' l'ordine in cui il frame viene poi scritto.
    """
    xs = g.x_min + (np.arange(g.width) + 0.5) * g.resolution
    ys = g.y_max - (np.arange(g.height) + 0.5) * g.resolution
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    return gx.ravel(), gy.ravel()


def grid_to_dict(g: MercatorGrid) -> dict:
    """Il descrittore che finisce in grid.json e che il client usa per
    posizionare la texture sulla mappa."""
    west, south = mercator_to_lonlat(np.array(g.x_min), np.array(g.y_min))
    east, north = mercator_to_lonlat(np.array(g.x_max), np.array(g.y_max))
    return {
        "crs": "EPSG:3857",
        "x_min": g.x_min,
        "x_max": g.x_max,
        "y_min": g.y_min,
        "y_max": g.y_max,
        "width": g.width,
        "height": g.height,
        "resolution_m": g.resolution,
        "bounds_lonlat": {
            "west": float(west),
            "south": float(south),
            "east": float(east),
            "north": float(north),
        },
    }


def coordinate_fingerprint(lon_rho, lat_rho) -> str:
    """Impronta delle coordinate sorgente.

    E' la difesa contro il solo guasto di questo sistema che non si annuncia:
    se ARPAE riconfigura il dominio, l'indice di ricampionamento in cache
    resta valido come forma ma sbagliato come contenuto, e produrrebbe frame
    plausibili con i valori nel posto sbagliato. Confrontando l'impronta a
    ogni run il job si ferma invece di corrompere l'archivio.
    """
    h = hashlib.sha256()
    h.update(np.ascontiguousarray(lon_rho, dtype=np.float64).tobytes())
    h.update(np.ascontiguousarray(lat_rho, dtype=np.float64).tobytes())
    return h.hexdigest()
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_grid.py -v`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add ingest/grid.py tests/test_grid.py
git commit -m "feat: griglia Web Mercator e impronta delle coordinate sorgente"
```

---

### Task 4: Indice di ricampionamento

**Files:**
- Create: `tests/conftest.py`
- Modify: `ingest/grid.py` (aggiunge `RegridIndex`, `build_regrid_index`, `apply_index`, `save_index`, `load_index`)
- Test: `tests/test_grid.py` (aggiunge test)

**Interfaces:**
- Consumes: `MercatorGrid`, `grid_centres`, `lonlat_to_mercator`, `coordinate_fingerprint`, `config.MAX_NEIGHBOUR_DISTANCE_M`
- Produces:
  - `RegridIndex` dataclass frozen con `indices: np.ndarray` (int32, lunghezza `height*width`, `-1` dove nodata), `sea_mask: np.ndarray` (bool, forma della griglia sorgente), `fingerprint: str`, `grid: MercatorGrid`
  - `build_regrid_index(lon_rho, lat_rho, sea_mask, grid, max_distance_m=config.MAX_NEIGHBOUR_DISTANCE_M) -> RegridIndex`
  - `apply_index(values_2d: np.ndarray, index: RegridIndex) -> np.ndarray` restituisce float64 di forma `(height, width)` con `NaN` sui nodata
  - `save_index(index: RegridIndex, path: Path) -> None`
  - `load_index(path: Path) -> RegridIndex`
- Fixture prodotte da `conftest.py`: `synthetic_coords()`, `synthetic_sea_mask()`, `write_wave_file(path)`, `write_profile_file(path)`

- [ ] **Step 0: Creare `tests/__init__.py` vuoto**

Serve perche' i test importano le fixture con `from tests.conftest import ...`. Senza il file, e senza il `pythonpath` gia' impostato nel Task 1, pytest importa `conftest` come modulo di primo livello e quell'import fallisce.

- [ ] **Step 1: Scrivere `tests/conftest.py`**

```python
"""NetCDF sintetici generati in codice.

Generati e non committati come binari: cosi' la fixture si legge, si
modifica e non nasconde nulla.

La geometria imita ADRIAC in piccolo: griglia curvilinea ruotata di 30 gradi,
con le ultime due righe di terra.
"""
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from netCDF4 import Dataset

ETA, XI = 6, 4
NT = 2
NS = 3

TIME_UNITS = "seconds since 1968-05-23 00:00:00"
_EPOCH = datetime(1968, 5, 23, tzinfo=timezone.utc)

# Il primo istante dei file di analisi e' l'01:00 del giorno precedente.
FIRST_TIME = datetime(2026, 8, 12, 1, tzinfo=timezone.utc)


def synthetic_coords():
    """Griglia curvilinea: ruotata di 30 gradi attorno all'origine locale."""
    j, i = np.meshgrid(np.arange(ETA), np.arange(XI), indexing="ij")
    passo = 0.01
    a = np.radians(30.0)
    x = i * passo
    y = j * passo
    lon = 12.0 + x * np.cos(a) - y * np.sin(a)
    lat = 44.0 + x * np.sin(a) + y * np.cos(a)
    return lon, lat


def synthetic_sea_mask():
    """True dove c'e' mare. Le ultime due righe sono terra."""
    m = np.ones((ETA, XI), dtype=bool)
    m[-2:, :] = False
    return m


def _times(n=NT):
    return np.array(
        [(FIRST_TIME + timedelta(hours=k) - _EPOCH).total_seconds() for k in range(n)],
        dtype=np.float64,
    )


def _masked(base: np.ndarray) -> np.ma.MaskedArray:
    mare = synthetic_sea_mask()
    # La copia e' necessaria: broadcast_to restituisce una vista in sola
    # lettura, e masked_array prova a impostarne la forma, cosa deprecata
    # da NumPy 2.5 in poi.
    mask = np.broadcast_to(~mare, base.shape).copy()
    return np.ma.masked_array(base, mask=mask)


def _write_coords(ds):
    lon, lat = synthetic_coords()
    ds.createDimension("eta_rho", ETA)
    ds.createDimension("xi_rho", XI)
    v = ds.createVariable("lon_rho", "f8", ("eta_rho", "xi_rho"))
    v[:] = lon
    v = ds.createVariable("lat_rho", "f8", ("eta_rho", "xi_rho"))
    v[:] = lat


def write_wave_file(path, n_times: int = NT):
    """File 2D con le tre variabili d'onda.

    Hwave vale (indice piatto della cella)/100 + ora, cosi' ogni cella ha un
    valore distinguibile e si puo' verificare che finisca nel posto giusto.
    """
    ds = Dataset(str(path), "w", format="NETCDF3_CLASSIC")
    try:
        ds.createDimension("ocean_time", n_times)
        _write_coords(ds)
        t = ds.createVariable("ocean_time", "f8", ("ocean_time",))
        t.units = TIME_UNITS
        t[:] = _times(n_times)

        base = np.arange(ETA * XI, dtype=np.float64).reshape(ETA, XI) / 100.0
        campo = np.stack([base + k for k in range(n_times)])

        hw = ds.createVariable(
            "Hwave", "f4", ("ocean_time", "eta_rho", "xi_rho"), fill_value=1.0e37
        )
        hw.units = "meter"
        hw[:] = _masked(campo)

        pw = ds.createVariable(
            "Pwave_top", "f4", ("ocean_time", "eta_rho", "xi_rho"), fill_value=1.0e37
        )
        pw.units = "second"
        pw[:] = _masked(campo * 2.0)

        dw = ds.createVariable(
            "Dwave", "f4", ("ocean_time", "eta_rho", "xi_rho"), fill_value=1.0e37
        )
        dw.units = "degrees"
        dw[:] = _masked(np.full_like(campo, 90.0))
    finally:
        ds.close()
    return path


def write_profile_file(path, var_names=("temp",), n_times: int = NT):
    """File 3D su punti rho, con 30 livelli sostituiti da NS per brevita'."""
    ds = Dataset(str(path), "w", format="NETCDF3_CLASSIC")
    try:
        ds.createDimension("ocean_time", n_times)
        ds.createDimension("s_rho", NS)
        _write_coords(ds)
        t = ds.createVariable("ocean_time", "f8", ("ocean_time",))
        t.units = TIME_UNITS
        t[:] = _times(n_times)

        s = ds.createVariable("s_rho", "f8", ("s_rho",))
        s[:] = np.linspace(-1.0, 0.0, NS)
        cs = ds.createVariable("Cs_r", "f8", ("s_rho",))
        cs[:] = np.linspace(-1.0, 0.0, NS)
        h = ds.createVariable("h", "f8", ("eta_rho", "xi_rho"))
        h[:] = np.full((ETA, XI), 20.0)

        mare = synthetic_sea_mask()
        for nome in var_names:
            v = ds.createVariable(
                "temp" if nome == "temp" else nome,
                "f4",
                ("ocean_time", "s_rho", "eta_rho", "xi_rho"),
                fill_value=1.0e37,
            )
            dati = np.zeros((n_times, NS, ETA, XI), dtype=np.float64)
            for k in range(n_times):
                for livello in range(NS):
                    dati[k, livello] = livello + k * 10.0
            mask = np.broadcast_to(~mare, dati.shape).copy()
            v[:] = np.ma.masked_array(dati, mask=mask)
    finally:
        ds.close()
    return path


@pytest.fixture
def wave_file(tmp_path):
    return write_wave_file(tmp_path / "wave.nc")


@pytest.fixture
def profile_file(tmp_path):
    return write_profile_file(tmp_path / "temp.nc")
```

- [ ] **Step 2: Aggiungere i test dell'indice in `tests/test_grid.py`**

Prima, aggiungere questi due import **in testa al file**, insieme a quelli che ci sono gia'. Non in coda: gli import a meta' file sono un errore di lint (`E402`) e si leggono male.

```python
from ingest.config import MAX_NEIGHBOUR_DISTANCE_M
from tests.conftest import ETA, XI, synthetic_coords, synthetic_sea_mask
```

Poi aggiungere le funzioni in coda al file:

```python
def _indice_di_prova(max_distance=MAX_NEIGHBOUR_DISTANCE_M):
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    return lon, lat, mare, g, grid.build_regrid_index(
        lon, lat, mare, g, max_distance_m=max_distance
    )


def test_l_indice_ha_una_voce_per_pixel():
    _, _, _, g, idx = _indice_di_prova()
    assert idx.indices.shape == (g.height * g.width,)
    assert idx.indices.dtype == np.int32


def test_il_valore_di_una_cella_di_mare_finisce_nel_frame():
    lon, lat, mare, g, idx = _indice_di_prova()
    valori = np.full((ETA, XI), np.nan)
    valori[mare] = 0.0
    valori[1, 1] = 42.0
    fuori = grid.apply_index(valori, idx)
    assert np.count_nonzero(fuori == 42.0) >= 1


def test_la_terraferma_lontana_dal_mare_resta_nodata():
    """Nessun valore di mare deve sbordare fino al centro della terra.

    Le ultime due righe sono terra e distano piu' di 800 m dall'ultima riga
    di mare, quindi i pixel che ci cadono sopra non devono trovare vicini.
    """
    lon, lat, mare, g, idx = _indice_di_prova()
    x_terra, y_terra = grid.lonlat_to_mercator(lon[-1, :], lat[-1, :])
    cx, cy = grid.grid_centres(g)
    for xt, yt in zip(x_terra, y_terra):
        vicino = np.argmin((cx - xt) ** 2 + (cy - yt) ** 2)
        assert idx.indices[vicino] == -1


def test_i_valori_mascherati_non_attraversano_la_costa():
    """L'albero e' costruito solo sulle celle di mare, quindi un valore di
    terra non puo' comparire nel frame nemmeno per errore."""
    lon, lat, mare, g, idx = _indice_di_prova()
    valori = np.full((ETA, XI), 7.0)
    valori[~mare] = 999.0
    fuori = grid.apply_index(valori, idx)
    assert not np.any(fuori == 999.0)


def test_l_indice_si_salva_e_si_rilegge(tmp_path):
    _, _, _, _, idx = _indice_di_prova()
    percorso = tmp_path / "idx.npz"
    grid.save_index(idx, percorso)
    riletto = grid.load_index(percorso)
    assert np.array_equal(riletto.indices, idx.indices)
    assert np.array_equal(riletto.sea_mask, idx.sea_mask)
    assert riletto.fingerprint == idx.fingerprint
    assert riletto.grid == idx.grid
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_grid.py -v`
Expected: FAIL con `AttributeError: module 'ingest.grid' has no attribute 'build_regrid_index'`

- [ ] **Step 4: Aggiungere l'indice a `ingest/grid.py`**

Aggiungere gli import in testa (`from pathlib import Path`, `from scipy.spatial import cKDTree`, `from .config import MAX_NEIGHBOUR_DISTANCE_M`) e in coda al file:

```python
@dataclass(frozen=True)
class RegridIndex:
    """Corrispondenza pixel di destinazione verso cella di mare sorgente.

    `indices` contiene, per ogni pixel, la posizione nel vettore delle celle
    di mare (cioe' in `values_2d[sea_mask]`), oppure -1 se nessuna cella di
    mare e' abbastanza vicina.
    """

    indices: np.ndarray
    sea_mask: np.ndarray
    fingerprint: str
    grid: MercatorGrid


def build_regrid_index(
    lon_rho,
    lat_rho,
    sea_mask,
    g: MercatorGrid,
    max_distance_m: float = MAX_NEIGHBOUR_DISTANCE_M,
) -> RegridIndex:
    """Costruisce l'indice interrogando un KDTree sulle sole celle di mare.

    Costruire l'albero solo sul mare e' la ragione per cui nessun valore puo'
    attraversare la costa: una interpolazione bilineare mediarebbe celle di
    mare con celle di terra mascherate, e le onde risulterebbero
    artificialmente smorzate proprio lungo la costa.

    La distanza si valuta al suolo e non in metri Mercator, che alle nostre
    latitudini sono gonfiati di circa il 37 per cento.
    """
    lon_rho = np.asarray(lon_rho, dtype=np.float64)
    lat_rho = np.asarray(lat_rho, dtype=np.float64)
    sea_mask = np.asarray(sea_mask, dtype=bool)

    sx, sy = lonlat_to_mercator(lon_rho[sea_mask], lat_rho[sea_mask])
    tree = cKDTree(np.column_stack([sx, sy]))

    cx, cy = grid_centres(g)
    _, lat_dest = mercator_to_lonlat(cx, cy)
    fattore = np.cos(np.radians(lat_dest))

    # Limite generoso in metri Mercator: si stringe dopo, al suolo.
    limite_mercator = max_distance_m / float(fattore.min())
    distanza, posizione = tree.query(
        np.column_stack([cx, cy]), distance_upper_bound=limite_mercator
    )

    trovato = np.isfinite(distanza)
    al_suolo = np.where(trovato, distanza * fattore, np.inf)
    valido = trovato & (al_suolo <= max_distance_m)

    indices = np.full(cx.shape, -1, dtype=np.int32)
    indices[valido] = posizione[valido].astype(np.int32)

    return RegridIndex(
        indices=indices,
        sea_mask=sea_mask,
        fingerprint=coordinate_fingerprint(lon_rho, lat_rho),
        grid=g,
    )


def apply_index(values_2d, index: RegridIndex) -> np.ndarray:
    """Ricampiona un campo sorgente sul raster di destinazione.

    Restituisce float64 con NaN sui nodata, cosi' che quantize() li converta
    in NODATA senza casi speciali. I valori gia' mascherati in origine
    diventano NaN e si propagano correttamente, il che rende innocuo il caso
    in cui la maschera di un singolo file differisca da quella di riferimento.
    """
    if np.ma.isMaskedArray(values_2d):
        piatto = np.ma.filled(values_2d.astype(np.float64), np.nan)[index.sea_mask]
    else:
        piatto = np.asarray(values_2d, dtype=np.float64)[index.sea_mask]

    fuori = np.full(index.indices.shape, np.nan, dtype=np.float64)
    trovato = index.indices >= 0
    fuori[trovato] = piatto[index.indices[trovato]]
    return fuori.reshape(index.grid.height, index.grid.width)


def save_index(index: RegridIndex, path: Path) -> None:
    np.savez_compressed(
        path,
        indices=index.indices,
        sea_mask=index.sea_mask,
        fingerprint=np.array(index.fingerprint),
        grid=np.array(
            [
                index.grid.x_min,
                index.grid.x_max,
                index.grid.y_min,
                index.grid.y_max,
                index.grid.width,
                index.grid.height,
                index.grid.resolution,
            ],
            dtype=np.float64,
        ),
    )


def load_index(path: Path) -> RegridIndex:
    with np.load(path, allow_pickle=False) as z:
        g = z["grid"]
        return RegridIndex(
            indices=z["indices"],
            sea_mask=z["sea_mask"],
            fingerprint=str(z["fingerprint"]),
            grid=MercatorGrid(
                x_min=float(g[0]),
                x_max=float(g[1]),
                y_min=float(g[2]),
                y_max=float(g[3]),
                width=int(g[4]),
                height=int(g[5]),
                resolution=float(g[6]),
            ),
        )
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_grid.py -v`
Expected: PASS, 11 test

- [ ] **Step 6: Commit**

```bash
git add ingest/grid.py tests/conftest.py tests/test_grid.py
git commit -m "feat: indice di ricampionamento sulle sole celle di mare"
```

---

### Task 5: Client dell'object storage

**Files:**
- Create: `ingest/storage.py`
- Test: `tests/test_storage.py`

**Interfaces:**
- Consumes: niente del progetto
- Produces:
  - `ObjectStore(bucket: str, endpoint_url: str, access_key: str, secret_key: str, region: str = "auto")`
  - `ObjectStore.from_env() -> ObjectStore` legge `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  - `.put_frame(key: str, blob: bytes) -> None` imposta `Content-Encoding: gzip` e cache immutabile
  - `.put_json(key: str, obj: dict) -> None` cache breve
  - `.get_json(key: str) -> dict | None` restituisce `None` se assente
  - `.exists(key: str) -> bool`
  - `.list_keys(prefix: str) -> list[str]`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_storage.py`:

```python
"""Il client dell'object storage, contro un S3 finto in memoria."""
import boto3
import pytest
from moto import mock_aws

from ingest.storage import CACHE_IMMUTABILE, ObjectStore

BUCKET = "prova"


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(
            bucket=BUCKET,
            endpoint_url=None,
            access_key="chiave",
            secret_key="segreto",
            region="us-east-1",
        )


def test_un_frame_viene_marcato_gzip_e_immutabile(store):
    store.put_frame("frames/hwave/an/20260813/2026-08-12T01.bin", b"\x01\x02")
    testa = store.client.head_object(
        Bucket=BUCKET, Key="frames/hwave/an/20260813/2026-08-12T01.bin"
    )
    assert testa["ContentEncoding"] == "gzip"
    assert testa["CacheControl"] == CACHE_IMMUTABILE


def test_giro_completo_del_json(store):
    store.put_json("catalog.json", {"schema_version": 1})
    assert store.get_json("catalog.json") == {"schema_version": 1}


def test_un_json_assente_restituisce_none(store):
    assert store.get_json("non/esiste.json") is None


def test_il_json_non_e_immutabile(store):
    """Catalogo e indici cambiano a ogni run: marcarli immutabili li
    congelerebbe nella cache della CDN."""
    store.put_json("catalog.json", {})
    testa = store.client.head_object(Bucket=BUCKET, Key="catalog.json")
    assert testa["CacheControl"] != CACHE_IMMUTABILE


def test_exists(store):
    assert not store.exists("frames/x.bin")
    store.put_frame("frames/x.bin", b"\x00")
    assert store.exists("frames/x.bin")


def test_list_keys(store):
    store.put_frame("frames/a/1.bin", b"\x00")
    store.put_frame("frames/a/2.bin", b"\x00")
    store.put_frame("frames/b/1.bin", b"\x00")
    assert sorted(store.list_keys("frames/a/")) == ["frames/a/1.bin", "frames/a/2.bin"]
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_storage.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.storage'`

- [ ] **Step 3: Scrivere `ingest/storage.py`**

```python
"""Client dell'object storage.

Uno dei due soli moduli che parlano col mondo esterno, e uno dei due che
i test stubbano.
"""

import json
import os

import boto3
from botocore.exceptions import ClientError

# I frame non cambiano mai: una volta scritta, l'analisi delle 14:00 del
# 12 agosto restera' quella per sempre.
CACHE_IMMUTABILE = "public, max-age=31536000, immutable"
# Catalogo e indici cambiano a ogni run.
CACHE_BREVE = "public, max-age=300"


class ObjectStore:
    def __init__(
        self,
        bucket: str,
        endpoint_url: str | None,
        access_key: str,
        secret_key: str,
        region: str = "auto",
    ):
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )

    @classmethod
    def from_env(cls) -> "ObjectStore":
        mancanti = [
            n
            for n in ("R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
            if not os.environ.get(n)
        ]
        if mancanti:
            raise RuntimeError(
                "variabili d'ambiente mancanti: " + ", ".join(mancanti)
            )
        return cls(
            bucket=os.environ["R2_BUCKET"],
            endpoint_url=os.environ["R2_ENDPOINT"],
            access_key=os.environ["R2_ACCESS_KEY_ID"],
            secret_key=os.environ["R2_SECRET_ACCESS_KEY"],
        )

    def put_frame(self, key: str, blob: bytes) -> None:
        """Carica un frame gia' compresso.

        Content-Encoding: gzip fa decomprimere il browser in modo
        trasparente, cosi' il client non ha bisogno di alcuna libreria di
        decompressione: fetch().arrayBuffer() restituisce gia' i byte in
        chiaro.
        """
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=blob,
            ContentType="application/octet-stream",
            ContentEncoding="gzip",
            CacheControl=CACHE_IMMUTABILE,
        )

    def put_json(self, key: str, obj: dict) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
            CacheControl=CACHE_BREVE,
        )

    def put_binary(self, key: str, data: bytes) -> None:
        """Oggetto binario mutabile, cioe' l'indice di ricampionamento.

        Niente Content-Encoding e niente cache immutabile: questo file cambia
        quando cambia la griglia sorgente, e congelarlo nella CDN vanificherebbe
        proprio la guardia che deve alimentare.
        """
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType="application/octet-stream",
            CacheControl=CACHE_BREVE,
        )

    def get_binary(self, key: str) -> bytes | None:
        try:
            risposta = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as errore:
            if errore.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise
        return risposta["Body"].read()

    def get_json(self, key: str) -> dict | None:
        try:
            risposta = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as errore:
            if errore.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise
        return json.loads(risposta["Body"].read().decode("utf-8"))

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as errore:
            if errore.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return False
            raise
        return True

    def list_keys(self, prefix: str) -> list[str]:
        chiavi: list[str] = []
        paginatore = self.client.get_paginator("list_objects_v2")
        for pagina in paginatore.paginate(Bucket=self.bucket, Prefix=prefix):
            chiavi.extend(o["Key"] for o in pagina.get("Contents", []))
        return chiavi
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_storage.py -v`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add ingest/storage.py tests/test_storage.py
git commit -m "feat: client dell'object storage con cache differenziata"
```

---

### Task 6: Elenco e scaricamento dei file sorgente

**Files:**
- Create: `ingest/source.py`
- Test: `tests/test_source.py`

**Interfaces:**
- Consumes: `config.ADRIAC_BASE`
- Produces:
  - `SourceFile` dataclass frozen con `name, url, date (str YYYYMMDD), output, group_short, kind`, e proprieta' `group` che restituisce `f"{output}_{group_short}"`
  - `parse_filename(name: str, base_url: str = config.ADRIAC_BASE) -> SourceFile | None`
  - `list_source_files(base_url: str = config.ADRIAC_BASE, session=None) -> list[SourceFile]`
  - `head(url: str, session=None) -> dict` con chiavi `bytes` e `last_modified`
  - `download(url: str, dest: Path, session=None) -> str` restituisce lo sha256 esadecimale

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_source.py`:

```python
"""Elenco e scaricamento dei file ARPAE."""
import hashlib

import pytest
import responses

from ingest import source

INDICE_HTML = """<html><body><h1>Index of /opendata/adriac</h1><pre>
<a href="/opendata/">Parent Directory</a>
<a href="20260813_adriac_1km_his_HPDwave_an.nc.gz">20260813_..&gt;</a> 2026-08-13 10:34 23M
<a href="20260813_adriac_1km_his_HPDwave_fc.nc.gz">20260813_..&gt;</a> 2026-08-13 10:35 63M
<a href="20260813_adriac_1km_qck_sl_an.nc.gz">20260813_..&gt;</a> 2026-08-13 10:38 126M
<a href="20260812_adriac_1km_avg_temp_an.nc.gz">20260812_..&gt;</a> 2026-08-12 10:31 15M
</pre></body></html>"""


def test_parse_di_un_nome_con_gruppo_composto():
    f = source.parse_filename("20260813_adriac_1km_his_HPDwave_an.nc.gz")
    assert f.date == "20260813"
    assert f.output == "his"
    assert f.group_short == "HPDwave"
    assert f.group == "his_HPDwave"
    assert f.kind == "an"


def test_parse_di_un_nome_con_gruppo_semplice():
    f = source.parse_filename("20260813_adriac_1km_qck_sl_fc.nc.gz")
    assert f.group == "qck_sl"
    assert f.kind == "fc"


def test_parse_di_un_nome_con_medie_giornaliere():
    f = source.parse_filename("20260812_adriac_1km_avg_2dcur_an.nc.gz")
    assert f.output == "avg"
    assert f.group == "avg_2dcur"


def test_un_nome_estraneo_non_esplode():
    assert source.parse_filename("readme.txt") is None


@responses.activate
def test_elenco_dei_file_dalla_pagina_indice():
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    file = source.list_source_files("https://esempio/adriac/")
    assert len(file) == 4
    nomi = {f.name for f in file}
    assert "20260813_adriac_1km_his_HPDwave_an.nc.gz" in nomi
    assert all(f.url.startswith("https://esempio/adriac/") for f in file)


@responses.activate
def test_head_restituisce_dimensione_e_data():
    responses.add(
        responses.HEAD,
        "https://esempio/f.nc.gz",
        headers={"Content-Length": "1234", "Last-Modified": "Thu, 13 Aug 2026 10:34:00 GMT"},
    )
    t = source.head("https://esempio/f.nc.gz")
    assert t["bytes"] == 1234
    assert t["last_modified"] == "Thu, 13 Aug 2026 10:34:00 GMT"


@responses.activate
def test_il_download_calcola_lo_sha256(tmp_path):
    contenuto = b"contenuto di prova"
    responses.add(responses.GET, "https://esempio/f.nc.gz", body=contenuto)
    destinazione = tmp_path / "f.nc.gz"
    impronta = source.download("https://esempio/f.nc.gz", destinazione)
    assert impronta == hashlib.sha256(contenuto).hexdigest()
    assert destinazione.read_bytes() == contenuto


@responses.activate
def test_il_download_riprova_dopo_un_errore_temporaneo(tmp_path, monkeypatch):
    """Tre tentativi con attesa crescente: un 503 passeggero su 2 GB di
    download non deve buttare via il lavoro."""
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    responses.add(responses.GET, "https://esempio/f.nc.gz", status=503)
    responses.add(responses.GET, "https://esempio/f.nc.gz", body=b"buono")
    impronta = source.download("https://esempio/f.nc.gz", tmp_path / "f.nc.gz")
    assert impronta == hashlib.sha256(b"buono").hexdigest()


@responses.activate
def test_il_download_si_arrende_dopo_tre_tentativi(tmp_path, monkeypatch):
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    for _ in range(source.TENTATIVI):
        responses.add(responses.GET, "https://esempio/f.nc.gz", status=503)
    with pytest.raises(Exception):
        source.download("https://esempio/f.nc.gz", tmp_path / "f.nc.gz")
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_source.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.source'`

- [ ] **Step 3: Scrivere `ingest/source.py`**

```python
"""Accesso alla sorgente ARPAE.

E' un indice Apache senza API: si legge la pagina, si estraggono i nomi che
corrispondono al formato noto, e si interroga ciascuno con HEAD. I file sono
poche decine, quindi una HEAD ciascuno costa meno che interpretare le colonne
formattate dell'indice, che cambiano formato senza preavviso.
"""

import hashlib
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import requests

from .config import ADRIAC_BASE

log = logging.getLogger(__name__)

# Tre tentativi con attesa crescente. Un errore passeggero a meta' di un
# download da 2 GB non deve costare l'intero run: la riconciliazione lo
# recupererebbe comunque il giorno dopo, ma senza motivo.
TENTATIVI = 3
ATTESA_BASE_S = 5.0

_NOME = re.compile(
    r"^(?P<date>\d{8})_adriac_1km_(?P<output>avg|his|qck)_(?P<group>[A-Za-z0-9]+)_(?P<kind>an|fc)\.nc\.gz$"
)
_HREF = re.compile(r'href="([^"]+\.nc\.gz)"')

_CHUNK = 1 << 20


@dataclass(frozen=True)
class SourceFile:
    name: str
    url: str
    date: str
    output: str
    group_short: str
    kind: str

    @property
    def group(self) -> str:
        return f"{self.output}_{self.group_short}"


def parse_filename(name: str, base_url: str = ADRIAC_BASE) -> SourceFile | None:
    trovato = _NOME.match(name)
    if trovato is None:
        return None
    return SourceFile(
        name=name,
        url=urljoin(base_url, name),
        date=trovato["date"],
        output=trovato["output"],
        group_short=trovato["group"],
        kind=trovato["kind"],
    )


def list_source_files(base_url: str = ADRIAC_BASE, session=None) -> list[SourceFile]:
    ses = session or requests
    risposta = ses.get(base_url, timeout=60)
    risposta.raise_for_status()
    file: list[SourceFile] = []
    for href in _HREF.findall(risposta.text):
        nome = href.rsplit("/", 1)[-1]
        analizzato = parse_filename(nome, base_url)
        if analizzato is not None:
            file.append(analizzato)
    return file


def _con_tentativi(operazione, descrizione: str):
    """Riprova con attesa crescente, poi rilancia l'ultima eccezione."""
    ultimo: Exception | None = None
    for tentativo in range(TENTATIVI):
        try:
            return operazione()
        except Exception as errore:
            ultimo = errore
            if tentativo < TENTATIVI - 1:
                attesa = ATTESA_BASE_S * (2**tentativo)
                log.warning(
                    "%s fallito (%s), riprovo fra %.0f s", descrizione, errore, attesa
                )
                time.sleep(attesa)
    raise ultimo


def head(url: str, session=None) -> dict:
    ses = session or requests

    def _leggi():
        risposta = ses.head(url, timeout=60, allow_redirects=True)
        risposta.raise_for_status()
        return {
            "bytes": int(risposta.headers.get("Content-Length", 0)),
            "last_modified": risposta.headers.get("Last-Modified", ""),
        }

    return _con_tentativi(_leggi, f"HEAD {url}")


def download(url: str, dest: Path, session=None) -> str:
    """Scarica in streaming e restituisce lo sha256.

    I file arrivano a quasi 2 GB: non si tengono in memoria. Il file
    parziale viene rimosso prima di ogni nuovo tentativo, altrimenti
    l'impronta risulterebbe calcolata su byte incompleti.
    """
    ses = session or requests
    dest.parent.mkdir(parents=True, exist_ok=True)

    def _scarica():
        dest.unlink(missing_ok=True)
        impronta = hashlib.sha256()
        with ses.get(url, stream=True, timeout=300) as risposta:
            risposta.raise_for_status()
            with open(dest, "wb") as uscita:
                for pezzo in risposta.iter_content(chunk_size=_CHUNK):
                    if pezzo:
                        impronta.update(pezzo)
                        uscita.write(pezzo)
        return impronta.hexdigest()

    return _con_tentativi(_scarica, f"GET {url}")
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_source.py -v`
Expected: PASS, 9 test

- [ ] **Step 5: Commit**

```bash
git add ingest/source.py tests/test_source.py
git commit -m "feat: elenco e scaricamento verificato con tentativi ripetuti"
```

---

### Task 7: Manifest e deduplica

**Files:**
- Create: `ingest/manifest.py`
- Test: `tests/test_manifest.py`

**Interfaces:**
- Consumes: `config.SCHEMA_VERSION`, `config.INGEST_VERSION`
- Produces:
  - `FrameRecord` dataclass con `var, valid_time (datetime aware), path, sha256, scale, offset, min, max, nodata_count, clipped_count`
  - `RunManifest` dataclass con `source_url, source_sha256, source_bytes, source_last_modified, reference_time (datetime aware), kind, group, grid_ref, frames: list[FrameRecord], ingested_at (datetime aware)`
  - `manifest_key(date: str, kind: str, group: str) -> str` restituisce `runs/{YYYY-MM-DD}/{kind}/{group}.json`
  - `RunManifest.to_dict() -> dict` e `RunManifest.from_dict(d) -> RunManifest`
  - `already_ingested(existing: dict | None, source_sha256: str) -> bool`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_manifest.py`:

```python
"""Il manifest e' il contratto d'archivio: deve reggere il giro completo."""
import json
from datetime import datetime, timezone

from ingest import manifest
from ingest.config import SCHEMA_VERSION


def _manifest_di_prova():
    return manifest.RunManifest(
        source_url="https://esempio/20260813_adriac_1km_his_HPDwave_an.nc.gz",
        source_sha256="abc123",
        source_bytes=24117248,
        source_last_modified="Thu, 13 Aug 2026 10:34:00 GMT",
        reference_time=datetime(2026, 8, 13, tzinfo=timezone.utc),
        kind="an",
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=datetime(2026, 8, 13, 11, 20, tzinfo=timezone.utc),
        frames=[
            manifest.FrameRecord(
                var="hwave",
                valid_time=datetime(2026, 8, 12, 1, tzinfo=timezone.utc),
                path="frames/hwave/an/20260813/2026-08-12T01.bin",
                sha256="def456",
                scale=0.001,
                offset=0.0,
                min=0.02,
                max=1.87,
                nodata_count=729412,
                clipped_count=0,
            )
        ],
    )


def test_la_chiave_e_per_gruppo_non_per_run():
    """Un giorno contiene piu' file sorgente per tipo: con un manifest unico
    il progresso parziale non si registrerebbe."""
    assert (
        manifest.manifest_key("20260813", "an", "his_HPDwave")
        == "runs/2026-08-13/an/his_HPDwave.json"
    )


def test_giro_completo_di_serializzazione():
    originale = _manifest_di_prova()
    tornato = manifest.RunManifest.from_dict(originale.to_dict())
    assert tornato == originale


def test_il_dizionario_e_json_serializzabile_e_versionato():
    d = _manifest_di_prova().to_dict()
    json.dumps(d)
    assert d["schema_version"] == SCHEMA_VERSION
    assert d["ingest_version"]


def test_gli_istanti_sono_in_utc_con_la_z():
    d = _manifest_di_prova().to_dict()
    assert d["reference_time"] == "2026-08-13T00:00:00Z"
    assert d["frames"][0]["valid_time"] == "2026-08-12T01:00:00Z"


def test_la_deduplica_riconosce_lo_stesso_file():
    esistente = _manifest_di_prova().to_dict()
    assert manifest.already_ingested(esistente, "abc123")
    assert not manifest.already_ingested(esistente, "impronta-diversa")


def test_senza_manifest_precedente_si_lavora():
    assert not manifest.already_ingested(None, "abc123")


def test_un_manifest_di_schema_futuro_non_conta_come_gia_ingerito():
    """Se lo schema e' cambiato il file va rilavorato, non saltato."""
    esistente = _manifest_di_prova().to_dict()
    esistente["schema_version"] = SCHEMA_VERSION + 1
    assert not manifest.already_ingested(esistente, "abc123")
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_manifest.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.manifest'`

- [ ] **Step 3: Scrivere `ingest/manifest.py`**

```python
"""Manifest di run.

E' la ragione per cui l'archivio varra' ancora qualcosa fra anni: registra
provenienza (da quale file, con che impronta), auto-descrizione (unita' e
fattori di scala nel dato, non nel codice) e riproducibilita' (versione di
schema e di codice).

La deduplica cade fuori gratis: se l'impronta del file sorgente coincide con
quella registrata, non c'e' niente da rifare.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from .config import INGEST_VERSION, SCHEMA_VERSION

_FORMATO = "%Y-%m-%dT%H:%M:%SZ"


def _dump_time(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime(_FORMATO)


def _load_time(s: str) -> datetime:
    return datetime.strptime(s, _FORMATO).replace(tzinfo=timezone.utc)


@dataclass
class FrameRecord:
    var: str
    valid_time: datetime
    path: str
    sha256: str
    scale: float
    offset: float
    min: float | None
    max: float | None
    nodata_count: int
    clipped_count: int

    def to_dict(self) -> dict:
        d = asdict(self)
        d["valid_time"] = _dump_time(self.valid_time)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "FrameRecord":
        d = dict(d)
        d["valid_time"] = _load_time(d["valid_time"])
        return cls(**d)


@dataclass
class RunManifest:
    source_url: str
    source_sha256: str
    source_bytes: int
    source_last_modified: str
    reference_time: datetime
    kind: str
    group: str
    grid_ref: str
    ingested_at: datetime
    frames: list[FrameRecord] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "ingest_version": INGEST_VERSION,
            "ingested_at": _dump_time(self.ingested_at),
            "source": {
                "url": self.source_url,
                "sha256": self.source_sha256,
                "bytes": self.source_bytes,
                "last_modified": self.source_last_modified,
            },
            "reference_time": _dump_time(self.reference_time),
            "kind": self.kind,
            "group": self.group,
            "grid": self.grid_ref,
            "frames": [f.to_dict() for f in self.frames],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "RunManifest":
        return cls(
            source_url=d["source"]["url"],
            source_sha256=d["source"]["sha256"],
            source_bytes=d["source"]["bytes"],
            source_last_modified=d["source"]["last_modified"],
            reference_time=_load_time(d["reference_time"]),
            kind=d["kind"],
            group=d["group"],
            grid_ref=d["grid"],
            ingested_at=_load_time(d["ingested_at"]),
            frames=[FrameRecord.from_dict(f) for f in d["frames"]],
        )


def manifest_key(date: str, kind: str, group: str) -> str:
    """runs/{YYYY-MM-DD}/{kind}/{gruppo}.json

    Un manifest per gruppo di file e non per run: in un giorno si lavorano
    piu' file sorgente per tipo, e se uno riesce e un altro fallisce il
    progresso parziale deve restare registrato.
    """
    iso = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    return f"runs/{iso}/{kind}/{group}.json"


def already_ingested(existing: dict | None, source_sha256: str) -> bool:
    if not existing:
        return False
    if existing.get("schema_version") != SCHEMA_VERSION:
        return False
    return existing.get("source", {}).get("sha256") == source_sha256
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_manifest.py -v`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add ingest/manifest.py tests/test_manifest.py
git commit -m "feat: manifest di run e deduplica per impronta del sorgente"
```

---

### Task 8: Estrazione dei frame 2D

**Files:**
- Create: `ingest/frames.py`
- Test: `tests/test_frames.py`

**Interfaces:**
- Consumes: `config.fields_for`, `config.sampling_for`, `encode.*`, `grid.apply_index`, `grid.RegridIndex`, `manifest.FrameRecord`
- Produces:
  - `read_times(ds) -> list[datetime]` istanti UTC aware da `ocean_time`
  - `select_times(times: list[datetime], sampling: str) -> list[int]` indici selezionati
  - `frame_key(var: str, kind: str, reference_date: str, valid_time: datetime) -> str`
  - `extract_frames(ds, group: str, kind: str, reference_date: str, index: grid.RegridIndex) -> Iterator[tuple[FrameRecord, bytes]]`
  - `read_grid_coords(ds) -> tuple[np.ndarray, np.ndarray]`
  - `read_sea_mask(ds, nc_name: str) -> np.ndarray`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_frames.py`:

```python
"""Estrazione dei frame 2D da un NetCDF."""
from datetime import datetime, timezone

import numpy as np
from netCDF4 import Dataset

from ingest import encode, frames, grid
from tests.conftest import synthetic_coords, synthetic_sea_mask


def _indice():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    return grid.build_regrid_index(lon, lat, mare, g)


def test_gli_istanti_sono_utc_aware(wave_file):
    with Dataset(str(wave_file)) as ds:
        istanti = frames.read_times(ds)
    assert istanti[0] == datetime(2026, 8, 12, 1, tzinfo=timezone.utc)
    assert all(t.tzinfo is not None for t in istanti)


def test_il_campionamento_orario_tiene_solo_il_minuto_zero():
    istanti = [
        datetime(2026, 8, 12, 1, m, tzinfo=timezone.utc) for m in (0, 10, 20, 30, 40, 50)
    ] + [datetime(2026, 8, 12, 2, 0, tzinfo=timezone.utc)]
    assert frames.select_times(istanti, "hourly") == [0, 6]
    assert frames.select_times(istanti, "full") == list(range(7))


def test_la_chiave_del_frame():
    assert (
        frames.frame_key(
            "hwave", "an", "20260813", datetime(2026, 8, 12, 1, tzinfo=timezone.utc)
        )
        == "frames/hwave/an/20260813/2026-08-12T01.bin"
    )


def test_estrae_un_frame_per_campo_e_per_istante(wave_file):
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        prodotti = list(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))
    # 4 campi (hwave, pwave, dwave_sin, dwave_cos) per 2 istanti
    assert len(prodotti) == 8
    variabili = {record.var for record, _ in prodotti}
    assert variabili == {"hwave", "pwave", "dwave_sin", "dwave_cos"}


def test_il_frame_prodotto_si_rilegge_e_ha_la_forma_della_griglia(wave_file):
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        record, blob = next(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))
    valori = encode.decompress(blob)
    assert valori.size == idx.grid.height * idx.grid.width


def test_le_statistiche_finiscono_nel_record(wave_file):
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        per_variabile = {
            r.var: r for r, _ in frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx)
        }
    hwave = per_variabile["hwave"]
    assert hwave.scale == 0.001
    assert hwave.min is not None and hwave.max is not None
    assert hwave.nodata_count > 0  # la terraferma
    assert hwave.clipped_count == 0


def test_la_direzione_produce_seno_e_coseno_coerenti(wave_file):
    """Dwave vale 90 gradi ovunque nel file sintetico: seno 1, coseno 0."""
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        blob_per_variabile = {
            r.var: b for r, b in frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx)
        }
    seno = encode.dequantize(encode.decompress(blob_per_variabile["dwave_sin"]), 0.0001)
    coseno = encode.dequantize(encode.decompress(blob_per_variabile["dwave_cos"]), 0.0001)
    validi = ~np.isnan(seno)
    assert np.allclose(seno[validi], 1.0, atol=0.001)
    assert np.allclose(coseno[validi], 0.0, atol=0.001)


def test_la_maschera_di_mare_si_legge_dai_dati(wave_file):
    with Dataset(str(wave_file)) as ds:
        mare = frames.read_sea_mask(ds, "Hwave")
    assert np.array_equal(mare, synthetic_sea_mask())
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_frames.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.frames'`

- [ ] **Step 3: Scrivere `ingest/frames.py`**

```python
"""Dai campi 2D di un NetCDF ai frame pubblicabili."""

import hashlib
from collections.abc import Iterator
from datetime import datetime, timezone

import numpy as np
from netCDF4 import num2date

from . import encode, grid
from .config import fields_for, sampling_for
from .manifest import FrameRecord


def read_times(ds) -> list[datetime]:
    """Istanti validi dal file.

    Si legge sempre ocean_time e mai il nome del file: il file di analisi
    datato D contiene i dati di D-1, e fidarsi del nome sposterebbe tutto
    l'archivio di 24 ore.
    """
    variabile = ds.variables["ocean_time"]
    grezzi = num2date(
        variabile[:],
        variabile.units,
        only_use_cftime_datetimes=False,
        only_use_python_datetimes=True,
    )
    return [t.replace(tzinfo=timezone.utc) for t in np.atleast_1d(grezzi)]


def select_times(times: list[datetime], sampling: str) -> list[int]:
    """Indici degli istanti da pubblicare.

    Il livello del mare in previsione e' a 10 minuti: si tengono solo gli
    istanti al minuto 00, senza mediare gli altri (una media cambierebbe la
    natura fisica del dato rispetto agli altri layer, che sono istantanei).
    """
    if sampling == "full":
        return list(range(len(times)))
    if sampling == "hourly":
        return [i for i, t in enumerate(times) if t.minute == 0 and t.second == 0]
    raise ValueError(f"campionamento non riconosciuto: {sampling}")


def read_grid_coords(ds):
    return np.asarray(ds.variables["lon_rho"][:]), np.asarray(ds.variables["lat_rho"][:])


def read_sea_mask(ds, nc_name: str) -> np.ndarray:
    """Maschera di mare dedotta dal primo istante di una variabile.

    ADRIAC non pubblica una maschera esplicita: le celle di terra arrivano
    mascherate dal _FillValue.
    """
    fetta = ds.variables[nc_name][0]
    if fetta.ndim == 3:  # variabile 3D: si prende il livello di superficie
        fetta = fetta[-1]
    return ~np.ma.getmaskarray(fetta)


def frame_key(var: str, kind: str, reference_date: str, valid_time: datetime) -> str:
    stampa = valid_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
    return f"frames/{var}/{kind}/{reference_date}/{stampa}.bin"


def extract_frames(
    ds, group: str, kind: str, reference_date: str, index: grid.RegridIndex
) -> Iterator[tuple[FrameRecord, bytes]]:
    """Produce un frame per ogni campo del gruppo e ogni istante selezionato.

    Legge una fetta temporale alla volta: i file di previsione 3D arrivano a
    quasi 2 GB, e caricare l'intera variabile farebbe esplodere la memoria.
    """
    istanti = read_times(ds)
    scelti = select_times(istanti, sampling_for(group, kind))
    campi = fields_for(group)

    for indice_t in scelti:
        valido = istanti[indice_t]
        for campo in campi:
            grezzo = ds.variables[campo.nc_name][indice_t]
            trasformato = encode.apply_transform(grezzo, campo.transform)
            ricampionato = grid.apply_index(trasformato, index)
            quantizzato, stats = encode.quantize(ricampionato, campo.scale, campo.offset)
            blob = encode.compress(quantizzato)
            record = FrameRecord(
                var=campo.id,
                valid_time=valido,
                path=frame_key(campo.id, kind, reference_date, valido),
                sha256=hashlib.sha256(blob).hexdigest(),
                scale=campo.scale,
                offset=campo.offset,
                min=stats["min"],
                max=stats["max"],
                nodata_count=stats["nodata_count"],
                clipped_count=stats["clipped_count"],
            )
            yield record, blob
```

Nota per chi implementa: `grid.apply_index` si aspetta un array bidimensionale sulla griglia sorgente. `encode.apply_transform` conserva la forma, quindi non serve alcun rimodellamento.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_frames.py -v`
Expected: PASS, 8 test

- [ ] **Step 5: Commit**

```bash
git add ingest/frames.py tests/test_frames.py
git commit -m "feat: estrazione dei frame 2D con campionamento per gruppo"
```

---

### Task 9: Anagrafica delle stazioni marine

**Files:**
- Create: `ingest/stations.py`
- Test: `tests/test_stations.py`

**Interfaces:**
- Consumes: `config.OBSERVED_NETWORKS`, `config.OBSERVED_REALTIME`
- Produces:
  - `Station` dataclass frozen con `id, name, network, lon, lat, variables: tuple[str, ...]`
  - `slugify(network: str, name: str) -> str`
  - `parse_realtime(lines: Iterable[str]) -> list[Station]`
  - `fetch_stations(url: str = config.OBSERVED_REALTIME, session=None) -> list[Station]`
  - `stations_to_dict(stations: list[Station]) -> dict`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_stations.py`:

```python
"""Anagrafica delle stazioni marine dal flusso BUFR in tempo reale."""
import json

from ingest import stations

RIGA_BOA = json.dumps(
    {
        "version": "0.1",
        "network": "boa",
        "ident": None,
        "lon": 1247590,
        "lat": 4421460,
        "date": "2026-08-13T04:00:00Z",
        "data": [
            {"vars": {"B01019": {"v": "Nausicaa 2"}, "B01194": {"v": "boa"}}},
            {"timerange": [0, 0, 900], "level": [1, None, None, None],
             "vars": {"B22070": {"v": 0.34}, "B22001": {"v": 90.0}}},
        ],
    }
)

RIGA_TERRA = json.dumps(
    {
        "version": "0.1",
        "network": "agrmet",
        "ident": None,
        "lon": 1090937,
        "lat": 4455123,
        "date": "2026-08-13T04:00:00Z",
        "data": [{"vars": {"B01019": {"v": "Formigine"}, "B12101": {"v": 294.9}}}],
    }
)


def test_tiene_solo_le_reti_marine():
    trovate = stations.parse_realtime([RIGA_BOA, RIGA_TERRA])
    assert [s.name for s in trovate] == ["Nausicaa 2"]


def test_le_coordinate_sono_in_gradi():
    s = stations.parse_realtime([RIGA_BOA])[0]
    assert s.lon == 12.47590
    assert s.lat == 44.21460


def test_l_identificativo_e_stabile_e_senza_spazi():
    s = stations.parse_realtime([RIGA_BOA])[0]
    assert s.id == "boa-nausicaa-2"
    assert stations.slugify("boa", "Nausicaa 2") == "boa-nausicaa-2"
    assert stations.slugify("marefe", "Po di Goro") == "marefe-po-di-goro"


def test_raccoglie_le_variabili_osservate():
    s = stations.parse_realtime([RIGA_BOA])[0]
    assert "B22070" in s.variables
    assert "B22001" in s.variables
    # I codici anagrafici non sono variabili osservate.
    assert "B01019" not in s.variables


def test_una_stazione_ripetuta_compare_una_volta_sola():
    trovate = stations.parse_realtime([RIGA_BOA, RIGA_BOA, RIGA_BOA])
    assert len(trovate) == 1


def test_una_riga_malformata_non_ferma_il_parsing():
    trovate = stations.parse_realtime(["non e' json", RIGA_BOA, ""])
    assert len(trovate) == 1


def test_il_dizionario_e_serializzabile():
    d = stations.stations_to_dict(stations.parse_realtime([RIGA_BOA]))
    json.dumps(d)
    assert d["stations"][0]["id"] == "boa-nausicaa-2"
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_stations.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.stations'`

- [ ] **Step 3: Scrivere `ingest/stations.py`**

```python
"""Anagrafica delle stazioni marine.

Il flusso in tempo reale e' JSONL con codici variabile BUFR/DB-All.e. Qui
interessano solo le reti marine: le boe ondametriche e i mareografi.

Nessuna boa ARPAE misura profili verticali: le colonne d'acqua che
pubblicheremo sono sempre dati di modello, e vanno etichettate come tali.
"""

import json
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

import requests

from .config import OBSERVED_NETWORKS, OBSERVED_REALTIME

# Le coordinate arrivano come interi moltiplicati per centomila.
_SCALA_COORDINATE = 100_000.0

# I codici anagrafici e temporali non sono grandezze osservate.
_PREFISSI_NON_OSSERVATI = ("B01", "B04", "B05", "B06")

_NON_ALFANUMERICO = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    network: str
    lon: float
    lat: float
    variables: tuple[str, ...]


def slugify(network: str, name: str) -> str:
    normalizzato = unicodedata.normalize("NFKD", name)
    senza_accenti = normalizzato.encode("ascii", "ignore").decode("ascii")
    pezzo = _NON_ALFANUMERICO.sub("-", senza_accenti.lower()).strip("-")
    return f"{network}-{pezzo}"


def parse_realtime(lines: Iterable[str]) -> list[Station]:
    accumulate: dict[str, dict] = {}

    for riga in lines:
        riga = riga.strip()
        if not riga:
            continue
        try:
            record = json.loads(riga)
        except json.JSONDecodeError:
            continue

        rete = record.get("network")
        if rete not in OBSERVED_NETWORKS:
            continue

        nome = None
        variabili: set[str] = set()
        for blocco in record.get("data", []):
            for codice, valore in blocco.get("vars", {}).items():
                if codice == "B01019":
                    nome = valore.get("v")
                if not codice.startswith(_PREFISSI_NON_OSSERVATI):
                    variabili.add(codice)

        if not nome:
            continue

        identificativo = slugify(rete, nome)
        voce = accumulate.setdefault(
            identificativo,
            {
                "name": nome,
                "network": rete,
                "lon": record["lon"] / _SCALA_COORDINATE,
                "lat": record["lat"] / _SCALA_COORDINATE,
                "variables": set(),
            },
        )
        voce["variables"].update(variabili)

    return [
        Station(
            id=identificativo,
            name=v["name"],
            network=v["network"],
            lon=v["lon"],
            lat=v["lat"],
            variables=tuple(sorted(v["variables"])),
        )
        for identificativo, v in sorted(accumulate.items())
    ]


def fetch_stations(url: str = OBSERVED_REALTIME, session=None) -> list[Station]:
    ses = session or requests
    with ses.get(url, stream=True, timeout=300) as risposta:
        risposta.raise_for_status()
        return parse_realtime(
            riga.decode("utf-8", "replace") for riga in risposta.iter_lines()
        )


def stations_to_dict(stations: list[Station]) -> dict:
    return {
        "stations": [
            {
                "id": s.id,
                "name": s.name,
                "network": s.network,
                "lon": s.lon,
                "lat": s.lat,
                "variables": list(s.variables),
            }
            for s in stations
        ]
    }
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_stations.py -v`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add ingest/stations.py tests/test_stations.py
git commit -m "feat: anagrafica delle stazioni marine dal flusso BUFR"
```

---

### Task 10: Profili verticali sulle stazioni

**Files:**
- Create: `ingest/profiles.py`
- Test: `tests/test_profiles.py`

**Interfaces:**
- Consumes: `stations.Station`, `grid.lonlat_to_mercator`, `encode.*`, `frames.read_times`, `config.PROFILE_GROUPS`, `config.MAX_NEIGHBOUR_DISTANCE_M`
- Produces:
  - `nearest_sea_cells(stations, lon_rho, lat_rho, sea_mask, max_distance_m) -> dict[str, tuple[int, int]]`
  - `column_key(station_id: str, date: str) -> str` restituisce `stations/{id}/columns/{YYYY-MM-DD}.bin`
  - `extract_columns(ds, var_names: tuple[str, ...], cells: dict[str, tuple[int, int]], scale: float) -> dict[str, np.ndarray]`
  - `PROFILE_SCALE: float`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_profiles.py`:

```python
"""Estrazione delle colonne verticali sulle celle delle stazioni."""
import numpy as np
from netCDF4 import Dataset

from ingest import encode, profiles
from ingest.stations import Station
from tests.conftest import NS, NT, synthetic_coords, synthetic_sea_mask


def _stazione(lon, lat, identificativo="boa-prova"):
    return Station(
        id=identificativo, name="Prova", network="boa", lon=lon, lat=lat, variables=()
    )


def test_trova_la_cella_di_mare_piu_vicina():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    assert celle["boa-prova"] == (1, 1)


def test_una_stazione_lontana_dal_mare_viene_scartata():
    """Le stazioni lagunari possono non avere una cella ADRIAC vicina."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(20.0, 40.0, "boa-lontana")
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    assert "boa-lontana" not in celle


def test_una_stazione_sopra_la_terraferma_prende_la_cella_di_mare_vicina():
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    # riga 4 e' terra, riga 3 e' l'ultima di mare
    s = _stazione(float(lon[4, 2]), float(lat[4, 2]), "boa-costa")
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=5000.0)
    assert celle["boa-costa"][0] <= 3


def test_la_chiave_della_colonna_e_giornaliera():
    """L'object storage non supporta l'append: un file mensile andrebbe
    riscritto ogni giorno, perdendo l'immutabilita'."""
    assert (
        profiles.column_key("boa-nausicaa-2", "20260813")
        == "stations/boa-nausicaa-2/columns/2026-08-13.bin"
    )


def test_estrae_una_colonna_per_istante_e_per_variabile(profile_file):
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    with Dataset(str(profile_file)) as ds:
        colonne = profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)
    grezzo = colonne["boa-prova"]
    assert grezzo.shape == (NT, 1, NS)
    assert grezzo.dtype == np.int16


def test_i_valori_estratti_sono_quelli_del_file(profile_file):
    """Nel file sintetico temp vale livello + ora*10."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    s = _stazione(float(lon[1, 1]), float(lat[1, 1]))
    celle = profiles.nearest_sea_cells([s], lon, lat, mare, max_distance_m=2000.0)
    with Dataset(str(profile_file)) as ds:
        colonne = profiles.extract_columns(ds, ("temp",), celle, profiles.PROFILE_SCALE)
    valori = encode.dequantize(colonne["boa-prova"], profiles.PROFILE_SCALE)
    assert np.allclose(valori[0, 0], [0.0, 1.0, 2.0], atol=0.01)
    assert np.allclose(valori[1, 0], [10.0, 11.0, 12.0], atol=0.01)
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_profiles.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.profiles'`

- [ ] **Step 3: Scrivere `ingest/profiles.py`**

```python
"""Colonne verticali sulle celle delle stazioni.

Si estraggono i 30 valori sigma grezzi, senza conversione in metri: s_rho,
Cs_r, hc e la batimetria sono statici e gia' archiviati, quindi la profondita'
reale si ricostruisce in qualunque momento. Rimandiamo la parte difficile
senza perdere il dato.

Solo da file di analisi. Scaricare 1,2 GB al giorno per estrarne 130 KB e'
sproporzionato ma inevitabile: NetCDF non supporta richieste parziali per
cella.
"""

import numpy as np
from scipy.spatial import cKDTree

from . import encode, grid
from .config import MAX_NEIGHBOUR_DISTANCE_M

# Centesimi di unita': va bene per gradi Celsius, salinita' pratica e m/s.
PROFILE_SCALE = 0.01


def nearest_sea_cells(
    stations, lon_rho, lat_rho, sea_mask, max_distance_m: float = MAX_NEIGHBOUR_DISTANCE_M
) -> dict[str, tuple[int, int]]:
    """Cella di mare ADRIAC piu' vicina a ogni stazione.

    Restituisce solo le stazioni che ne hanno una entro la soglia: le
    stazioni lagunari del delta possono non averla, e vanno saltate con un
    log invece che approssimate.
    """
    lon_rho = np.asarray(lon_rho, dtype=np.float64)
    lat_rho = np.asarray(lat_rho, dtype=np.float64)
    sea_mask = np.asarray(sea_mask, dtype=bool)

    righe, colonne = np.nonzero(sea_mask)
    sx, sy = grid.lonlat_to_mercator(lon_rho[sea_mask], lat_rho[sea_mask])
    albero = cKDTree(np.column_stack([sx, sy]))

    fuori: dict[str, tuple[int, int]] = {}
    for stazione in stations:
        px, py = grid.lonlat_to_mercator(
            np.array(stazione.lon), np.array(stazione.lat)
        )
        distanza, posizione = albero.query([float(px), float(py)])
        al_suolo = distanza * np.cos(np.radians(stazione.lat))
        if not np.isfinite(distanza) or al_suolo > max_distance_m:
            continue
        fuori[stazione.id] = (int(righe[posizione]), int(colonne[posizione]))
    return fuori


def column_key(station_id: str, date: str) -> str:
    iso = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    return f"stations/{station_id}/columns/{iso}.bin"


def extract_columns(
    ds, var_names: tuple[str, ...], cells: dict[str, tuple[int, int]], scale: float
) -> dict[str, np.ndarray]:
    """Colonne sigma per stazione, forma (istanti, variabili, livelli).

    Si legge la fetta ds[var][t] intera una volta per istante e si indicizza
    in memoria: su NetCDF3 contiguo e' nettamente piu' rapido che fare una
    lettura strided per stazione, e la memoria di picco resta bassa (circa
    25 MB per fetta).
    """
    n_istanti = len(ds.dimensions["ocean_time"])
    n_livelli = len(ds.dimensions["s_rho"])

    accumulato = {
        identificativo: np.full(
            (n_istanti, len(var_names), n_livelli), np.nan, dtype=np.float64
        )
        for identificativo in cells
    }

    for indice_variabile, nome in enumerate(var_names):
        variabile = ds.variables[nome]
        for indice_t in range(n_istanti):
            fetta = np.ma.filled(variabile[indice_t].astype(np.float64), np.nan)
            for identificativo, (riga, colonna) in cells.items():
                accumulato[identificativo][indice_t, indice_variabile, :] = fetta[
                    :, riga, colonna
                ]

    return {
        identificativo: encode.quantize(valori, scale)[0]
        for identificativo, valori in accumulato.items()
    }
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_profiles.py -v`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add ingest/profiles.py tests/test_profiles.py
git commit -m "feat: colonne verticali sigma sulle celle delle stazioni"
```

---

### Task 11: Indici mensili e catalogo

**Files:**
- Create: `ingest/catalog.py`
- Test: `tests/test_catalog.py`

**Interfaces:**
- Consumes: `config.FIELDS`, `config.SCHEMA_VERSION`, `manifest.RunManifest`, `storage.ObjectStore`
- Produces:
  - `index_key(var: str, kind: str, month: str) -> str`
  - `merge_index(existing: dict | None, records) -> dict` dove `records` e' un iterabile di `(valid_time, reference_date)`
  - `rebuild_indices(store, manifests: list[RunManifest]) -> set[str]` restituisce le chiavi scritte
  - `build_catalog(store, grid_dict: dict) -> dict`
  - `write_catalog(store, catalog: dict) -> None`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_catalog.py`:

```python
"""Indici mensili e catalogo."""
import json
from datetime import datetime, timezone

import boto3
import pytest
from moto import mock_aws

from ingest import catalog, manifest
from ingest.storage import ObjectStore

BUCKET = "prova"


def _frame(var, valid_time):
    return manifest.FrameRecord(
        var=var,
        valid_time=valid_time,
        path=f"frames/{var}/an/x/{valid_time:%Y-%m-%dT%H}.bin",
        sha256="x",
        scale=0.001,
        offset=0.0,
        min=0.0,
        max=1.0,
        nodata_count=0,
        clipped_count=0,
    )


def _manifest(reference_time, frames, kind="an"):
    return manifest.RunManifest(
        source_url="https://esempio/f.nc.gz",
        source_sha256="x",
        source_bytes=1,
        source_last_modified="x",
        reference_time=reference_time,
        kind=kind,
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=reference_time,
        frames=frames,
    )


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(BUCKET, None, "chiave", "segreto", region="us-east-1")


def test_la_chiave_dell_indice_e_mensile():
    assert catalog.index_key("hwave", "an", "2026-08") == "index/hwave/an/2026-08.json"


def test_l_indice_raccoglie_le_ore_disponibili():
    d = catalog.merge_index(
        None,
        [
            (datetime(2026, 8, 12, 1, tzinfo=timezone.utc), "20260813"),
            (datetime(2026, 8, 12, 2, tzinfo=timezone.utc), "20260813"),
        ],
    )
    assert d["hours"] == {
        "2026-08-12T01:00:00Z": "20260813",
        "2026-08-12T02:00:00Z": "20260813",
    }


def test_l_indice_si_fonde_senza_perdere_lo_storico():
    prima = catalog.merge_index(
        None, [(datetime(2026, 8, 12, 1, tzinfo=timezone.utc), "20260813")]
    )
    dopo = catalog.merge_index(
        prima, [(datetime(2026, 8, 12, 2, tzinfo=timezone.utc), "20260813")]
    )
    assert len(dopo["hours"]) == 2


def test_un_run_piu_recente_sovrascrive_il_riferimento_della_stessa_ora():
    """Due run di previsione coprono la stessa ora: vince il piu' recente.

    L'archivio conserva comunque entrambi i frame su percorsi diversi:
    qui si decide solo quale l'indice segnala per primo.
    """
    prima = catalog.merge_index(
        None, [(datetime(2026, 8, 14, 1, tzinfo=timezone.utc), "20260812")]
    )
    dopo = catalog.merge_index(
        prima, [(datetime(2026, 8, 14, 1, tzinfo=timezone.utc), "20260813")]
    )
    assert dopo["hours"]["2026-08-14T01:00:00Z"] == "20260813"


def test_il_catalogo_elenca_le_variabili_con_unita_e_colormap(store):
    c = catalog.build_catalog(store, {"crs": "EPSG:3857", "width": 10, "height": 10})
    per_id = {v["id"]: v for v in c["variables"]}
    assert per_id["hwave"]["units"] == "m"
    assert per_id["hwave"]["scale"] == 0.001
    assert per_id["hwave"]["colormap"] == "amp"
    assert c["schema_version"]
    assert c["grid"]["crs"] == "EPSG:3857"


def test_il_catalogo_si_scrive_ed_e_rileggibile(store):
    c = catalog.build_catalog(store, {"crs": "EPSG:3857"})
    catalog.write_catalog(store, c)
    assert store.get_json("catalog.json")["schema_version"] == c["schema_version"]


def test_un_run_a_cavallo_di_due_mesi_tocca_due_indici(store):
    """Il raggruppamento e' per frame, non per manifest.

    Un run che copre la mezzanotte di fine mese tocca due indici mensili.
    Raggruppando per manifest se ne perderebbe uno, e quelle ore
    sparirebbero dal catalogo pur essendo su bucket.
    """
    m = _manifest(
        reference_time=datetime(2026, 9, 1, tzinfo=timezone.utc),
        frames=[
            _frame("hwave", datetime(2026, 8, 31, 23, tzinfo=timezone.utc)),
            _frame("hwave", datetime(2026, 9, 1, 0, tzinfo=timezone.utc)),
        ],
    )
    scritte = catalog.rebuild_indices(store, [m])
    assert scritte == {
        "index/hwave/an/2026-08.json",
        "index/hwave/an/2026-09.json",
    }
    agosto = store.get_json("index/hwave/an/2026-08.json")
    assert agosto["hours"] == {"2026-08-31T23:00:00Z": "20260901"}


def test_rebuild_indices_non_cancella_quanto_gia_sul_bucket(store):
    """Il giro di leggi, modifica e scrivi deve conservare lo storico."""
    primo = _manifest(
        reference_time=datetime(2026, 8, 13, tzinfo=timezone.utc),
        frames=[_frame("hwave", datetime(2026, 8, 12, 1, tzinfo=timezone.utc))],
    )
    catalog.rebuild_indices(store, [primo])

    secondo = _manifest(
        reference_time=datetime(2026, 8, 14, tzinfo=timezone.utc),
        frames=[_frame("hwave", datetime(2026, 8, 12, 2, tzinfo=timezone.utc))],
    )
    catalog.rebuild_indices(store, [secondo])

    indice = store.get_json("index/hwave/an/2026-08.json")
    assert set(indice["hours"]) == {
        "2026-08-12T01:00:00Z",
        "2026-08-12T02:00:00Z",
    }


def test_rebuild_indices_separa_analisi_e_previsione(store):
    """Analisi e previsione della stessa ora vivono su indici distinti.

    Fonderle renderebbe impossibile il confronto fra le due, che e' meta'
    del valore scientifico dell'archivio.
    """
    istante = datetime(2026, 8, 14, 1, tzinfo=timezone.utc)
    analisi = _manifest(
        reference_time=datetime(2026, 8, 15, tzinfo=timezone.utc),
        frames=[_frame("hwave", istante)],
        kind="an",
    )
    previsione = _manifest(
        reference_time=datetime(2026, 8, 13, tzinfo=timezone.utc),
        frames=[_frame("hwave", istante)],
        kind="fc",
    )
    scritte = catalog.rebuild_indices(store, [analisi, previsione])
    assert scritte == {
        "index/hwave/an/2026-08.json",
        "index/hwave/fc/2026-08.json",
    }
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_catalog.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.catalog'`

- [ ] **Step 3: Scrivere `ingest/catalog.py`**

```python
"""Indici mensili e catalogo.

Il catalogo e' cio' che il client legge per sapere cosa esiste, quindi si
scrive sempre per ultimo: se il run muore a metà, il browser semplicemente
non vede ancora i dati nuovi, invece di vedere un catalogo che promette
frame inesistenti. Niente transazioni, solo ordine di scrittura.
"""

from collections.abc import Iterable
from datetime import datetime, timezone

from .config import FIELDS, INGEST_VERSION, SCHEMA_VERSION

_FORMATO = "%Y-%m-%dT%H:%M:%SZ"


def index_key(var: str, kind: str, month: str) -> str:
    return f"index/{var}/{kind}/{month}.json"


def merge_index(existing: dict | None, records: Iterable[tuple[datetime, str]]) -> dict:
    """Fonde nuove ore in un indice mensile.

    La chiave e' l'istante valido, il valore e' il run di riferimento da cui
    prendere il frame. Se la stessa ora arriva da un run piu' recente, vince
    quello: entrambi i frame restano comunque in archivio su percorsi
    distinti, qui si sceglie solo cosa segnalare per primo.
    """
    ore: dict[str, str] = dict((existing or {}).get("hours", {}))
    for valido, riferimento in records:
        chiave = valido.astimezone(timezone.utc).strftime(_FORMATO)
        precedente = ore.get(chiave)
        if precedente is None or riferimento >= precedente:
            ore[chiave] = riferimento
    return {"hours": dict(sorted(ore.items()))}


def rebuild_indices(store, manifests) -> set[str]:
    """Aggiorna gli indici mensili toccati dai manifest passati."""
    per_indice: dict[tuple[str, str, str], list[tuple[datetime, str]]] = {}
    for m in manifests:
        riferimento = m.reference_time.astimezone(timezone.utc).strftime("%Y%m%d")
        for frame in m.frames:
            mese = frame.valid_time.astimezone(timezone.utc).strftime("%Y-%m")
            per_indice.setdefault((frame.var, m.kind, mese), []).append(
                (frame.valid_time, riferimento)
            )

    scritte: set[str] = set()
    for (variabile, tipo, mese), record in per_indice.items():
        chiave = index_key(variabile, tipo, mese)
        store.put_json(chiave, merge_index(store.get_json(chiave), record))
        scritte.add(chiave)
    return scritte


def build_catalog(store, grid_dict: dict) -> dict:
    """Costruisce il catalogo leggendo gli indici presenti sul bucket."""
    variabili = []
    for campo in FIELDS:
        voce = {
            "id": campo.id,
            "units": campo.units,
            "scale": campo.scale,
            "offset": campo.offset,
            "colormap": campo.colormap,
            "kinds": {},
        }
        for tipo in ("an", "fc"):
            mesi = sorted(
                chiave.rsplit("/", 1)[-1].removesuffix(".json")
                for chiave in store.list_keys(f"index/{campo.id}/{tipo}/")
            )
            if mesi:
                voce["kinds"][tipo] = {"months": mesi}
        variabili.append(voce)

    return {
        "schema_version": SCHEMA_VERSION,
        "ingest_version": INGEST_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime(_FORMATO),
        "grid": grid_dict,
        "variables": variabili,
    }


def write_catalog(store, catalog: dict) -> None:
    store.put_json("catalog.json", catalog)
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_catalog.py -v`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add ingest/catalog.py tests/test_catalog.py
git commit -m "feat: indici mensili e catalogo scritto per ultimo"
```

---

### Task 12: Orchestratore di riconciliazione

**Files:**
- Create: `ingest/reconcile.py`
- Test: `tests/test_reconcile.py`

**Interfaces:**
- Consumes: tutti i moduli precedenti
- Produces:
  - `GridMismatch(Exception)`
  - `PlannedWork` dataclass frozen con `source: source.SourceFile`, `reason: str`
  - `plan(store, files, window_days, only=None) -> list[PlannedWork]`
  - `ensure_index(store, ds, workdir) -> grid.RegridIndex` costruisce o rilegge l'indice, solleva `GridMismatch` se l'impronta non coincide
  - `process_file(store, index, work, workdir, session=None) -> manifest.RunManifest`
  - `reconcile(store, workdir, window_days=config.WINDOW_DAYS, only=None, dry_run=False, session=None) -> dict` con chiavi `planned`, `processed`, `skipped`, `errors`

- [ ] **Step 1: Scrivere i test**

Creare `tests/test_reconcile.py`:

```python
"""L'orchestratore: diff, guardia sulla griglia, idempotenza."""
from datetime import datetime, timezone

import boto3
import numpy as np
import pytest
from moto import mock_aws
from netCDF4 import Dataset

from ingest import grid, manifest, reconcile
from ingest.source import parse_filename
from ingest.storage import ObjectStore
from tests.conftest import synthetic_coords, synthetic_sea_mask, write_wave_file

BUCKET = "prova"


@pytest.fixture
def store():
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(BUCKET, None, "chiave", "segreto", region="us-east-1")


def _file_sorgente(nome="20260813_adriac_1km_his_HPDwave_an.nc.gz"):
    return parse_filename(nome)


def test_il_piano_ignora_i_gruppi_non_configurati(store):
    file = [
        _file_sorgente(),
        _file_sorgente("20260813_adriac_1km_avg_2dcur_an.nc.gz"),
    ]
    pianificato = reconcile.plan(store, file, window_days=8)
    gruppi = {p.source.group for p in pianificato}
    assert "his_HPDwave" in gruppi
    assert "avg_2dcur" not in gruppi


def test_il_piano_include_i_file_gia_ingeriti(store, monkeypatch):
    """L'impronta si verifica dopo lo scaricamento, non in pianificazione.

    `plan()` non conosce lo sha256 del sorgente senza scaricarlo, quindi
    pianifica comunque e la deduplica avviene in `process_file`. Il nome di
    questo test diceva il contrario e mentiva.
    """
    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    istante = datetime(2026, 8, 13, tzinfo=timezone.utc)
    esistente = manifest.RunManifest(
        source_url=f.url,
        source_sha256="impronta",
        source_bytes=1,
        source_last_modified="x",
        reference_time=istante,
        kind="an",
        group="his_HPDwave",
        grid_ref="grid.json",
        ingested_at=istante,
        frames=[],
    )
    store.put_json(manifest.manifest_key("20260813", "an", "his_HPDwave"), esistente.to_dict())
    # Il piano si basa sul manifest: senza scaricare non conosce l'impronta,
    # quindi pianifica comunque e la deduplica avviene in process_file.
    pianificato = reconcile.plan(store, [f], window_days=8)
    assert len(pianificato) == 1
    assert pianificato[0].reason == "manifest presente, impronta da verificare"


def test_la_guardia_sulla_griglia_ferma_il_job(store, tmp_path, wave_file):
    """Se le coordinate sorgente cambiano, l'indice in cache produrrebbe
    frame plausibili con i valori nel posto sbagliato."""
    lon, lat = synthetic_coords()
    mare = synthetic_sea_mask()
    g = grid.build_grid(lon, lat, resolution=400.0)
    indice = grid.build_regrid_index(lon, lat, mare, g)
    percorso = tmp_path / "regrid_index.npz"
    # Impronta falsificata: simula un cambio di griglia a monte.
    grid.save_index(
        grid.RegridIndex(indice.indices, indice.sea_mask, "impronta-vecchia", g), percorso
    )
    with Dataset(str(wave_file)) as ds:
        with pytest.raises(reconcile.GridMismatch):
            reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)


def test_la_guardia_sulla_griglia_ferma_reconcile(store, tmp_path, monkeypatch, wave_file):
    """GridMismatch deve uscire da reconcile(), non essere contata come errore.

    reconcile() cattura Exception per non far cadere l'intero run su un file
    storto. Se quella clausola inghiottisse anche GridMismatch, il run
    proseguirebbe scrivendo frame con i valori nel posto sbagliato, che e'
    esattamente il danno che la guardia esiste per impedire. Verificare
    ensure_index in isolamento non basta: la clausola larga sta qui.
    """
    f = _file_sorgente()
    monkeypatch.setattr(reconcile.source, "list_source_files", lambda session=None: [f])
    monkeypatch.setattr(reconcile.stations, "fetch_stations", lambda session=None: [])
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    def esplode(*args, **kwargs):
        raise reconcile.GridMismatch("le coordinate sorgente sono cambiate")

    monkeypatch.setattr(reconcile, "ensure_index", esplode)

    with pytest.raises(reconcile.GridMismatch):
        reconcile.reconcile(store, tmp_path, window_days=8)

    # Il punto della guardia: non deve essere stato scritto niente.
    assert store.get_json("catalog.json") is None


def test_la_guardia_scatta_anche_sull_indice_ripreso_dal_bucket(store, tmp_path, wave_file):
    """La configurazione di produzione: workdir fredda, indice dal bucket, dominio cambiato.

    Il test sulla guardia con la cache locale non passa mai dal ramo che
    scarica l'indice dall'object store, perche' `cache_path` esiste gia'. In
    produzione quel ramo e' l'unica strada, visto che la workdir e' effimera.
    Che i due rami convergano e' un ragionamento letto nel codice: qui viene
    verificato.
    """
    prima = tmp_path / "run1"
    prima.mkdir()
    with Dataset(str(wave_file)) as ds:
        reconcile.ensure_index(store, ds, prima)

    # Stesso file, coordinate spostate: e' il dominio riconfigurato a monte.
    altro = write_wave_file(tmp_path / "altro.nc")
    with Dataset(str(altro), "a") as ds:
        ds.variables["lon_rho"][:] = ds.variables["lon_rho"][:] + 0.5

    seconda = tmp_path / "run2"
    seconda.mkdir()
    with Dataset(str(altro)) as ds:
        with pytest.raises(reconcile.GridMismatch):
            reconcile.ensure_index(store, ds, seconda)


def test_l_indice_si_costruisce_al_primo_giro_e_si_riusa(store, tmp_path, wave_file):
    percorso = tmp_path / "regrid_index.npz"
    with Dataset(str(wave_file)) as ds:
        primo = reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)
        assert percorso.exists()
        secondo = reconcile.ensure_index(store, ds, tmp_path, cache_path=percorso)
    assert np.array_equal(primo.indices, secondo.indices)


def test_il_catalogo_si_scrive_dopo_i_frame(store, tmp_path, monkeypatch, wave_file):
    """Ordine di scrittura: frame, manifest, indici, catalogo."""
    ordine = []
    put_frame_originale = store.put_frame
    put_json_originale = store.put_json

    def traccia_frame(key, blob):
        ordine.append(("frame", key))
        return put_frame_originale(key, blob)

    def traccia_json(key, obj):
        ordine.append(("json", key))
        return put_json_originale(key, obj)

    monkeypatch.setattr(store, "put_frame", traccia_frame)
    monkeypatch.setattr(store, "put_json", traccia_json)

    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    reconcile.reconcile(store, tmp_path, window_days=8, only="hwave")

    chiavi = [k for _, k in ordine]
    assert "catalog.json" in chiavi
    assert chiavi.index("catalog.json") == len(chiavi) - 1
    assert any(k.startswith("frames/") for k in chiavi)


def test_il_secondo_giro_non_scrive_nulla(store, tmp_path, monkeypatch, wave_file):
    """Idempotenza: rilanciare non deve produrre scritture."""
    f = _file_sorgente()
    monkeypatch.setattr(
        reconcile.source, "head", lambda url, session=None: {"bytes": 1, "last_modified": "x"}
    )
    monkeypatch.setattr(
        reconcile.source,
        "download",
        lambda url, dest, session=None: (
            write_wave_file(dest.with_suffix(".nc")),
            "impronta",
        )[1],
    )
    monkeypatch.setattr(reconcile, "decompress_to_nc", lambda gz: gz.with_suffix(".nc"))

    primo = reconcile.reconcile(store, tmp_path, window_days=8)
    assert primo["processed"] >= 1

    secondo = reconcile.reconcile(store, tmp_path, window_days=8)
    assert secondo["processed"] == 0
    assert secondo["skipped"] >= 1
```

Nota per chi implementa: i tre test finali stubbano `source.head`, `source.download` e `decompress_to_nc` per evitare la rete. Serve che `reconcile` esponga `decompress_to_nc(path) -> Path` come funzione di modulo, cosi' da poterla sostituire.

**Serve anche uno stub in piu', altrimenti i test toccano la rete davvero.** `reconcile()` chiama `_aggiorna_anagrafica`, che chiama `stations.fetch_stations`, che fa una GET verso ARPAE. E' avvolto in un try/except, quindi i test passerebbero comunque, ma resterebbero lenti e dipendenti dalla rete. In ogni test che invoca `reconcile.reconcile(...)` aggiungere:

```python
monkeypatch.setattr(
    reconcile.stations, "fetch_stations", lambda session=None: []
)
monkeypatch.setattr(
    reconcile.source, "list_source_files", lambda session=None: [f]
)
```

Il secondo stub sostituisce anche l'elenco dei file sorgente, che altrimenti verrebbe scaricato dalla pagina indice di ARPAE.

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `uv run pytest tests/test_reconcile.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ingest.reconcile'`

- [ ] **Step 3: Scrivere `ingest/reconcile.py`**

```python
"""Orchestratore.

Non fa "scarica i file di oggi": confronta la finestra sorgente di 8 giorni
con il contenuto del bucket e colma la differenza. E' la proprieta' che rende
il sistema robusto: se il job non gira per tre giorni, il run successivo
recupera da solo, e rilanciarlo dieci volte non produce nulla di diverso dal
lanciarlo una volta.
"""

import gzip
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from netCDF4 import Dataset

from . import catalog, config, encode, frames, grid, manifest, profiles, source, stations

log = logging.getLogger(__name__)

INDEX_KEY = "static/regrid_index.npz"
GRID_KEY = "grid.json"
BATHYMETRY_KEY = "static/bathymetry.bin"
STATIONS_KEY = "stations/stations.json"

# 10 cm: il fondale adriatico arriva a 1.246 m, quindi serve un fondoscala
# di almeno quell'ordine (32767 * 0,1 = 3.276 m).
BATHYMETRY_SCALE = 0.1

# Il gruppo da cui si deducono griglia e maschera di mare: e' il piu' piccolo
# e c'e' sempre.
GRUPPO_DI_RIFERIMENTO = "his_HPDwave"
VARIABILE_DI_RIFERIMENTO = "Hwave"


class GridMismatch(Exception):
    """Le coordinate sorgente non corrispondono a quelle dell'indice in cache."""


@dataclass(frozen=True)
class PlannedWork:
    source: source.SourceFile
    reason: str


def decompress_to_nc(gz_path: Path) -> Path:
    """Scompatta un .nc.gz accanto a se stesso e cancella il compresso."""
    destinazione = gz_path.with_suffix("")
    with gzip.open(gz_path, "rb") as ingresso, open(destinazione, "wb") as uscita:
        shutil.copyfileobj(ingresso, uscita, length=1 << 22)
    gz_path.unlink(missing_ok=True)
    return destinazione


def _gruppi_di_interesse() -> set[str]:
    gruppi = set(config.FIELD_GROUPS)
    gruppi.update(nome for nome, _ in config.PROFILE_GROUPS)
    return gruppi


def plan(store, files, window_days: int = config.WINDOW_DAYS, only: str | None = None):
    """Elenca il lavoro da fare, senza scaricare nulla."""
    limite = (datetime.now(timezone.utc) - timedelta(days=window_days)).strftime("%Y%m%d")
    interessanti = _gruppi_di_interesse()

    lavoro: list[PlannedWork] = []
    for f in files:
        if f.date < limite:
            continue
        if f.group not in interessanti:
            continue
        # I profili si estraggono solo dall'analisi.
        if f.group in {nome for nome, _ in config.PROFILE_GROUPS} and f.kind != "an":
            continue
        if only and only not in {c.id for c in config.fields_for(f.group)}:
            continue

        esistente = store.get_json(manifest.manifest_key(f.date, f.kind, f.group))
        motivo = (
            "manifest presente, impronta da verificare" if esistente else "mai ingerito"
        )
        lavoro.append(PlannedWork(source=f, reason=motivo))
    return lavoro


def ensure_index(store, ds, workdir: Path, cache_path: Path | None = None):
    """Costruisce l'indice di ricampionamento o lo rilegge dalla cache.

    Se l'impronta delle coordinate del file non coincide con quella
    dell'indice salvato, solleva GridMismatch e il job si ferma senza
    scrivere. E' l'unico guasto di questo sistema che non si annuncia da
    solo: produrrebbe frame plausibili con i valori nel posto sbagliato,
    indistinguibili da quelli buoni una volta in archivio.
    """
    cache_path = cache_path or (workdir / "regrid_index.npz")
    lon, lat = frames.read_grid_coords(ds)
    impronta = grid.coordinate_fingerprint(lon, lat)

    # L'indice vive sull'object store, non solo sul disco locale. I runner di
    # GitHub Actions sono effimeri: un indice che stesse solo in workdir
    # verrebbe ricostruito a ogni run dal file corrente, coinciderebbe sempre
    # con se stesso, e la guardia non scatterebbe mai. Il disco locale resta
    # solo come ottimizzazione dentro un singolo run.
    if not cache_path.exists():
        remoto = store.get_binary(INDEX_KEY)
        if remoto is not None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(remoto)

    if cache_path.exists():
        indice = grid.load_index(cache_path)
        if indice.fingerprint != impronta:
            raise GridMismatch(
                "le coordinate sorgente sono cambiate: "
                f"attesa {indice.fingerprint[:12]}, trovata {impronta[:12]}. "
                "L'indice in cache produrrebbe valori nel posto sbagliato. "
                "Verificare il dominio ADRIAC e rigenerare l'indice a mano."
            )
        return indice

    mare = frames.read_sea_mask(ds, VARIABILE_DI_RIFERIMENTO)
    g = grid.build_grid(lon, lat)
    indice = grid.build_regrid_index(lon, lat, mare, g)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    grid.save_index(indice, cache_path)
    store.put_binary(INDEX_KEY, cache_path.read_bytes())
    store.put_json(GRID_KEY, grid.grid_to_dict(g))
    log.info("indice costruito: %d x %d celle", g.width, g.height)
    return indice


def process_file(store, index, work: PlannedWork, workdir: Path, session=None):
    """Scarica, lavora e pubblica un file sorgente. Restituisce il manifest,
    oppure None se il file era gia' in archivio con la stessa impronta."""
    f = work.source
    scaricato = workdir / f.name
    percorso_nc = None
    # Il finally copre anche lo scaricamento e la scompattazione, non solo la
    # lavorazione: i file di previsione 3D arrivano a quasi 2 GB contro i 14 GB
    # del runner, e un download interrotto a meta' lascerebbe un residuo che
    # nessuno rimuove. Qualche fallimento di rete in un run di recupero
    # basterebbe a saturare il disco e far cadere anche i file sani.
    try:
        testa = source.head(f.url, session=session)
        chiave_manifest = manifest.manifest_key(f.date, f.kind, f.group)
        esistente = store.get_json(chiave_manifest)

        # Scorciatoia prima di scaricare. L'impronta autorevole resta lo
        # sha256, ma calcolarla impone di scaricare il file: senza questo
        # controllo il secondo run giornaliero riscaricherebbe 1,9 GB solo per
        # ricalcolare impronte identiche a quelle gia' registrate. Dimensione e
        # data di modifica bastano a dire che il sorgente non si e' mosso.
        sorgente = (esistente or {}).get("source", {})
        if (
            esistente
            # La versione di schema va confrontata qui e non solo dentro
            # already_ingested, che questa scorciatoia scavalca: se il formato
            # d'archivio cambia, i file vanno rilavorati anche quando alla
            # sorgente non si sono mossi, altrimenti resterebbero congelati nel
            # vecchio schema per sempre (le loro intestazioni HTTP non
            # cambieranno mai).
            and esistente.get("schema_version") == config.SCHEMA_VERSION
            and sorgente.get("last_modified") == testa["last_modified"]
            and sorgente.get("bytes") == testa["bytes"]
        ):
            log.info("invariato alla sorgente, salto senza scaricare: %s", f.name)
            return None

        impronta = source.download(f.url, scaricato, session=session)
        if manifest.already_ingested(esistente, impronta):
            log.info("gia' in archivio, salto: %s", f.name)
            return None

        percorso_nc = decompress_to_nc(scaricato)
        with Dataset(str(percorso_nc)) as ds:
            corrente = manifest.RunManifest(
                source_url=f.url,
                source_sha256=impronta,
                source_bytes=testa["bytes"],
                source_last_modified=testa["last_modified"],
                reference_time=datetime.strptime(f.date, "%Y%m%d").replace(
                    tzinfo=timezone.utc
                ),
                kind=f.kind,
                group=f.group,
                grid_ref=GRID_KEY,
                ingested_at=datetime.now(timezone.utc),
                frames=[],
            )

            if f.group in config.FIELD_GROUPS:
                for record, blob in frames.extract_frames(ds, f.group, f.kind, f.date, index):
                    store.put_frame(record.path, blob)
                    corrente.frames.append(record)

            gruppi_profilo = dict(config.PROFILE_GROUPS)
            if f.group in gruppi_profilo:
                _pubblica_profili(store, ds, index, f, gruppi_profilo[f.group])

            # La batimetria sta solo nei file 3D, non in quelli d'onda.
            # E' statica: si pubblica la prima volta che se ne incontra una.
            if "h" in ds.variables and not store.exists(BATHYMETRY_KEY):
                _pubblica_batimetria(store, ds, index)

        store.put_json(chiave_manifest, corrente.to_dict())
        return corrente
    finally:
        scaricato.unlink(missing_ok=True)
        if percorso_nc is not None:
            percorso_nc.unlink(missing_ok=True)


def _pubblica_batimetria(store, ds, index):
    """Pubblica la profondita' del fondale ricampionata come gli altri campi.

    Serve al client per disegnare le isobate e, piu' avanti, il fondale nella
    vista a colonna d'acqua. E' un campo statico: si scrive una volta sola.

    La scala e' 10 cm e non 1 cm: il fondale adriatico arriva a 1.246 m, e
    con scala 0,01 il fondoscala sarebbe 327 m, quindi tutto il bacino
    meridionale verrebbe tosato.
    """
    profondita = np.asarray(ds.variables["h"][:], dtype=np.float64)
    mascherata = np.where(index.sea_mask, profondita, np.nan)
    ricampionata = grid.apply_index(mascherata, index)
    quantizzata, stats = encode.quantize(ricampionata, BATHYMETRY_SCALE)
    if stats["clipped_count"]:
        raise ValueError(
            f"batimetria tosata su {stats['clipped_count']} celle: "
            f"massimo {stats['max']} m contro un fondoscala di "
            f"{32767 * BATHYMETRY_SCALE} m"
        )
    store.put_frame(BATHYMETRY_KEY, encode.compress(quantizzata))
    log.info("batimetria pubblicata, da %.1f a %.1f m", stats["min"], stats["max"])


def _pubblica_profili(store, ds, index, f, var_names):
    anagrafica = store.get_json(STATIONS_KEY)
    if not anagrafica:
        log.warning("anagrafica stazioni assente, salto i profili di %s", f.name)
        return
    elenco = [
        stations.Station(
            id=s["id"],
            name=s["name"],
            network=s["network"],
            lon=s["lon"],
            lat=s["lat"],
            variables=tuple(s["variables"]),
        )
        for s in anagrafica["stations"]
    ]
    lon, lat = frames.read_grid_coords(ds)
    celle = profiles.nearest_sea_cells(elenco, lon, lat, index.sea_mask)
    colonne = profiles.extract_columns(ds, var_names, celle, profiles.PROFILE_SCALE)
    for identificativo, valori in colonne.items():
        store.put_frame(
            profiles.column_key(identificativo, f.date), encode.compress(valori.ravel())
        )


def reconcile(
    store,
    workdir: Path,
    window_days: int = config.WINDOW_DAYS,
    only: str | None = None,
    dry_run: bool = False,
    session=None,
) -> dict:
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    file = source.list_source_files(session=session)
    lavoro = plan(store, file, window_days=window_days, only=only)
    esito = {"planned": len(lavoro), "processed": 0, "skipped": 0, "errors": 0}

    if dry_run:
        for w in lavoro:
            log.info("da lavorare: %s (%s)", w.source.name, w.reason)
        return esito

    _aggiorna_anagrafica(store, session)

    indice = None
    prodotti = []
    for w in lavoro:
        try:
            if indice is None and w.source.group == GRUPPO_DI_RIFERIMENTO:
                scaricato = workdir / w.source.name
                percorso = None
                try:
                    source.download(w.source.url, scaricato, session=session)
                    percorso = decompress_to_nc(scaricato)
                    with Dataset(str(percorso)) as ds:
                        indice = ensure_index(store, ds, workdir)
                finally:
                    scaricato.unlink(missing_ok=True)
                    if percorso is not None:
                        percorso.unlink(missing_ok=True)

            if indice is None:
                log.info("indice non ancora disponibile, rimando: %s", w.source.name)
                continue

            corrente = process_file(store, indice, w, workdir, session=session)
            if corrente is None:
                esito["skipped"] += 1
            else:
                prodotti.append(corrente)
                esito["processed"] += 1
        except GridMismatch:
            raise
        except Exception:
            log.exception("errore su %s", w.source.name)
            esito["errors"] += 1

    if prodotti:
        catalog.rebuild_indices(store, prodotti)

    descrittore = store.get_json(GRID_KEY) or {}
    catalog.write_catalog(store, catalog.build_catalog(store, descrittore))
    return esito


def _aggiorna_anagrafica(store, session=None):
    try:
        elenco = stations.fetch_stations(session=session)
    except stations.StationCollision:
        # Come GridMismatch: non e' un guasto passeggero da registrare e
        # scavalcare. Due nomi diversi sullo stesso identificativo vogliono
        # una decisione umana, non un run che prosegue.
        raise
    except Exception:
        log.exception("anagrafica stazioni non aggiornata")
        return
    if elenco:
        store.put_json(STATIONS_KEY, stations.stations_to_dict(elenco))
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `uv run pytest tests/test_reconcile.py -v`
Expected: PASS, 6 test

Nota: se il test sull'ordine di scrittura fallisce perche' `catalog.json` non e' l'ultima chiave, verificare che `write_catalog` sia chiamato dopo `rebuild_indices` e che nessun ramo di errore scriva dopo.

- [ ] **Step 5: Eseguire tutta la suite**

Run: `uv run pytest -v`
Expected: PASS, tutti i test dei task 1 a 12

- [ ] **Step 6: Commit**

```bash
git add ingest/reconcile.py tests/test_reconcile.py
git commit -m "feat: riconciliazione idempotente con guardia sulla griglia"
```

---

### Task 13: Interfaccia a riga di comando

**Files:**
- Create: `ingest/__main__.py`

**Interfaces:**
- Consumes: `reconcile.reconcile`, `storage.ObjectStore.from_env`
- Produces: eseguibile `python -m ingest reconcile [--dry-run] [--window GIORNI] [--only VARIABILE] [--workdir PERCORSO]`

- [ ] **Step 1: Scrivere `ingest/__main__.py`**

```python
"""Interfaccia a riga di comando.

Il primo comando da lanciare e' sempre `reconcile --dry-run`: stampa il piano
senza scrivere niente, e serve a capire se il diff ragiona come ci si aspetta.

Codici di uscita, pensati per un cron che deve decidere da solo cosa fare:

    0  tutto bene
    1  qualche file e' fallito, ritentabile: il run successivo recupera
    2  la griglia sorgente e' cambiata, niente e' stato scritto, serve un umano
    3  configurazione incompleta, fallira' identico a ogni tentativo

La distinzione fra 1 e gli altri due e' l'unica cosa che impedisce a un cron di
ritentare all'infinito un guasto che non si risolve da solo.
"""

import argparse
import logging
import sys
import tempfile
from pathlib import Path

from .config import WINDOW_DAYS
from .reconcile import GridMismatch, reconcile
from .storage import ObjectStore


def main(argv: list[str] | None = None) -> int:
    analizzatore = argparse.ArgumentParser(prog="ingest")
    sottocomandi = analizzatore.add_subparsers(dest="comando", required=True)

    r = sottocomandi.add_parser("reconcile", help="colma la differenza con la sorgente")
    r.add_argument("--dry-run", action="store_true", help="stampa il piano senza scrivere")
    r.add_argument("--window", type=int, default=WINDOW_DAYS, help="giorni da considerare")
    r.add_argument(
        "--only",
        default=None,
        help=(
            "lavora solo i file che contengono questa variabile. Attenzione: "
            "filtra per gruppo, non per variabile, quindi --only hwave pubblica "
            "anche periodo e direzione, che stanno nello stesso file"
        ),
    )
    r.add_argument("--workdir", default=None, help="cartella di lavoro temporanea")
    r.add_argument("--verbose", action="store_true")

    argomenti = analizzatore.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if argomenti.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # Le credenziali si leggono prima di tutto e fuori dal try sotto: mancarle
    # non e' un guasto passeggero, fallirebbe identico a ogni tentativo, e un
    # traceback grezzo farebbe sembrare rotto lo strumento invece che la
    # configurazione.
    try:
        store = ObjectStore.from_env()
    except RuntimeError as errore:
        logging.error("configurazione incompleta: %s", errore)
        logging.error("nessun tentativo eseguito, serve intervento umano")
        return 3

    with tempfile.TemporaryDirectory() as temporanea:
        workdir = Path(argomenti.workdir or temporanea)
        try:
            esito = reconcile(
                store,
                workdir,
                window_days=argomenti.window,
                only=argomenti.only,
                dry_run=argomenti.dry_run,
            )
        except GridMismatch as errore:
            logging.error("LA GRIGLIA SORGENTE E' CAMBIATA: %s", errore)
            logging.error("nessun dato scritto. Intervento umano necessario.")
            return 2

    logging.info(
        "pianificati %d, lavorati %d, saltati %d, errori %d",
        esito["planned"],
        esito["processed"],
        esito["skipped"],
        esito["errors"],
    )
    return 1 if esito["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 1b: Scrivere `tests/test_cli.py`**

I codici di uscita sono il contratto su cui un cron decide se ritentare o svegliare qualcuno. `main` prende argv e restituisce un intero, quindi si testano con due punti di sostituzione.

```python
"""I codici di uscita della CLI: e' il contratto su cui un cron decide."""
from ingest import __main__ as cli
from ingest.reconcile import GridMismatch


def _store_finto(monkeypatch):
    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(lambda cls: object()))


def _esito(errors=0):
    return {"planned": 1, "processed": 1, "skipped": 0, "errors": errors}


def test_un_run_pulito_esce_con_zero(monkeypatch):
    _store_finto(monkeypatch)
    monkeypatch.setattr(cli, "reconcile", lambda *a, **k: _esito())
    assert cli.main(["reconcile"]) == 0


def test_errori_sui_singoli_file_escono_con_uno(monkeypatch):
    """Ritentabile: il run successivo recupera dalla finestra di 8 giorni."""
    _store_finto(monkeypatch)
    monkeypatch.setattr(cli, "reconcile", lambda *a, **k: _esito(errors=1))
    assert cli.main(["reconcile"]) == 1


def test_la_griglia_cambiata_esce_con_due(monkeypatch):
    """Non ritentabile: niente e' stato scritto e serve un umano."""
    _store_finto(monkeypatch)

    def esplode(*a, **k):
        raise GridMismatch("le coordinate sorgente sono cambiate")

    monkeypatch.setattr(cli, "reconcile", esplode)
    assert cli.main(["reconcile"]) == 2


def test_le_credenziali_mancanti_escono_con_tre(monkeypatch):
    """Fallirebbe identico a ogni tentativo: il cron non deve ritentare."""

    def manca(cls):
        raise RuntimeError("variabili d'ambiente mancanti: R2_BUCKET")

    monkeypatch.setattr(cli.ObjectStore, "from_env", classmethod(manca))
    assert cli.main(["reconcile"]) == 3
```

- [ ] **Step 2: Verificare che la CLI risponda**

Run: `uv run python -m ingest reconcile --help`
Expected: stampa l'elenco delle opzioni, uscita 0

- [ ] **Step 3: Verificare il messaggio d'errore senza credenziali**

Run: `env -u R2_BUCKET uv run python -m ingest reconcile --dry-run`
Expected: solleva `RuntimeError: variabili d'ambiente mancanti: R2_BUCKET, ...`

- [ ] **Step 4: Commit**

```bash
git add ingest/__main__.py
git commit -m "feat: CLI dell'ingestore con dry-run"
```

---

### Task 14: Workflow di ingestione e istruzioni di configurazione

**Files:**
- Create: `.github/workflows/ingest.yml`
- Create: `docs/setup-r2.md`

**Interfaces:**
- Consumes: `python -m ingest reconcile`
- Produces: cron giornaliero e documentazione della configurazione manuale

- [ ] **Step 1: Scrivere `.github/workflows/ingest.yml`**

```yaml
name: Ingestione ADRIAC

on:
  schedule:
    # I file ARPAE compaiono verso le 10:30 UTC. Il primo run ha un'ora e
    # mezza di margine, il secondo e' rete di sicurezza e di solito e' un
    # no-op che costa qualche richiesta HEAD.
    - cron: "0 12 * * *"
    - cron: "0 18 * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Stampa il piano senza scrivere"
        type: boolean
        default: false

concurrency:
  group: ingestione
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - name: Libera spazio su disco
        # I file 3D di previsione arrivano a quasi 2 GB compressi. Il runner
        # ne ha 14 di partenza, con diversi GB occupati da immagini inutili.
        run: |
          sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/share/boost
          df -h /

      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true

      - name: Installa le dipendenze
        run: uv sync

      - name: Riconcilia
        env:
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: |
          set +e
          uv run python -m ingest reconcile \
            ${{ inputs.dry_run && '--dry-run' || '' }}
          codice=$?
          set -e
          # I codici di uscita esistono per distinguere "riprova domani" da
          # "serve un umano". Senza questo blocco GitHub li appiattirebbe tutti
          # su "step fallito" e la distinzione andrebbe persa proprio dove
          # serve, cioe' nella mail di notifica.
          case $codice in
            0) echo "Ingestione completata." ;;
            1) echo "::warning::Alcuni file non sono stati lavorati. Ritentabile: il run successivo recupera dalla finestra di 8 giorni." ;;
            2) echo "::error::LA GRIGLIA SORGENTE E' CAMBIATA. Niente e' stato scritto. Serve intervento umano PRIMA del prossimo run, altrimenti l'archivio si riempie di valori nel posto sbagliato." ;;
            3) echo "::error::Configurazione incompleta: mancano credenziali o variabili d'ambiente. Ogni tentativo fallira' allo stesso modo finche' non viene corretta." ;;
            *) echo "::error::Uscita inattesa: $codice" ;;
          esac
          exit $codice
```

- [ ] **Step 2: Scrivere `docs/setup-r2.md`**

```markdown
# Configurazione manuale del bucket

Da fare una volta sola, circa quindici minuti. Servono due account. Nessuno dei
due richiede un pagamento per quello che facciamo qui, ma Cloudflare in alcuni
casi chiede comunque un metodo di pagamento registrato per abilitare R2, anche
sul piano gratuito.

## 1. Cloudflare R2

1. Creare un account su dash.cloudflare.com e attivare R2.
2. Creare un bucket, per esempio `stato-del-mare`.
3. In **Settings**, abilitare **Public access** collegando un dominio, oppure
   tramite `r2.dev` per iniziare. Serve perche' la SPA legge i frame
   direttamente dal browser, senza passare da un backend. Nota che Cloudflare
   documenta `r2.dev` come endpoint di prova, non per traffico di produzione:
   va benissimo per verificare che tutto funzioni, ma per l'uso vero conviene
   un dominio.
4. Sempre in Settings, impostare la policy CORS:

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

   Senza CORS il browser rifiuta le `fetch` verso il bucket.
5. In **R2 > Manage API Tokens** creare un token con permessi di lettura e
   scrittura sul bucket. Annotare Access Key ID, Secret Access Key e
   l'endpoint, che ha la forma
   `https://<account_id>.r2.cloudflarestorage.com`.

Il piano gratuito e' 10 GB di storage, 1 milione di scritture e 10 milioni di
letture al mese, con egress illimitato e senza scadenza. Questo progetto
scrive circa 800 oggetti al giorno, quindi resta due ordini di grandezza sotto
i limiti sulle operazioni. Lo storage si esaurisce verso il terzo mese e
mezzo, poi il costo e' di circa 40 centesimi al mese a fine primo anno.

## 2. GitHub

1. Rendere il repository **pubblico**. Su repo pubblici i minuti di Actions
   sono illimitati; su repo privati i 2.000 mensili gratuiti diventano un
   vincolo, visto che il primo run di ogni giornata scarica circa 1,9 GB. (Il
   secondo run costa quasi nulla: confronta dimensione e data di modifica alla
   sorgente e scarica solo cio' che e' cambiato.) Le credenziali stanno nei
   secret e restano private in ogni caso.
2. In **Settings > Secrets and variables > Actions** aggiungere:
   `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

## 3. Primo giro

Dalla scheda Actions, lanciare **Ingestione ADRIAC** a mano con `dry_run`
attivo: stampa il piano senza scrivere niente. Se l'elenco dei file ha senso,
rilanciare senza `dry_run`.

Attenzione a una trappola comune: i workflow schedulati partono solo quando il
file e' sul **branch predefinito** del repository. Finche' resta su un branch di
lavoro il cron non scatta, anche se l'avvio manuale funziona.

Se un run fallisce, il messaggio in cima al log dice cosa fare: gli errori sui
singoli file si recuperano da soli al run successivo, mentre griglia cambiata e
configurazione incompleta richiedono un intervento prima che abbia senso
riprovare.

Il primo run e' piu' lento degli altri perche' costruisce l'indice di
ricampionamento e lo carica sul bucket come `static/regrid_index.npz`. I run
successivi lo riscaricano da li'.

Quel file non e' un dettaglio di prestazioni: e' la memoria di come era fatta
la griglia ARPAE l'ultima volta. Serve a far scattare la guardia se il dominio
cambia. **Non cancellarlo dal bucket**: senza, ogni run ricostruirebbe l'indice
dal file corrente, che coincide sempre con se stesso, e una riconfigurazione
del modello passerebbe inosservata riempiendo l'archivio di valori nel posto
sbagliato.
```

- [ ] **Step 3: Verificare la sintassi del workflow**

Run: `uv run python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('.github/workflows/ingest.yml').read_text()); print('ok')"`
Expected: stampa `ok`

Se `yaml` non e' disponibile: `uv run --with pyyaml python -c "..."`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ingest.yml docs/setup-r2.md
git commit -m "feat: workflow giornaliero di ingestione e istruzioni per R2"
```

---

### Task 15: Test di coerenza contro i dati reali

Questo e' il test che vale piu' di tutti gli altri: verifica l'intera catena, cioe' sorgente, griglia, codifica, ricampionamento e proiezione, su un punto di cui conosciamo le coordinate.

**Files:**
- Create: `tests/test_coerenza.py`
- Modify: `pyproject.toml` (aggiunge il marcatore `rete`)

**Interfaces:**
- Consumes: tutti i moduli
- Produces: `pytest -m rete` esegue il controllo contro ADRIAC in linea

- [ ] **Step 1: Aggiungere il marcatore in `pyproject.toml`**

**Non sostituire la sezione**: `[tool.pytest.ini_options]` contiene gia' `pythonpath` (senza cui gli import delle fixture falliscono) e `filterwarnings` (il cancello che fa fallire la suite su un avviso). Vanno conservati entrambi.

Modificare solo la riga `addopts` e aggiungere `markers`, lasciando il resto com'e':

```toml
addopts = "-q -m 'not rete'"
markers = [
    "rete: richiede l'accesso alla sorgente ARPAE in linea",
]
```

A modifica fatta, la sezione deve contenere `testpaths`, `addopts`, `pythonpath`, `filterwarnings` e `markers`. Verificarlo rileggendo il file prima di proseguire.

- [ ] **Step 2: Scrivere `tests/test_coerenza.py`**

```python
"""Coerenza end-to-end contro i dati reali.

Escluso dalla suite normale: richiede la rete e scarica circa 23 MB.
Si esegue con `uv run pytest -m rete -v`.

Prende la cella ADRIAC corrispondente a Nausicaa 2, legge il valore dal
NetCDF sorgente e lo confronta con quello che il frontend leggerebbe dal
frame pubblicato. Se questa catena regge, regge tutto il sistema.
"""
import gzip
import shutil

import numpy as np
import pytest
from netCDF4 import Dataset

from ingest import encode, frames, grid, source
from ingest.config import GRID_RESOLUTION_M

# Coordinate reali della boa ondametrica direzionale al largo di Cesenatico.
NAUSICAA_LON = 12.4759
NAUSICAA_LAT = 44.2146

pytestmark = pytest.mark.rete


@pytest.fixture(scope="module")
def file_reale(tmp_path_factory):
    cartella = tmp_path_factory.mktemp("adriac")
    disponibili = [
        f
        for f in source.list_source_files()
        if f.group == "his_HPDwave" and f.kind == "an"
    ]
    assert disponibili, "nessun file di analisi delle onde nella finestra"
    scelto = max(disponibili, key=lambda f: f.date)

    compresso = cartella / scelto.name
    source.download(scelto.url, compresso)
    scompattato = compresso.with_suffix("")
    with gzip.open(compresso, "rb") as ingresso, open(scompattato, "wb") as uscita:
        shutil.copyfileobj(ingresso, uscita, length=1 << 22)
    return scompattato


def test_la_griglia_reale_ha_le_dimensioni_attese(file_reale):
    with Dataset(str(file_reale)) as ds:
        lon, lat = frames.read_grid_coords(ds)
    assert lon.shape == (752, 272)
    g = grid.build_grid(lon, lat, resolution=GRID_RESOLUTION_M)
    # Il valore esatto lo produce il codice: qui si controlla solo che sia
    # nell'ordine di grandezza atteso e che stia in una texture sola.
    assert 700 < g.width < 1100
    assert 700 < g.height < 1100
    assert g.width * g.height < 4096 * 4096


def test_la_maschera_di_mare_corrisponde_al_dominio_noto(file_reale):
    with Dataset(str(file_reale)) as ds:
        mare = frames.read_sea_mask(ds, "Hwave")
    assert mare.sum() == 121543


def test_il_valore_su_nausicaa_sopravvive_a_tutta_la_catena(file_reale):
    with Dataset(str(file_reale)) as ds:
        lon, lat = frames.read_grid_coords(ds)
        mare = frames.read_sea_mask(ds, "Hwave")
        g = grid.build_grid(lon, lat)
        indice = grid.build_regrid_index(lon, lat, mare, g)

        # Cella sorgente piu' vicina alla boa, fra quelle di mare.
        distanza = np.where(
            mare, (lon - NAUSICAA_LON) ** 2 + (lat - NAUSICAA_LAT) ** 2, np.inf
        )
        riga, colonna = np.unravel_index(np.argmin(distanza), distanza.shape)
        atteso = float(ds.variables["Hwave"][0, riga, colonna])

        record, blob = next(
            frames.extract_frames(ds, "his_HPDwave", "an", "20260813", indice)
        )

    # Pixel di destinazione che contiene la boa, come lo calcolerebbe il client.
    px, py = grid.lonlat_to_mercator(np.array(NAUSICAA_LON), np.array(NAUSICAA_LAT))
    colonna_dest = int((float(px) - g.x_min) / g.resolution)
    riga_dest = int((g.y_max - float(py)) / g.resolution)

    valori = encode.dequantize(
        encode.decompress(blob).reshape(g.height, g.width), record.scale, record.offset
    )
    letto = valori[riga_dest, colonna_dest]

    assert not np.isnan(letto), "la boa e' finita su un pixel nodata"
    # Misurato sull'archivio reale il 2026-08-13: lo scarto era 0,0003 m, cioe'
    # il solo passo di quantizzazione. La tolleranza e' comunque 0,15 m perche'
    # le due selezioni non sono la stessa: l'attesa sceglie la cella piu' vicina
    # in gradi, la pipeline in metri Mercator, e con la boa vicina a un confine
    # possono cadere su celle adiacenti, che con mare mosso differiscono di
    # qualche centimetro. Non allargarla oltre: mezzo metro nasconderebbe uno
    # spostamento di piu' celle, che e' proprio cio' che questo test cerca.
    assert abs(letto - atteso) < 0.15, f"letto {letto}, atteso {atteso}"


def test_gli_istanti_del_file_di_analisi_sono_del_giorno_prima(file_reale):
    """La trappola verificata: il file datato D contiene i dati di D-1."""
    with Dataset(str(file_reale)) as ds:
        istanti = frames.read_times(ds)
    assert len(istanti) == 24
    assert istanti[0].hour == 1
    assert istanti[-1].hour == 0
    assert (istanti[-1] - istanti[0]).total_seconds() == 23 * 3600
```

- [ ] **Step 3: Eseguire il test di coerenza**

Run: `uv run pytest -m rete -v`
Expected: PASS, 4 test. Scarica circa 23 MB.

Se `test_la_maschera_di_mare_corrisponde_al_dominio_noto` fallisce, **non correggere il numero**: significa che ARPAE ha cambiato il dominio, ed e' esattamente lo scenario contro cui esiste la guardia in `ensure_index`. Va indagato prima di ingerire altro.

- [ ] **Step 4: Eseguire la suite completa**

Run: `uv run pytest -v && uv run pytest -m rete -v && uv run ruff check .`
Expected: tutto verde

- [ ] **Step 5: Commit**

```bash
git add tests/test_coerenza.py pyproject.toml
git commit -m "test: coerenza end-to-end su Nausicaa 2 contro i dati reali"
```

---

## Allineamento della spec a fine implementazione

Dopo il Task 15, aggiornare `docs/superpowers/specs/2026-08-13-stato-del-mare-design.md`:

- [ ] Sezione 5.2: sostituire 1,5 km con 800 m e riportare la motivazione geometrica
- [ ] Sezione 4.2: correggere il percorso dei manifest in `runs/{data}/{kind}/{gruppo}.json`
- [ ] Sezione 4.6: correggere la granularita' dei profili in giornaliera
- [ ] Sezione 4.4: sostituire la stima delle dimensioni col valore reale prodotto da `build_grid()`
- [ ] Rimuovere il riquadro di avviso in testa al documento
- [ ] Aggiornare `STATO.md`: spostare le correzioni dalla sezione 4c alla sezione 3
- [ ] Commit: `docs: allinea la spec all'implementazione dell'ingestore`
