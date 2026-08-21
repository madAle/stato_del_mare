import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Variabile } from "../../src/data/catalogo";
import type { Ora } from "../../src/data/indice";
import { Legend } from "../../src/ui/Legend";
import { LayerSwitcher } from "../../src/ui/LayerSwitcher";
import { StatusBar } from "../../src/ui/StatusBar";

const an: Ora = { istante: Date.parse("2026-08-15T11:00:00Z"), tipo: "an", riferimento: "20260815" };
const fc: Ora = { istante: Date.parse("2026-08-15T18:00:00Z"), tipo: "fc", riferimento: "20260815" };

describe("StatusBar", () => {
  it("dice sempre da dove viene il frame a schermo", () => {
    render(<StatusBar istante={an.istante} ora={an} oraDopo={null} valore={1.23} unita="m" variabile="hwave" stato="ferma" />);
    expect(screen.getByText(/analisi/)).toBeDefined();
  });

  it("sulla previsione dichiara la scadenza", () => {
    // senza questa riga la mappa mente per omissione: analisi e previsione sono
    // due cose scientificamente diverse e a colpo d'occhio identiche
    render(<StatusBar istante={fc.istante} ora={fc} oraDopo={null} valore={null} unita="m" variabile="hwave" stato="ferma" />);
    expect(screen.getByText(/previsione \+18h/)).toBeDefined();
  });

  it("senza valore sotto il mouse non stampa uno zero", () => {
    render(<StatusBar istante={an.istante} ora={an} oraDopo={null} valore={null} unita="m" variabile="hwave" stato="ferma" />);
    expect(screen.queryByText(/0,00 m/)).toBeNull();
  });

  it("mostra l'attesa quando il buffer e' vuoto", () => {
    render(<StatusBar istante={an.istante} ora={an} oraDopo={null} valore={null} unita="m" variabile="hwave" stato="in attesa di dati" />);
    expect(screen.getByText(/in attesa di dati/)).toBeDefined();
  });
});

describe("Legend", () => {
  it("mostra i due fondoscala con l'unita'", () => {
    render(<Legend palette="amp" minimo={0} massimo={4} unita="m" />);
    expect(screen.getByText("0 m")).toBeDefined();
    expect(screen.getByText("4 m")).toBeDefined();
  });

  it("su una grandezza con segno scrive anche il fondo negativo", () => {
    // Il livello del mare va sotto lo zero: una legenda che parte da zero
    // direbbe che meta' del fenomeno non esiste.
    render(<Legend palette="balance" minimo={-0.8} massimo={0.8} unita="m" />);
    expect(screen.getByText("-0,8 m")).toBeDefined();
    expect(screen.getByText("0,8 m")).toBeDefined();
  });
});

describe("LayerSwitcher", () => {
  const variabili: Variabile[] = [
    {
      id: "hwave", unita: "m", scala: 0.001, offset: 0, colormap: "amp",
      tipi: { an: { mesi: [] }, fc: { mesi: [] } },
    },
    {
      id: "sealevel", unita: "m", scala: 0.001, offset: 0, colormap: "balance",
      tipi: { an: { mesi: [] }, fc: { mesi: [] } },
    },
  ];

  it("lascia selezionabile solo la variabile che la mappa disegna davvero", () => {
    render(<LayerSwitcher variabili={variabili} scelta="hwave" cambia={() => {}} />);
    const onda = screen.getByRole("option", { name: "altezza d'onda" }) as HTMLOptionElement;
    const livello = screen.getByRole("option", { name: "livello del mare" }) as HTMLOptionElement;
    expect(onda.disabled).toBe(false);
    expect(livello.disabled).toBe(false);
  });

  it("spiega perche' le altre variabili sono disabilitate", () => {
    // senza una spiegazione visibile, un comando disabilitato sembra un guasto
    const conDirezione: Variabile[] = [
      ...variabili,
      { id: "dwave_sin", unita: "1", scala: 1e-4, offset: 0, colormap: "phase", tipi: { an: { mesi: [] }, fc: { mesi: [] } } },
      { id: "dwave_cos", unita: "1", scala: 1e-4, offset: 0, colormap: "phase", tipi: { an: { mesi: [] }, fc: { mesi: [] } } },
    ];
    render(<LayerSwitcher variabili={conDirezione} scelta="hwave" cambia={() => {}} />);
    const direzione = screen.getByRole("option", { name: "direzione dell'onda" }) as HTMLOptionElement;
    expect(direzione.disabled).toBe(true);
    expect(direzione.title).toMatch(/frecce/);
  });

  it("scrive nomi leggibili, non gli identificatori dell'archivio", () => {
    // "hwave" in un menu di un sito pubblico non vuol dire niente a nessuno, e
    // "dwave_sin" e' peggio: e' il seno di un angolo, cioe' come il dato e'
    // conservato, non una grandezza che qualcuno voglia guardare.
    const conComponenti: Variabile[] = [
      ...variabili,
      { id: "dwave_sin", unita: "1", scala: 1e-4, offset: 0, colormap: "phase", tipi: { an: { mesi: [] }, fc: { mesi: [] } } },
      { id: "dwave_cos", unita: "1", scala: 1e-4, offset: 0, colormap: "phase", tipi: { an: { mesi: [] }, fc: { mesi: [] } } },
    ];
    render(<LayerSwitcher variabili={conComponenti} scelta="hwave" cambia={() => {}} />);
    expect(screen.queryByRole("option", { name: "hwave" })).toBeNull();
    expect(screen.queryByRole("option", { name: /dwave/ })).toBeNull();
    // e le due componenti sono una voce sola
    expect(screen.getAllByRole("option", { name: "direzione dell'onda" })).toHaveLength(1);
  });
});

describe("l'orologio non promette minuti che il modello non ha", () => {
  // Le ore dell'asse sono UTC, che e' come il dato arriva; a schermo si leggono
  // nell'ora dell'Adriatico, quindi le 09:00 di ocean_time si scrivono 11:00.
  const nove: Ora = { istante: Date.UTC(2026, 7, 19, 9), tipo: "an", riferimento: "20260819" };
  const dieci: Ora = { istante: Date.UTC(2026, 7, 19, 10), tipo: "an", riferimento: "20260819" };

  it("su un'ora esatta mostra quell'ora e basta", () => {
    render(<StatusBar istante={nove.istante} ora={nove} oraDopo={dieci}
      valore={1.2} unita="m" variabile="hwave" stato="ferma" />);
    expect(screen.getByText(/11:00 CEST/)).toBeDefined();
    expect(screen.queryByText(/->/)).toBeNull();
  });

  it("fra due ore mostra la coppia, non un istante al minuto", () => {
    // il dato e' orario: le 11:37 non esistono, quello che si vede e' una
    // dissolvenza fra le 11:00 e le 12:00
    render(<StatusBar istante={nove.istante + 37 * 60_000} ora={nove} oraDopo={dieci}
      valore={1.2} unita="m" variabile="hwave" stato="in riproduzione" />);
    expect(screen.queryByText(/11:37/)).toBeNull();
    expect(screen.getByText(/11:00/)).toBeDefined();
    expect(screen.getByText(/12:00/)).toBeDefined();
  });

  it("senza l'ora dopo (fine dell'asse o buco) non inventa una coppia", () => {
    render(<StatusBar istante={nove.istante + 37 * 60_000} ora={nove} oraDopo={null}
      valore={null} unita="m" variabile="hwave" stato="in riproduzione" />);
    expect(screen.getByText(/11:00 CEST/)).toBeDefined();
    expect(screen.queryByText(/12:00/)).toBeNull();
  });
});
