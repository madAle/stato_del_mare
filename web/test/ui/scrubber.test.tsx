import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Ora } from "../../src/data/indice";
import { TimelineScrubber } from "../../src/ui/TimelineScrubber";

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
    // (le 00:00 UTC): qui l'ora giusta e' la terza dell'asse, apposta per
    // distinguere il comportamento corretto dal fallback silenzioso. A schermo
    // si legge 04:00, perche' le ore dell'asse sono UTC e l'orologio scrive
    // nell'ora dell'Adriatico.
    const asse = [ora(0, "an"), ora(1, "an"), ora(2, "an"), ora(3, "an")];
    const aMeta = asse[2].istante + 30 * 60_000; // mezz'ora dopo la terza ora
    render(<TimelineScrubber asse={asse} istante={aMeta} cambia={vi.fn()} />);
    expect(screen.getByTestId("orologio").textContent).toMatch(/04:00/);
  });

  it("un istante fuori dall'asse dice 'nessun dato', come la barra di stato", () => {
    // App.tsx calcola l'ora per la barra di stato con la stessa inquadra():
    // fuori dall'asse restituisce null, e la barra di stato mostra "nessun
    // dato". Prima di questa correzione l'orologio ricadeva in silenzio
    // sull'indice 0 e mostrava un'ora vera (la prima dell'asse), mentre la
    // barra di stato diceva gia' che non c'era dato: due parti dello schermo
    // in contraddizione.
    const asse = [ora(0, "an"), ora(1, "an")];
    const primaDellAsse = asse[0].istante - 3_600_000;
    render(<TimelineScrubber asse={asse} istante={primaDellAsse} cambia={vi.fn()} />);
    expect(screen.getByTestId("orologio").textContent).toBe("nessun dato");
  });
});

describe("le frecce di passo", () => {
  const asse: Ora[] = [0, 1, 2].map((k) => ({
    istante: Date.UTC(2026, 7, 19, 9 + k), tipo: "an", riferimento: "20260819",
  }));

  it("spostano di un istante dell'asse, non di un'ora", () => {
    // Sotto c'e' lo stesso indice dello slider, quindi saltano i buchi come lui
    // e funzionano anche dove il dato non e' orario (il livello del mare e'
    // archiviato ogni dieci minuti): un passo in ore chiederebbe un istante che
    // su quell'asse non esiste.
    const visti: number[] = [];
    render(<TimelineScrubber asse={asse} istante={asse[1].istante} cambia={(i) => visti.push(i)} />);
    fireEvent.click(screen.getByLabelText("Istante successivo"));
    fireEvent.click(screen.getByLabelText("Istante precedente"));
    expect(visti).toEqual([asse[2].istante, asse[0].istante]);
  });

  it("ai capi dell'asse si disabilitano invece di non fare niente", () => {
    // Un comando che si puo' premere e non fa nulla sembra rotto.
    const { unmount } = render(
      <TimelineScrubber asse={asse} istante={asse[0].istante} cambia={() => {}} />);
    expect((screen.getByLabelText("Istante precedente") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Istante successivo") as HTMLButtonElement).disabled).toBe(false);
    unmount();

    render(<TimelineScrubber asse={asse} istante={asse[2].istante} cambia={() => {}} />);
    expect((screen.getByLabelText("Istante precedente") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Istante successivo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("con un asse vuoto sono entrambe disabilitate", () => {
    const vuoto: Ora[] = [];
    render(<TimelineScrubber asse={vuoto} istante={0} cambia={() => {}} />);
    expect((screen.getByLabelText("Istante precedente") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Istante successivo") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("un asse con un solo istante, o nessuno", () => {
  it("non produce uno stile invalido, e il cursore si disabilita", () => {
    // Radix, con min e max uguali, divide per zero e scrive un calc() con NaN
    // dentro: uno stile che nemmeno il browser sa leggere. Succede con un asse
    // di un solo istante (una finestra con una sola ora disponibile) o vuoto
    // (durante il caricamento), che sono stati veri. Il render qui sotto
    // fallirebbe con un errore di parsing CSS.
    const uno = [ora(0, "an")];
    const { container } = render(
      <TimelineScrubber asse={uno} istante={uno[0].istante} cambia={() => {}} />);
    for (const el of container.querySelectorAll("[style]")) {
      expect(el.getAttribute("style"), "stile con NaN dentro").not.toMatch(/NaN/);
    }
    expect(screen.getByLabelText("Ora selezionata").getAttribute("data-disabled")).not.toBeNull();
  });
});
