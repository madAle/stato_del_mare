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
