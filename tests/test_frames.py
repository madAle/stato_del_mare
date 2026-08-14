"""Estrazione dei frame 2D da un NetCDF."""
from datetime import datetime, timezone

import numpy as np
import pytest
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
        == "frames/hwave/an/20260813/2026-08-12T0100.bin"
    )


def test_ogni_istante_sotto_l_ora_ha_una_chiave_propria(sealevel_file):
    """Il livello del mare in analisi e' a 10 minuti: sei istanti per ora.

    Con una chiave troncata all'ora i sei si sovrascriverebbero a vicenda e
    sopravviverebbe l'ultimo scritto, mentre l'indice (che registra al
    secondo) continuerebbe ad annunciarli tutti e sei. Un client che chiede
    le 01:00 riceverebbe il campo delle 01:50 senza modo di accorgersene.

    Il test non si limita a contare le chiavi distinte: rilegge l'istante
    dal percorso e lo confronta con il valid_time del record, cosi' fallisce
    anche una chiave distinta ma che mente sull'orario (per esempio un
    contatore progressivo).
    """
    idx = _indice()
    with Dataset(str(sealevel_file)) as ds:
        prodotti = list(frames.extract_frames(ds, "qck_sl", "an", "20260813", idx))

    assert len(prodotti) == 6
    percorsi = [record.path for record, _ in prodotti]
    assert len(set(percorsi)) == 6

    for record, _ in prodotti:
        stampa = record.path.rsplit("/", 1)[-1].removesuffix(".bin")
        letto = datetime.strptime(stampa, "%Y-%m-%dT%H%M").replace(tzinfo=timezone.utc)
        assert letto == record.valid_time


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


def test_le_unita_sorgente_finiscono_nel_record(wave_file):
    """Il manifest deve registrare l'unita' letta dal NetCDF, non quella
    che il codice si aspetta: e' l'unica prova, a distanza di anni, di cosa
    diceva davvero il file da cui il frame e' stato prodotto."""
    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        per_variabile = {
            r.var: r for r, _ in frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx)
        }
    assert per_variabile["hwave"].source_units == "meter"
    assert per_variabile["pwave"].source_units == "second"
    # Le due componenti nascono dalla stessa variabile in gradi.
    assert per_variabile["dwave_sin"].source_units == "degrees"


def test_un_cambio_di_unita_alla_sorgente_ferma_l_estrazione(wave_file):
    """Un cambio di unita' a monte e' completamente silenzioso senza guardia.

    I valori si riquantizzano bene, `clipped_count` puo' restare zero, e
    l'archivio si riempie di numeri plausibili e sbagliati. E' lo stesso
    modello di danno che giustifica l'apparato di GridMismatch, applicato
    all'altra meta' della stessa frase della spec 6.1.
    """
    with Dataset(str(wave_file), "a") as ds:
        ds.variables["Hwave"].units = "centimeter"

    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        with pytest.raises(frames.UnitMismatch) as errore:
            list(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))
    assert "centimeter" in str(errore.value)
    assert "meter" in str(errore.value)


def test_l_assenza_dell_attributo_unita_ferma_l_estrazione(wave_file):
    """Senza `units` non si puo' verificare niente: meglio fermarsi."""
    with Dataset(str(wave_file), "a") as ds:
        ds.variables["Hwave"].delncattr("units")

    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        with pytest.raises(frames.UnitMismatch):
            list(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))


def test_una_variabile_rinominata_ferma_l_estrazione(wave_file):
    """A regime, con l'indice gia' in archivio, il rename emerge da qui.

    E' l'altra meta' della stessa frase della spec 6.1: un nome cambiato non
    e' un file storto da saltare e riprovare domani, e' la sorgente che ha
    cambiato contratto.
    """
    with Dataset(str(wave_file), "a") as ds:
        ds.renameVariable("Hwave", "Hwave_v2")

    idx = _indice()
    with Dataset(str(wave_file)) as ds:
        with pytest.raises(frames.VariableMissing) as errore:
            list(frames.extract_frames(ds, "his_HPDwave", "an", "20260813", idx))
    assert "Hwave" in str(errore.value)


def test_la_maschera_di_mare_si_legge_dai_dati(wave_file):
    with Dataset(str(wave_file)) as ds:
        mare = frames.read_sea_mask(ds, "Hwave")
    assert np.array_equal(mare, synthetic_sea_mask())
