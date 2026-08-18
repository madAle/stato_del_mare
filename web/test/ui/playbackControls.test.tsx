import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackControls } from "../../src/ui/PlaybackControls";

/**
 * Fissa il contratto di accessibilita' che il test di resa del task 16 da'
 * per buono cercando il bottone per ruolo e nome (getByRole("button", { name:
 * /riproduci/i })): senza queste righe, un rimaneggiamento futuro del
 * Toggle.Root (spostare il testo in un figlio, togliere l'aria-label,
 * cambiare l'etichetta) romperebbe quel contratto in silenzio, e il difetto
 * salterebbe fuori solo dentro un test end to end.
 */
describe("PlaybackControls", () => {
  it("da fermo il bottone si chiama riproduci e non pausa", () => {
    render(
      <PlaybackControls inRiproduzione={false} cambia={vi.fn()} cambiaVelocita={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /riproduci/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /pausa/i })).toBeNull();
  });

  it("in riproduzione il bottone si chiama pausa e non riproduci", () => {
    render(
      <PlaybackControls inRiproduzione={true} cambia={vi.fn()} cambiaVelocita={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /pausa/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /riproduci/i })).toBeNull();
  });

  it("premere il bottone da fermo chiama cambia con true", () => {
    const cambia = vi.fn();
    render(<PlaybackControls inRiproduzione={false} cambia={cambia} cambiaVelocita={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /riproduci/i }));
    expect(cambia).toHaveBeenCalledWith(true);
  });

  it("premere il bottone in riproduzione chiama cambia con false", () => {
    const cambia = vi.fn();
    render(<PlaybackControls inRiproduzione={true} cambia={cambia} cambiaVelocita={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /pausa/i }));
    expect(cambia).toHaveBeenCalledWith(false);
  });

  it("i tre comandi di velocita' chiamano cambiaVelocita con il valore giusto", () => {
    const cambiaVelocita = vi.fn();
    render(
      <PlaybackControls inRiproduzione={false} cambia={vi.fn()} cambiaVelocita={cambiaVelocita} />,
    );
    for (const v of [2, 4, 8]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${v} ore/s$`) }));
      expect(cambiaVelocita).toHaveBeenCalledWith(v);
    }
    expect(cambiaVelocita).toHaveBeenCalledTimes(3);
  });
});
