"""Elenco e scaricamento dei file ARPAE."""
import hashlib
import logging

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


@responses.activate
def test_l_elenco_riprova_dopo_un_errore_temporaneo(monkeypatch):
    """L'indice e' la chiamata da cui dipendono le altre due: se cade lei il
    run non comincia nemmeno. Un 503 passeggero non deve bastare a fermarlo.

    Questo test nacque il 24 agosto 2026 con un 403, che allora sembrava
    passeggero. Non lo era: vedi `test_un_403_non_si_ritenta`."""
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    responses.add(responses.GET, "https://esempio/adriac/", status=503)
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    file = source.list_source_files("https://esempio/adriac/")
    assert len(file) == 4


@responses.activate
def test_un_403_non_si_ritenta(monkeypatch):
    """ARPAE respinge interi blocchi di indirizzi, e un 403 non passa aspettando.

    Misurato dal 27 agosto al 5 ottobre 2026 su 146 run con l'IP registrato:
    i 6 rifiutati uscivano tutti da 128.24.0.0/16 o 134.33.0.0/16, i 140
    ammessi nessuno. E nessun run ha mai superato un 403 ritentando: chi lo
    prendeva lo prendeva 5 volte su 5, e i tentativi costavano 75 secondi per
    niente. Il rimedio e' un'altra macchina, non un'altra attesa.
    """
    attese = []
    monkeypatch.setattr(source.time, "sleep", attese.append)
    responses.add(responses.GET, "https://esempio/adriac/", status=403)
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    with pytest.raises(source.SorgenteRifiuta):
        source.list_source_files("https://esempio/adriac/")
    assert len(responses.calls) == 1
    assert attese == []


@responses.activate
def test_anche_una_head_rifiutata_non_si_ritenta(monkeypatch):
    """Il rifiuto e' per indirizzo, non per file: vale per ogni chiamata."""
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    responses.add(responses.HEAD, "https://esempio/f.nc.gz", status=403)
    with pytest.raises(source.SorgenteRifiuta):
        source.head("https://esempio/f.nc.gz")
    assert len(responses.calls) == 1


@responses.activate
def test_un_404_non_si_ritenta(monkeypatch):
    """Un file che non c'e' non compare aspettando.

    Il 5 ottobre 2026 l'indice ARPAE elencava ancora il giorno uscito dalla
    finestra mentre i file erano gia' cancellati: nove HEAD, cinque tentativi
    ciascuna, dodici minuti di attese su risposte che non potevano cambiare.
    """
    attese = []
    monkeypatch.setattr(source.time, "sleep", attese.append)
    responses.add(responses.HEAD, "https://esempio/f.nc.gz", status=404)
    with pytest.raises(source.FileSparito):
        source.head("https://esempio/f.nc.gz")
    assert len(responses.calls) == 1
    assert attese == []


@responses.activate
def test_il_rifiuto_finisce_nel_log_con_corpo_e_intestazioni(monkeypatch, caplog):
    """raise_for_status alza e butta via la risposta.

    Il corpo di un 403 dice se e' un filtro anti bot, un limitatore di
    frequenza o un deny secco, e sono tre cose con tre rimedi diversi. E' cosi'
    che si e' stabilito che il rifiuto di ARPAE e' un deny secco di nginx: se
    un giorno cambiasse natura, deve essere questa riga a dirlo.
    """
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    responses.add(
        responses.GET,
        "https://esempio/adriac/",
        status=403,
        body="<html><body>Bot detected: request blocked</body></html>",
        headers={"Retry-After": "120", "Server": "nginx"},
    )
    with caplog.at_level(logging.WARNING), pytest.raises(source.SorgenteRifiuta):
        source.list_source_files("https://esempio/adriac/")
    assert "403" in caplog.text
    assert "120" in caplog.text
    assert "Bot detected" in caplog.text


@responses.activate
def test_l_elenco_sopravvive_a_un_guasto_di_oltre_un_minuto(monkeypatch):
    """Cinque tentativi con attesa crescente coprono 75 secondi.

    La scala nacque il 25 agosto 2026 per un 403, che poi si e' rivelato un
    bando per indirizzo e non passa aspettando. Resta per i guasti che passano
    davvero, come un 503 o una connessione caduta a meta' di 2 GB.
    """
    attese = []
    monkeypatch.setattr(source.time, "sleep", attese.append)
    for _ in range(4):
        responses.add(responses.GET, "https://esempio/adriac/", status=503)
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    file = source.list_source_files("https://esempio/adriac/")
    assert len(file) == 4
    assert attese == [5, 10, 20, 40]
