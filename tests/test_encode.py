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
