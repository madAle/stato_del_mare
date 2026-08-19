import { describe, expect, it } from "vitest";

/**
 * Non un componente vero: serve solo a dimostrare che vitest.config.ts smista
 * su jsdom per cartella (test/ui/**), non per estensione.
 *
 * Prima di questa correzione l'ambiente jsdom si assegnava solo ai file
 * test/**\/*.tsx: un test di componente scritto senza JSX (per esempio un
 * test di hook, .ts) dentro test/ non sarebbe finito in nessuno dei due
 * progetti per come erano scritti gli include/exclude di allora, e sarebbe
 * girato nell'ambiente Node del progetto di default, dove `document` non
 * esiste. Questo file e' apposta un .ts (non .tsx) dentro test/ui/: se il
 * glob tornasse a essere per estensione, l'ambiente sarebbe di nuovo Node e
 * l'asserzione sotto fallirebbe.
 */
describe("smistamento per cartella, non per estensione", () => {
  it("un file .ts dentro test/ui/ gira comunque in jsdom", () => {
    expect(typeof document).not.toBe("undefined");
  });
});
