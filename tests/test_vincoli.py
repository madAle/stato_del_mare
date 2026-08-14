"""Vincoli di struttura che nessun altro cancello verifica.

Tre volte in questo progetto un vincolo dichiarato ovunque non era verificato
da niente, e tre volte e' stato riportato come rispettato mentre non lo era:
gli import in testa (ruff non guarda dentro le funzioni), l'output senza
avvisi (nessuno lo controllava), il test che verificava la cella giusta (la
fixture rendeva impossibile accorgersene). Ogni volta la correzione utile non
e' stata sistemare il caso singolo ma rendere la proprieta' verificabile.

Questo file e' quel cancello per le letture della sorgente.
"""
import ast
from pathlib import Path

PACCHETTO = Path(__file__).resolve().parent.parent / "ingest"

# L'unico punto del pacchetto autorizzato a leggere ds.variables[...] per
# indice. Chiunque altro deve passare da frames.read_variable, che traduce il
# nome assente in VariableMissing e quindi in uscita 2.
AUTORIZZATO = {("frames.py", "read_variable")}


def _letture_diritte(sorgente: str) -> set[tuple[int, str]]:
    """Righe che leggono `qualcosa.variables[...]`, con la funzione che le contiene.

    Si usa l'albero sintattico e non una ricerca testuale perche' i commenti
    che nominano la forma vietata per spiegarla non sono violazioni, e una
    grep li conterebbe.
    """
    albero = ast.parse(sorgente)
    contenitore: dict[int, str] = {}
    for nodo in ast.walk(albero):
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for interno in ast.walk(nodo):
                riga = getattr(interno, "lineno", None)
                if riga is not None:
                    contenitore.setdefault(riga, nodo.name)

    trovate = set()
    for nodo in ast.walk(albero):
        if not isinstance(nodo, ast.Subscript):
            continue
        base = nodo.value
        if isinstance(base, ast.Attribute) and base.attr == "variables":
            trovate.add((nodo.lineno, contenitore.get(nodo.lineno, "<modulo>")))
    return trovate


def test_la_sorgente_si_legge_solo_attraverso_read_variable():
    """Un nome di variabile assente deve sempre diventare uscita 2, mai 1.

    La spec 6.1 promette che un rename alla sorgente fermi il run chiedendo un
    umano. Una lettura diritta lo fa emergere come KeyError, che la clausola
    larga di reconcile conta come fallimento passeggero: il cron ritenterebbe
    per sempre mentre la finestra di 8 giorni scorre via.

    Lo stesso difetto e' gia' stato corretto due volte, sui campi 2D e poi
    sulle colonne dei profili. Senza questo test la terza volta e' questione
    di tempo: si aggiunge una lettura, la suite resta verde, e il buco torna.
    """
    violazioni = []
    for modulo in sorted(PACCHETTO.glob("*.py")):
        for riga, funzione in sorted(_letture_diritte(modulo.read_text())):
            if (modulo.name, funzione) not in AUTORIZZATO:
                violazioni.append(f"{modulo.name}:{riga} dentro {funzione}()")

    assert not violazioni, (
        "lettura diretta di ds.variables[...] fuori da frames.read_variable: "
        + ", ".join(violazioni)
        + ". Usare read_variable, oppure, se la lettura e' davvero un caso a "
        "parte, aggiungerla ad AUTORIZZATO scrivendo il motivo."
    )


def test_il_vincolo_riguarda_qualcosa():
    """Il cancello e' inutile se il codice autorizzato non esiste piu'.

    Senza questa asserzione, rinominare read_variable renderebbe verde il test
    precedente per la ragione sbagliata, cioe' perche' non c'e' piu' niente da
    controllare.
    """
    sorgente = (PACCHETTO / "frames.py").read_text()
    letture = _letture_diritte(sorgente)
    assert ("read_variable" in {f for _, f in letture}), (
        "frames.read_variable non contiene piu' una lettura di ds.variables[...]: "
        "o e' stata rinominata, o la guardia e' stata smontata."
    )
