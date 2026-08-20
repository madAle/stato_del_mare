import { expect, test } from "@playwright/test";

type Mappa = {
  unproject(p: [number, number]): { lng: number; lat: number };
  panBy(offset: [number, number], opzioni?: unknown): void;
};

async function pronta(page: import("@playwright/test").Page, query = "") {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  await page.waitForTimeout(300);
}

/** Dove sta il centro del segno, in coordinate geografiche. */
async function dovePunta(page: import("@playwright/test").Page) {
  const r = await page.getByTestId("segnaposto").boundingBox();
  expect(r, "il segno non c'e'").not.toBeNull();
  return page.evaluate(
    (p) => (window as never as { __mappa: Mappa }).__mappa.unproject(p as [number, number]),
    [r!.x + r!.width / 2, r!.y + r!.height / 2],
  );
}

test("toccando la mappa si pianta il punto e si legge il valore", async ({ page }) => {
  await pronta(page);
  await expect(page.getByTestId("segnaposto")).toHaveCount(0);

  await page.locator("canvas").first().click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("segnaposto")).toBeVisible();
  // Il numero accanto al segno e' lo stesso della barra di stato: una sola
  // funzione lo scrive, quindi non possono divergere.
  await expect(page.getByTestId("valore-segnaposto")).toHaveText(/\d+,\d\d \w+/, { timeout: 5000 });
  await expect(page.locator(".valore")).toHaveText(await page.getByTestId("valore-segnaposto").textContent() ?? "");
});

test("il punto resta sulla sua coordinata quando la mappa si sposta", async ({ page }) => {
  // Si parte gia' ingranditi: la mappa ha `maxBounds` sul dominio del dato
  // (mappa.ts), quindi allo zoom di apertura e' gia' incastrata e una
  // panoramica non muove niente. Senza questo, il test passerebbe perche' non
  // e' cambiato nulla, che e' il modo peggiore di passare.
  await pronta(page, "?z=9&c=44.2,12.6");
  await page.locator("canvas").first().click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("segnaposto")).toBeVisible();

  const prima = await dovePunta(page);
  const schermoPrima = (await page.getByTestId("segnaposto").boundingBox())!;

  // E' l'invariante che rende onesto tutto il resto: se il segno fosse
  // ancorato ai pixel invece che a longitudine e latitudine, trascinare la
  // mappa cambierebbe in silenzio il posto a cui il numero si riferisce, e
  // nessuno se ne accorgerebbe guardando lo schermo.
  await page.evaluate(() => (window as never as { __mappa: Mappa }).__mappa.panBy([160, 90], { duration: 0 }));
  await page.waitForTimeout(600);
  const dopo = await dovePunta(page);
  const schermoDopo = (await page.getByTestId("segnaposto").boundingBox())!;

  // Prima l'asserzione che rende il test capace di fallire: il segno si e'
  // spostato sullo schermo di quanto si e' spostata la mappa. Senza questa,
  // una panoramica che non avviene farebbe passare il test per il motivo
  // sbagliato, cioe' perche' non e' cambiato niente.
  expect(Math.round(schermoDopo.x - schermoPrima.x), "il segno non si e' mosso sullo schermo").toBe(-160);
  expect(Math.round(schermoDopo.y - schermoPrima.y), "il segno non si e' mosso sullo schermo").toBe(-90);

  // e nonostante si sia mosso sullo schermo, indica ancora lo stesso posto
  expect(Math.abs(dopo.lng - prima.lng)).toBeLessThan(0.02);
  expect(Math.abs(dopo.lat - prima.lat)).toBeLessThan(0.02);
});

test("l'anello del segno cade sul punto toccato, non accanto", async ({ page }) => {
  await pronta(page, "?z=9&c=44.2,12.6");
  const tela = page.locator("canvas").first();
  const tavolo = (await tela.boundingBox())!;
  await tela.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("segnaposto")).toBeVisible();

  // Il riquadro dell'elemento puo' essere centrato benissimo e il segno essere
  // comunque spostato: chi guarda vede l'anello, non il riquadro. Si misura la
  // scatola davvero usata dall'anello, non quella che i suoi stili dichiarano:
  // il difetto stava proprio nella differenza fra le due (i 2 px di bordo che
  // `box-sizing` non applicava agli pseudo-elementi).
  const a = (await page.getByTestId("anello-segnaposto").boundingBox())!;
  expect(Math.abs(a.x + a.width / 2 - (tavolo.x + 500)), "l'anello e' spostato in orizzontale").toBeLessThanOrEqual(0.5);
  expect(Math.abs(a.y + a.height / 2 - (tavolo.y + 300)), "l'anello e' spostato in verticale").toBeLessThanOrEqual(0.5);
});

test("toccando il segno il punto si toglie", async ({ page }) => {
  await pronta(page);
  await page.locator("canvas").first().click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("segnaposto")).toBeVisible();

  // Il click sul segno non deve arrivare anche alla mappa: se ci arrivasse,
  // la mappa lo leggerebbe come "pianta qui" e rimetterebbe subito il punto
  // appena tolto, cioe' non si potrebbe togliere affatto.
  await page.getByTestId("segnaposto").click();
  await expect(page.getByTestId("segnaposto")).toHaveCount(0);
});

test("il punto viaggia nell'URL, come il resto dello stato", async ({ page }) => {
  await pronta(page);
  await page.locator("canvas").first().click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("segnaposto")).toBeVisible();
  const dove = await dovePunta(page);

  // lo scrittore dell'URL e' strozzato a un secondo
  await expect.poll(() => page.evaluate(() => location.search), { timeout: 5000 })
    .toMatch(/[?&]p=/);

  const p = new URLSearchParams(await page.evaluate(() => location.search)).get("p")!;
  const [lat, lon] = p.split(",").map(Number);
  expect(Math.abs(lat - dove.lat)).toBeLessThan(0.02);
  expect(Math.abs(lon - dove.lng)).toBeLessThan(0.02);

  // e riaprendo quel link il punto e' gia' piantato dove si era lasciato
  await pronta(page, `?p=${lat},${lon}`);
  await expect(page.getByTestId("segnaposto")).toBeVisible();
  const riaperto = await dovePunta(page);
  expect(Math.abs(riaperto.lat - lat)).toBeLessThan(0.02);
});
