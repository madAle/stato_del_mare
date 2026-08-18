import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Ora } from "../src/data/indice";
import { TimelineScrubber } from "../src/ui/TimelineScrubber";

const ora = (h: number, tipo: "an" | "fc"): Ora => ({
  istante: Date.UTC(2026, 7, 15, h), tipo, riferimento: "20260815",
});

describe("scrubber", () => {
  it("disegna un segno per ogni buco invece di scavalcarlo", () => {
    const asse = [ora(0, "an"), ora(1, "an"), ora(6, "an"), ora(7, "an")];
    render(<TimelineScrubber asse={asse} istante={asse[0].istante} cambia={vi.fn()} />);
    expect(screen.getAllByTestId("buco")).toHaveLength(1);
  });

  it("marca il confine fra analisi e previsione", () => {
    const asse = [ora(0, "an"), ora(1, "an"), ora(2, "fc"), ora(3, "fc")];
    render(<TimelineScrubber asse={asse} istante={asse[0].istante} cambia={vi.fn()} />);
    const confine = screen.getByTestId("confine");
    // il confine sta al terzo elemento su quattro, cioe' al 66 per cento
    expect(confine.getAttribute("data-frazione")).toBe("0.6666666666666666");
  });

  it("un buco di analisi riempito da una previsione non sposta il confine indietro", () => {
    // Lo scenario per cui buchi() esiste: un'ora di analisi manca nel
    // passato (le 02:00) ed e' coperta da una previsione piu' vecchia,
    // mentre l'analisi vera riprende alle 03:00 e alle 04:00. Il primo "fc"
    // dell'asse sta alle 02:00, molto prima dell'ultima analisi vera: se il
    // confine si prendesse dal primo "fc" (asse.findIndex), cadrebbe li' e
    // le ore 03:00/04:00, che sono analisi, verrebbero mostrate come zona
    // di previsione.
    const asse = [
      ora(0, "an"), ora(1, "an"),
      ora(2, "fc"), // buco di analisi riempito da una previsione
      ora(3, "an"), ora(4, "an"),
      ora(5, "fc"), ora(6, "fc"),
    ];
    render(<TimelineScrubber asse={asse} istante={asse[0].istante} cambia={vi.fn()} />);
    const confine = screen.getByTestId("confine");
    // Il confine vero e' subito dopo l'ultima analisi (indice 4 delle 04:00),
    // cioe' all'indice 5 su 6, non all'indice 2 del primo "fc".
    expect(confine.getAttribute("data-frazione")).toBe(String(5 / 6));
  });

  it("un asse tutto di analisi non ha confine", () => {
    const asse = [ora(0, "an"), ora(1, "an")];
    render(<TimelineScrubber asse={asse} istante={asse[0].istante} cambia={vi.fn()} />);
    expect(screen.queryByTestId("confine")).toBeNull();
  });

  it("durante la riproduzione l'istante non coincide con nessuna ora esatta, e l'orologio segue comunque per prossimita'", () => {
    // Come avanza() in animazione.ts: l'istante cresce con continuita' in
    // millisecondi, quindi quasi mai coincide con una delle ore dell'asse.
    // Un confronto di uguaglianza stretta ricadrebbe sempre sull'indice 0
    // (le 00:00): qui l'ora giusta e' le 02:00, terza dell'asse, apposta per
    // distinguere il comportamento corretto dal fallback silenzioso.
    const asse = [ora(0, "an"), ora(1, "an"), ora(2, "an"), ora(3, "an")];
    const aMeta = asse[2].istante + 30 * 60_000; // mezz'ora dopo le 02:00
    render(<TimelineScrubber asse={asse} istante={aMeta} cambia={vi.fn()} />);
    expect(screen.getByTestId("orologio").textContent).toMatch(/02:00/);
  });
});
