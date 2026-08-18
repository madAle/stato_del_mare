"""La griglia di destinazione e l'impronta delle coordinate sorgente."""
import json

import numpy as np
import pytest

from ingest import grid, reconcile
from ingest.config import MAX_NEIGHBOUR_DISTANCE_M
from tests.conftest import ETA, XI, synthetic_coords, synthetic_sea_mask


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


def test_l_impronta_distingue_due_domini_con_gli_stessi_byte_e_forma_diversa():
    """La collisione realistica non e' "due domini identici per caso".

    E' un dominio rimodellato: gli stessi valori, letti in una forma diversa.
    I byte in ordine C coincidono, quindi senza la forma nell'impronta la
    guardia tace, l'indice in cache viene riusato su una griglia che non e'
    piu' la sua, e l'errore emerge come IndexError contato come ritentabile.
    """
    piatto_lon = np.linspace(10.0, 18.0, 24)
    piatto_lat = np.linspace(43.0, 45.0, 24)
    a_lon, a_lat = piatto_lon.reshape(6, 4), piatto_lat.reshape(6, 4)
    b_lon, b_lat = piatto_lon.reshape(4, 6), piatto_lat.reshape(4, 6)

    # La premessa del test: i byte sono davvero identici.
    assert (
        np.ascontiguousarray(a_lon).tobytes() == np.ascontiguousarray(b_lon).tobytes()
    )
    assert grid.coordinate_fingerprint(a_lon, a_lat) != grid.coordinate_fingerprint(
        b_lon, b_lat
    )


def test_il_dizionario_della_griglia_e_serializzabile():
    lon = np.array([[12.0, 12.5]])
    lat = np.array([[44.0, 44.2]])
    g = grid.build_grid(lon, lat, resolution=1000.0)
    d = grid.grid_to_dict(g)
    json.dumps(d)  # non deve sollevare
    assert d["crs"] == "EPSG:3857"
    assert d["width"] == g.width


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


def test_ogni_cella_di_mare_finisce_sul_pixel_che_le_sta_sopra():
    """Il valore giusto nel posto giusto, non solo da qualche parte.

    Che un valore compaia nel frame non dice niente su dove: e' proprio la
    classe di errore piu' insidiosa di questo modulo, perche' produce frame
    plausibili con i valori spostati. Qui la posizione attesa si calcola per
    conto proprio, dai centri dei pixel, senza passare da `idx.indices`: se
    l'indice invertisse, trasponesse o ruotasse la corrispondenza, il pixel
    sopra una cella porterebbe il valore di un'altra e il test fallirebbe.

    Il campo vale l'indice piatto della cella, quindi ogni cella ha un valore
    diverso da tutte le altre: con un campo costante l'asserzione reggerebbe
    comunque, che e' come questa classe di errore era gia' sfuggita una volta.
    """
    lon, lat, mare, g, idx = _indice_di_prova()
    valori = np.where(mare, np.arange(ETA * XI, dtype=np.float64).reshape(ETA, XI), np.nan)
    fuori = grid.apply_index(valori, idx).ravel()

    cx, cy = grid.grid_centres(g)
    verificate = 0
    for riga, colonna in zip(*np.nonzero(mare)):
        sx, sy = grid.lonlat_to_mercator(lon[riga, colonna], lat[riga, colonna])
        pixel = int(np.argmin((cx - float(sx)) ** 2 + (cy - float(sy)) ** 2))
        assert fuori[pixel] == valori[riga, colonna], (
            f"il pixel sopra la cella ({riga},{colonna}) porta {fuori[pixel]} "
            f"invece di {valori[riga, colonna]}"
        )
        verificate += 1

    # Senza questo, una maschera vuota renderebbe il test vacuo.
    assert verificate == int(np.count_nonzero(mare))


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


def test_apply_index_rifiuta_un_campo_di_forma_sbagliata():
    """Un campo di forma diversa dalla maschera va fermato come GridMismatch.

    Senza il controllo l'indicizzazione booleana solleva IndexError, che la
    clausola larga di reconcile conta come errore ritentabile: il run esce 1
    "riprova domani" per sempre invece di 2 "serve un umano".
    """
    _, _, _, _, idx = _indice_di_prova()
    trasposto = np.zeros((XI, ETA), dtype=np.float64)
    with pytest.raises(grid.GridMismatch):
        grid.apply_index(trasposto, idx)


def test_build_regrid_index_rifiuta_forme_incoerenti():
    lon, lat = synthetic_coords()
    g = grid.build_grid(lon, lat, resolution=400.0)
    maschera_storta = np.ones((XI, ETA), dtype=bool)
    with pytest.raises(grid.GridMismatch):
        grid.build_regrid_index(lon, lat, maschera_storta, g)


def test_e_lo_stesso_guasto_che_reconcile_rilancia():
    """La classe deve essere quella che reconcile fa uscire dal run.

    Se fossero due eccezioni diverse, la guardia sulle forme finirebbe nella
    clausola larga e il run uscirebbe 1 invece di 2.
    """
    assert grid.GridMismatch is reconcile.GridMismatch


def test_l_indice_si_salva_e_si_rilegge(tmp_path):
    _, _, _, _, idx = _indice_di_prova()
    percorso = tmp_path / "idx.npz"
    grid.save_index(idx, percorso)
    riletto = grid.load_index(percorso)
    assert np.array_equal(riletto.indices, idx.indices)
    assert np.array_equal(riletto.sea_mask, idx.sea_mask)
    assert riletto.fingerprint == idx.fingerprint
    assert riletto.grid == idx.grid


def test_il_ricampionamento_resta_legato_alla_sua_soglia():
    """Il confine dei pixel riempiti e' esattamente MAX_NEIGHBOUR_DISTANCE_M.

    La soglia delle stazioni e' piu' larga di proposito, perche' risponde a
    un'altra domanda: qui invece 800 m e' cio' che impedisce al colore di
    sbordare sulla terraferma per piu' di una cella sorgente. Se qualcuno
    riunisse le due costanti, i pixel fra 800 e 1000 m si riempirebbero e
    questo test lo direbbe.
    """
    # Una sola cella di mare al centro, le altre otto di terra a 900 m.
    passo = 900.0
    x0, y0 = grid.lonlat_to_mercator(np.array(12.0), np.array(44.0))
    fattore = np.cos(np.radians(44.0))
    scarti = np.array([-passo, 0.0, passo]) / fattore
    xs = float(x0) + scarti
    ys = float(y0) + scarti
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    lon, lat = grid.mercator_to_lonlat(gx, gy)
    mare = np.zeros((3, 3), dtype=bool)
    mare[1, 1] = True

    g = grid.build_grid(lon, lat, resolution=100.0)
    idx = grid.build_regrid_index(lon, lat, mare, g)

    cx, cy = grid.grid_centres(g)
    _, lat_dest = grid.mercator_to_lonlat(cx, cy)
    al_suolo = np.hypot(cx - float(x0), cy - float(y0)) * np.cos(np.radians(lat_dest))

    riempito = idx.indices >= 0
    assert np.array_equal(riempito, al_suolo <= MAX_NEIGHBOUR_DISTANCE_M)
    # Senza queste due, un indice tutto vuoto o tutto pieno passerebbe.
    assert riempito.any() and not riempito.all()
