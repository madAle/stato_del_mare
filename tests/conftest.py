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


def write_2dcur_file(path, n_times: int = NT):
    """File 2D delle correnti integrate, gia' proiettate su est e nord."""
    ds = Dataset(str(path), "w", format="NETCDF3_CLASSIC")
    try:
        ds.createDimension("ocean_time", n_times)
        _write_coords(ds)
        t = ds.createVariable("ocean_time", "f8", ("ocean_time",))
        t.units = TIME_UNITS
        t[:] = _times(n_times)

        base = np.arange(ETA * XI, dtype=np.float64).reshape(ETA, XI) / 1000.0
        campo = np.stack([base + k / 10.0 for k in range(n_times)])
        for nome in ("ubar_eastward", "vbar_northward"):
            v = ds.createVariable(
                nome, "f4", ("ocean_time", "eta_rho", "xi_rho"), fill_value=1.0e37
            )
            v.units = "meter second-1"
            v[:] = _masked(campo)
    finally:
        ds.close()
    return path


def write_sealevel_file(path, n_times: int = 6, step_minutes: int = 10):
    """File del livello del mare a passo sotto l'ora, come qck_sl.

    ADRIAC pubblica 144 step da 10 minuti in analisi: qui ne bastano sei per
    coprire un'ora intera, che e' il caso in cui una chiave troncata all'ora
    fa collassare piu' istanti sullo stesso oggetto.
    """
    ds = Dataset(str(path), "w", format="NETCDF3_CLASSIC")
    try:
        ds.createDimension("ocean_time", n_times)
        _write_coords(ds)
        t = ds.createVariable("ocean_time", "f8", ("ocean_time",))
        t.units = TIME_UNITS
        t[:] = np.array(
            [
                (
                    FIRST_TIME + timedelta(minutes=step_minutes * k) - _EPOCH
                ).total_seconds()
                for k in range(n_times)
            ],
            dtype=np.float64,
        )

        base = np.arange(ETA * XI, dtype=np.float64).reshape(ETA, XI) / 100.0
        campo = np.stack([base + k for k in range(n_times)])
        sl = ds.createVariable(
            "sea_level", "f8", ("ocean_time", "eta_rho", "xi_rho"), fill_value=1.0e37
        )
        sl.units = "meter"
        sl[:] = _masked(campo)
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
        # Il campo varia anche nello spazio, non solo in tempo e livello.
        # Senza questa variazione un test sui valori estratti passerebbe anche
        # se la colonna venisse presa dalla cella sbagliata, che e' proprio
        # l'errore piu' insidioso di questo modulo.
        per_cella = np.arange(ETA * XI, dtype=np.float64).reshape(ETA, XI) / 100.0
        # Ogni variabile parte da un centinaio diverso, in base alla sua
        # posizione in var_names. Senza, due variabili dello stesso file
        # avrebbero contenuto identico e uno scambio del loro ordine dentro la
        # colonna estratta passerebbe inosservato, che e' proprio cio' che il
        # manifest deve poter dichiarare senza mentire.
        for indice_variabile, nome in enumerate(var_names):
            v = ds.createVariable(
                nome,
                "f4",
                ("ocean_time", "s_rho", "eta_rho", "xi_rho"),
                fill_value=1.0e37,
            )
            dati = np.zeros((n_times, NS, ETA, XI), dtype=np.float64)
            for k in range(n_times):
                for livello in range(NS):
                    dati[k, livello] = (
                        indice_variabile * 100.0 + livello + k * 10.0 + per_cella
                    )
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


@pytest.fixture
def sealevel_file(tmp_path):
    return write_sealevel_file(tmp_path / "sealevel.nc")
