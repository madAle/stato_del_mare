import { expect, test } from "@playwright/test";

/**
 * Il valore mostrato sotto il cursore dipende da DUE cose: dove sta il cursore
 * e quale istante e' a schermo. La seconda cambia da sola mentre la
 * riproduzione scorre, quindi calcolarlo solo quando si muove il mouse lascia a
 * schermo un numero che appartiene a un altro istante, accanto a una barra di
 * stato che dichiara l'istante giusto: le due meta' dello schermo si
 * contraddicono e quella sbagliata sembra una misura.
 */

/** Un punto in mare aperto, dove il dato esiste di sicuro. */
const MARE: [number, number] = [12.9, 44.2];

async function schermo(pagina: import("@playwright/test").Page, punto: [number, number]) {
  return pagina.evaluate((p) =>
    (window as never as { __mappa: { project(c: [number, number]): { x: number; y: number } } })
      .__mappa.project(p), punto);
}

test("il valore segue il tempo anche a cursore fermo", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);

  const punto = await schermo(page, MARE);
  await page.mouse.move(punto.x, punto.y);
  await page.waitForTimeout(400);

  const oraPrima = await page.getByTestId("orologio").textContent();
  const valorePrima = await page.locator(".valore").textContent();
  expect(valorePrima).not.toBe("");

  // si riproduce senza toccare il mouse
  await page.getByRole("button", { name: /riproduci/i }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /pausa/i }).click();
  await page.waitForTimeout(300);

  // il tempo deve essere avanzato, se no il test non prova niente
  expect(await page.getByTestId("orologio").textContent()).not.toBe(oraPrima);
  expect(await page.locator(".valore").textContent()).not.toBe(valorePrima);
});

test("uscendo dalla mappa il valore sparisce invece di restare", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);

  const punto = await schermo(page, MARE);
  await page.mouse.move(punto.x, punto.y);
  await page.waitForTimeout(400);
  expect(await page.locator(".valore").textContent()).not.toBe("");

  // il cursore esce dalla tela della mappa
  await page.mouse.move(punto.x, punto.y);
  await page.dispatchEvent("canvas", "mouseout");
  await page.waitForTimeout(400);

  expect(await page.locator(".valore").textContent()).toBe("");
});
