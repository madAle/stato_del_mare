/**
 * Preparazione dell'ambiente jsdom per i test di componente.
 *
 * jsdom non implementa ResizeObserver (verificato: la versione installata da
 * questo progetto non lo espone). Il thumb di Radix Slider lo usa per
 * misurare la propria dimensione appena viene montato, quindi senza questo
 * finto ogni test che rende TimelineScrubber fallirebbe con "ResizeObserver
 * is not defined", un guasto dell'ambiente e non del componente. Il finto non
 * osserva davvero niente: nei test si controlla solo la resa iniziale, mai un
 * ridimensionamento.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

class ResizeObserverFinto {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverFinto as unknown as typeof ResizeObserver;
}

// Senza questa riga il documento jsdom resta popolato dal render di un test al
// successivo, perche' l'ambiente non si azzera da solo fra un "it" e l'altro
// nello stesso file: un elemento cercato per data-testid puo' risultare
// trovato, e quindi il test sbagliare, perche' e' rimasto li' da prima e non
// perche' il componente in esame lo abbia disegnato davvero.
afterEach(() => {
  cleanup();
});
