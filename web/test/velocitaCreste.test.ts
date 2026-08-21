import { describe, expect, it } from "vitest";
import { SEMI_CRESTA_PX, VELOCITA_A_SCHERMO_PX_S } from "../src/map/livelloParticelle";

/**
 * Il fattore di velocita' e la taglia della cresta sono **legati**, e prima del
 * 2026-08-21 il legame non stava scritto da nessuna parte.
 *
 * Cos'e' andato storto: i 45 px/s erano stati scelti quando la marca era una
 * scia lunga una quarantina di pixel (decisione 84), cioe' un oggetto che a
 * quella velocita' avanzava 1,13 volte la propria lunghezza al secondo e quindi
 * si sovrapponeva sempre a dov'era. Passando alle creste la marca ha perso
 * l'estensione **lungo il moto** (18 px in largo, 2,7 di gobba in lungo), e gli
 * stessi 45 px/s sono diventati 2,5 larghezze al secondo: velocita' vera
 * identica, misurata (mediana 48,5 px/s sulla mappa vera), e velocita'
 * apparente piu' che doppia. Segnalato guardando la mappa, non dai test.
 *
 * Questo test e' il filo teso su quel legame: scatta se qualcuno alza la
 * velocita' o rimpicciolisce la cresta senza guardare l'altro numero.
 */
describe("la velocita' a schermo sta insieme alla taglia della cresta", () => {
  it("una cresta non avanza piu' di circa una sua larghezza al secondo", () => {
    const larghezze = VELOCITA_A_SCHERMO_PX_S / (2 * SEMI_CRESTA_PX);
    expect(larghezze, `${VELOCITA_A_SCHERMO_PX_S} px/s su creste da ${2 * SEMI_CRESTA_PX} px`)
      .toBeLessThanOrEqual(1.2);
  });

  it("e nemmeno cosi' piano da sembrare ferma", () => {
    // L'altro capo: sotto mezza larghezza al secondo il campo si legge come una
    // tessitura immobile, e le particelle esistono perche' una direzione ferma
    // non si legge (decisione 83).
    expect(VELOCITA_A_SCHERMO_PX_S / (2 * SEMI_CRESTA_PX)).toBeGreaterThanOrEqual(0.5);
  });
});
