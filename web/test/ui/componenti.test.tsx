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
  it("mostra il fondoscala con l'unita' del catalogo", () => {
    render(<Legend palette="amp" massimo={4} unita="m" />);
    expect(screen.getByText("0 m")).toBeDefined();
    expect(screen.getByText("4 m")).toBeDefined();
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
    const hwave = screen.getByRole("option", { name: "hwave" }) as HTMLOptionElement;
    const sealevel = screen.getByRole("option", { name: "sealevel" }) as HTMLOptionElement;
    expect(hwave.disabled).toBe(false);
    expect(sealevel.disabled).toBe(true);
  });

  it("spiega perche' le altre variabili sono disabilitate", () => {
    // senza una spiegazione visibile, un comando disabilitato sembra un guasto
    render(<LayerSwitcher variabili={variabili} scelta="hwave" cambia={() => {}} />);
    const sealevel = screen.getByRole("option", { name: "sealevel" }) as HTMLOptionElement;
    expect(sealevel.title).toMatch(/altezza d'onda/);
  });
});

describe("l'orologio non promette minuti che il modello non ha", () => {
  const nove: Ora = { istante: Date.UTC(2026, 7, 19, 9), tipo: "an", riferimento: "20260819" };
  const dieci: Ora = { istante: Date.UTC(2026, 7, 19, 10), tipo: "an", riferimento: "20260819" };

  it("su un'ora esatta mostra quell'ora e basta", () => {
    render(<StatusBar istante={nove.istante} ora={nove} oraDopo={dieci}
      valore={1.2} unita="m" variabile="hwave" stato="ferma" />);
    expect(screen.getByText(/09:00 UTC/)).toBeDefined();
    expect(screen.queryByText(/->/)).toBeNull();
  });

  it("fra due ore mostra la coppia, non un istante al minuto", () => {
    // il dato e' orario: le 09:37 non esistono, quello che si vede e' una
    // dissolvenza fra le 09:00 e le 10:00
    render(<StatusBar istante={nove.istante + 37 * 60_000} ora={nove} oraDopo={dieci}
      valore={1.2} unita="m" variabile="hwave" stato="in riproduzione" />);
    expect(screen.queryByText(/09:37/)).toBeNull();
    expect(screen.getByText(/09:00/)).toBeDefined();
    expect(screen.getByText(/10:00/)).toBeDefined();
  });

  it("senza l'ora dopo (fine dell'asse o buco) non inventa una coppia", () => {
    render(<StatusBar istante={nove.istante + 37 * 60_000} ora={nove} oraDopo={null}
      valore={null} unita="m" variabile="hwave" stato="in riproduzione" />);
    expect(screen.getByText(/09:00 UTC/)).toBeDefined();
    expect(screen.queryByText(/10:00/)).toBeNull();
  });
});
