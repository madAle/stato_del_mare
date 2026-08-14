"""Dai campi 2D di un NetCDF ai frame pubblicabili."""

import hashlib
from collections.abc import Iterator
from datetime import datetime, timezone

import numpy as np
from netCDF4 import num2date

from . import encode, grid
from .config import fields_for, sampling_for
from .manifest import FrameRecord


class UnitMismatch(Exception):
    """L'unita' dichiarata dal NetCDF non e' quella attesa.

    Come GridMismatch, e' un guasto che non si annuncia da solo: se ARPAE
    passasse a centimetri o a millisecondi, i valori si riquantizzerebbero
    bene, clipped_count potrebbe restare zero, e l'archivio si riempirebbe di
    numeri plausibili e sbagliati. Fermarsi e' meglio che sbagliare.
    """


class VariableMissing(Exception):
    """Una variabile attesa non c'e' piu' nel NetCDF.

    La spec 6.1 promette a un cambio di nome variabile lo stesso trattamento di
    un cambio di unita'. Senza questa eccezione il nome assente emergeva come
    KeyError, che la clausola larga di reconcile contava come fallimento
    passeggero: uscita 1, cioe' "riprova domani", e il cron avrebbe ritentato
    due volte al giorno per sempre mentre la finestra di 8 giorni scorreva via.
    Un rename alla sorgente non si risolve da solo.
    """


def read_variable(ds, nc_name: str):
    """La variabile del NetCDF, o VariableMissing se il nome non c'e' piu'."""
    try:
        return ds.variables[nc_name]
    except KeyError:
        raise VariableMissing(
            f"la variabile {nc_name!r} non e' nel file, che contiene "
            f"{sorted(ds.variables)}. La sorgente l'ha rinominata o rimossa: "
            "nessun run successivo lo rimedia da solo. Verificare la sorgente "
            "ADRIAC e aggiornare la configurazione prima di riprovare."
        ) from None


def read_units(ds, nc_name: str) -> str | None:
    """L'attributo units della variabile, None se assente."""
    return getattr(read_variable(ds, nc_name), "units", None)


def check_units(ds, campo) -> str:
    """Confronta l'unita' del file con quella attesa e la restituisce.

    Il valore letto finisce nel manifest: e' l'unica prova, a distanza di
    anni, di cosa diceva davvero il file da cui il frame e' stato prodotto.
    """
    letta = read_units(ds, campo.nc_name)
    if letta != campo.source_units:
        raise UnitMismatch(
            f"{campo.nc_name}: unita' attesa {campo.source_units!r}, "
            f"trovata {letta!r}. I valori si quantizzerebbero senza errori "
            "visibili e l'archivio si riempirebbe di numeri plausibili e "
            "sbagliati. Verificare la sorgente ADRIAC prima di riprovare."
        )
    return letta


def read_times(ds) -> list[datetime]:
    """Istanti validi dal file.

    Si legge sempre ocean_time e mai il nome del file: il file di analisi
    datato D contiene i dati di D-1, e fidarsi del nome sposterebbe tutto
    l'archivio di 24 ore.
    """
    variabile = read_variable(ds, "ocean_time")
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


def read_grid_coords(ds) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.asarray(read_variable(ds, "lon_rho")[:]),
        np.asarray(read_variable(ds, "lat_rho")[:]),
    )


def read_sea_mask(ds, nc_name: str) -> np.ndarray:
    """Maschera di mare dedotta dal primo istante di una variabile.

    ADRIAC non pubblica una maschera esplicita: le celle di terra arrivano
    mascherate dal _FillValue.
    """
    fetta = read_variable(ds, nc_name)[0]
    if fetta.ndim == 3:  # variabile 3D: si prende il livello di superficie
        fetta = fetta[-1]
    return ~np.ma.getmaskarray(fetta)


def frame_key(var: str, kind: str, reference_date: str, valid_time: datetime) -> str:
    """frames/{var}/{kind}/{ref}/{YYYY-MM-DDTHHMM}.bin

    I minuti stanno nella chiave per tutte le variabili, non solo per quelle
    che oggi hanno istanti sotto l'ora: una convenzione sola, senza rami. Il
    livello del mare in analisi arriva a passo di 10 minuti, e senza i minuti
    sei istanti collasserebbero sulla stessa chiave sovrascrivendosi, mentre
    l'indice (che registra al secondo) continuerebbe ad annunciarli tutti.
    """
    stampa = valid_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H%M")
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

    # Le unita' si verificano prima di scrivere qualunque cosa: un file con
    # le unita' cambiate non deve lasciare meta' archivio nuovo e meta'
    # vecchio.
    unita = {campo.id: check_units(ds, campo) for campo in campi}

    for indice_t in scelti:
        valido = istanti[indice_t]
        for campo in campi:
            grezzo = read_variable(ds, campo.nc_name)[indice_t]
            trasformato = encode.apply_transform(grezzo, campo.transform)
            ricampionato = grid.apply_index(trasformato, index)
            quantizzato, stats = encode.quantize(ricampionato, campo.scale, campo.offset)
            blob = encode.compress(quantizzato)
            record = FrameRecord(
                var=campo.id,
                valid_time=valido,
                path=frame_key(campo.id, kind, reference_date, valido),
                sha256=hashlib.sha256(blob).hexdigest(),
                source_units=unita[campo.id],
                scale=campo.scale,
                offset=campo.offset,
                min=stats["min"],
                max=stats["max"],
                nodata_count=stats["nodata_count"],
                clipped_count=stats["clipped_count"],
            )
            yield record, blob
