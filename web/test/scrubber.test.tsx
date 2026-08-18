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

  it("un asse tutto di analisi non ha confine", () => {
    const asse = [ora(0, "an"), ora(1, "an")];
    render(<TimelineScrubber asse={asse} istante={asse[0].istante} cambia={vi.fn()} />);
    expect(screen.queryByTestId("confine")).toBeNull();
  });
});
