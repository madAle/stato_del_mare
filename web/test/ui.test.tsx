import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Ora } from "../src/data/indice";
import { Legend } from "../src/ui/Legend";
import { StatusBar } from "../src/ui/StatusBar";

const an: Ora = { istante: Date.parse("2026-08-15T11:00:00Z"), tipo: "an", riferimento: "20260815" };
const fc: Ora = { istante: Date.parse("2026-08-15T18:00:00Z"), tipo: "fc", riferimento: "20260815" };

describe("StatusBar", () => {
  it("dice sempre da dove viene il frame a schermo", () => {
    render(<StatusBar ora={an} valore={1.23} unita="m" stato="ferma" />);
    expect(screen.getByText(/analisi/)).toBeDefined();
  });

  it("sulla previsione dichiara la scadenza", () => {
    // senza questa riga la mappa mente per omissione: analisi e previsione sono
    // due cose scientificamente diverse e a colpo d'occhio identiche
    render(<StatusBar ora={fc} valore={null} unita="m" stato="ferma" />);
    expect(screen.getByText(/previsione \+18h/)).toBeDefined();
  });

  it("senza valore sotto il mouse non stampa uno zero", () => {
    render(<StatusBar ora={an} valore={null} unita="m" stato="ferma" />);
    expect(screen.queryByText(/0,00 m/)).toBeNull();
  });

  it("mostra l'attesa quando il buffer e' vuoto", () => {
    render(<StatusBar ora={an} valore={null} unita="m" stato="in attesa di dati" />);
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
