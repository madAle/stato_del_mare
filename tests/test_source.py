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
    """Il 24 agosto 2026 due run sono morti in venti secondi su un 403
    passeggero dell'indice ARPAE, mentre il run un'ora dopo chiudeva con
    zero errori. L'indice era l'unica delle tre chiamate di rete di questo
    modulo senza tentativi, ed e' quella da cui dipendono le altre due: se
    cade lei il run non comincia nemmeno."""
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    responses.add(responses.GET, "https://esempio/adriac/", status=403)
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    file = source.list_source_files("https://esempio/adriac/")
    assert len(file) == 4


@responses.activate
def test_il_rifiuto_finisce_nel_log_con_corpo_e_intestazioni(monkeypatch, caplog):
    """Perche' ARPAE ci rifiuti non lo sappiamo, e cosi' non lo sapremo mai.

    raise_for_status alza e butta via la risposta. Il corpo di un 403 dice se
    e' un filtro anti bot, un limitatore di frequenza o un deny secco, e sono
    tre cose con tre rimedi diversi: senza, al prossimo rifiuto si indovina.
    """
    monkeypatch.setattr(source.time, "sleep", lambda _: None)
    responses.add(
        responses.GET,
        "https://esempio/adriac/",
        status=403,
        body="<html><body>Bot detected: request blocked</body></html>",
        headers={"Retry-After": "120", "Server": "nginx"},
    )
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    with caplog.at_level(logging.WARNING):
        source.list_source_files("https://esempio/adriac/")
    assert "403" in caplog.text
    assert "120" in caplog.text
    assert "Bot detected" in caplog.text


@responses.activate
def test_l_elenco_sopravvive_a_un_blocco_di_oltre_un_minuto(monkeypatch):
    """Il 25 agosto 2026 i tre tentativi si sono esauriti tutti in 16 secondi.

    Il log del run lo dice riga per riga: 403, attesa 5, 403, attesa 10, 403,
    resa. Il blocco durava di piu' di cosi'. Cinque tentativi coprono 75
    secondi, e se non bastano il run successivo recupera come ha sempre fatto.
    """
    attese = []
    monkeypatch.setattr(source.time, "sleep", attese.append)
    for _ in range(4):
        responses.add(responses.GET, "https://esempio/adriac/", status=403)
    responses.add(responses.GET, "https://esempio/adriac/", body=INDICE_HTML)
    file = source.list_source_files("https://esempio/adriac/")
    assert len(file) == 4
    assert attese == [5, 10, 20, 40]
