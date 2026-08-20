import { expect, test } from "@playwright/test";

/**
 * Cambiare grandezza disegnata.
 *
 * Non e' "accendere un layer": cambia la scala dei valori grezzi (millesimi di
 * metro contro centesimi di secondo), la cima della legenda, l'unita', se il
 * numero porta lo stato del mare, e se le isolinee hanno senso. Ognuna di
 * queste, sbagliata, non si vede come un errore: si vede come un mare diverso.
 */

type Mappa = { querySourceFeatures(id: string): unknown[] };

async function pronta(page: import("@playwright/test").Page, query: string) {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  await page.waitForTimeout(2000);
}

test("passando al periodo cambiano scala, unita', numero e isolinee", async ({ page }) => {
  const errori: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });

  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6");
  await page.locator("canvas").first().click({ position: { x: 640, y: 380 } });
  await expect(page.locator(".valore")).toHaveText(/m · /, { timeout: 8000 });
  await expect.poll(() => page.evaluate(
    () => (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee").length,
  ), { timeout: 20_000 }).toBeGreaterThan(0);

  await page.getByLabel("variabile").selectOption("pwave");
  await page.waitForTimeout(6000);

  // La legenda dev'essere quella del periodo, non quella dell'onda: 8 s, non 4 m.
  await expect(page.locator(".legenda")).toContainText("8 s");
  // Il numero non porta piu' lo stato del mare: un periodo in secondi non e'
  // "poco mosso", e appiccicarglielo sarebbe una cosa falsa accanto a una vera.
  await expect(page.locator(".valore")).toHaveText(/^\d+,\d\d s$/);
  // Le isolinee sono i confini Douglas in metri d'onda: su un campo di secondi
  // una linea a 0,5 m affermerebbe una cosa falsa, quindi spariscono e il
  // comando che le accende si disabilita invece di restare li' a mentire.
  expect(await page.evaluate(
    () => (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee").length,
  )).toBe(0);
  await expect(page.locator(".interruttore input")).toBeDisabled();

  expect(errori, "errori in console cambiando grandezza").toEqual([]);
});

test("il periodo mostra solo i valori che il modello puo' produrre", async ({ page }) => {
  // Misurato su tutto l'archivio: il periodo di picco prende 17 valori, in
  // progressione geometrica di rapporto 1,1326 (la griglia delle frequenze di
  // SWAN). Interpolare fra due ore darebbe un periodo che il modello non ha
  // calcolato, e il numero sotto il dito lo scriverebbe: e' la stessa regola
  // per cui l'orologio non scrive mai "09:37" su un dato orario.
  const LIVELLI = [1, 1.13, 1.28, 1.45, 1.65, 1.87, 2.11, 2.4, 2.71, 3.08,
                   3.48, 3.95, 4.47, 5.07, 5.74, 6.5, 7.37];

  await pronta(page, "?t=2026-08-16T12:30Z&z=7&c=44.2,13.6&var=pwave");
  await page.locator("canvas").first().click({ position: { x: 640, y: 380 } });
  await expect(page.locator(".valore")).toHaveText(/\d s$/, { timeout: 8000 });

  // mezz'ora esatta fra due ore: e' il punto in cui una dissolvenza produrrebbe
  // il valore intermedio, cioe' quello che non deve esistere
  const testo = (await page.locator(".valore").textContent())!;
  const letto = Number(testo.replace(" s", "").replace(",", "."));
  const vicino = LIVELLI.reduce((a, b) => Math.abs(b - letto) < Math.abs(a - letto) ? b : a);
  expect(Math.abs(letto - vicino), `${letto} s non e' un livello di SWAN`).toBeLessThanOrEqual(0.005);
});

test("un link con ?var=pwave apre direttamente il periodo", async ({ page }) => {
  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&var=pwave");
  await expect(page.getByLabel("variabile")).toHaveValue("pwave");
  await expect(page.locator(".legenda")).toContainText("8 s");
});

test("un link con una grandezza non disegnabile ricade sull'altezza d'onda", async ({ page }) => {
  // Aprire la mappa su una grandezza che non si sa disegnare lascerebbe la
  // legenda su un'unita' e il campo su un'altra fin dal primo render.
  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&var=corrente");
  await expect(page.getByLabel("variabile")).toHaveValue("hwave");
  await expect(page.locator(".legenda")).toContainText("4 m");
});
