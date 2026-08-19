import { expect, test } from "@playwright/test";

/**
 * Lo sfondo piatto dello stile minimo dei test, definito in src/main.tsx
 * (`stileMinimoPerITest`). Se cambia li', questo test fallisce invece di
 * passare per caso: e' il punto di riferimento rispetto a cui si decide se un
 * pixel e' stato dipinto dal campo o no.
 */
const SFONDO = [190, 195, 200];
/** Sotto questo scarto due colori sono lo stesso colore, per i nostri scopi. */
const SCARTO = 12;

/**
 * Dipinto vuol dire "diverso dallo sfondo", non "di un certo colore".
 *
 * La prima versione chiedeva rosso > blu, cioe' dava per scontata la tavolozza
 * `amp`. Quando il catalogo e' passato a `dense` il mare e' diventato azzurro e
 * il test e' diventato rosso, pur essendo la mappa perfettamente corretta: il
 * test verificava la tinta invece della presenza del campo, che e' la cosa che
 * gli interessa davvero. Misurato il 2026-08-19 su questa inquadratura: al
 * largo 226,251,255, sull'entroterra 190,195,200, cioe' lo sfondo esatto.
 */
async function dipinto(pagina: import("@playwright/test").Page, x: number, y: number) {
  const px = await pagina.evaluate(([px, py]) => {
    const tela = document.querySelector("canvas") as HTMLCanvasElement;
    const copia = document.createElement("canvas");
    // Un canvas senza width/height esplicite resta 300x150 per specifica:
    // qualunque lettura fuori da quei bordi (qui il campo vive spesso oltre
    // x=300, a seconda dello zoom) restituisce nero per specifica, non
    // perche' la mappa non abbia disegnato niente li'. Senza dimensionare la
    // copia come la sorgente, dipinto() misura sempre nero e sembra
    // funzionare finche' nessuno controlla se il colore letto e' vero.
    copia.width = tela.width;
    copia.height = tela.height;
    const g = copia.getContext("2d")!;
    g.drawImage(tela, 0, 0);
    const d = g.getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
  return Math.max(...px.map((c, i) => Math.abs(c - SFONDO[i]))) > SCARTO;
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
