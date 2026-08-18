import { expect, test } from "@playwright/test";

/** Il colore del campo si distingue dal mare della basemap: rosato contro azzurro. */
async function dipinto(pagina: import("@playwright/test").Page, x: number, y: number) {
  const px = await pagina.evaluate(([px, py]) => {
    const tela = document.querySelector("canvas") as HTMLCanvasElement;
    const g = document.createElement("canvas").getContext("2d")!;
    g.drawImage(tela, 0, 0);
    const d = g.getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
  return px[0] > px[2] + 8;
}

test("il campo si disegna dove c'e' il mare e non dove c'e' la terra", async ({ page }) => {
  await page.goto("/?t=2026-08-16T12:00Z&var=hwave&z=9&c=44.2,12.6");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);

  const alLargo = await page.evaluate(() =>
    (window as never as { __mappa: { project(c: [number, number]): { x: number; y: number } } })
      .__mappa.project([12.9, 44.2]));
  const entroterra = await page.evaluate(() =>
    (window as never as { __mappa: { project(c: [number, number]): { x: number; y: number } } })
      .__mappa.project([12.24, 44.14]));   // Cesena, venti chilometri dentro

  // Questa e' l'asserzione che il campo capovolto non supera: un Adriatico
  // disegnato da Belgrado a Napoli mette il colore sull'entroterra e lascia
  // vuoto il largo.
  expect(await dipinto(page, alLargo.x, alLargo.y)).toBe(true);
  expect(await dipinto(page, entroterra.x, entroterra.y)).toBe(false);
});

test("la riproduzione avanza e la provenienza resta dichiarata", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  const prima = await page.getByTestId("orologio").textContent();
  await page.getByRole("button", { name: /riproduci/i }).click();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId("orologio").textContent()).not.toBe(prima);
  await expect(page.locator(".provenienza")).toHaveText(/analisi|previsione \+\d+h/);
});
