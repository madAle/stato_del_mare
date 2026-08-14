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
