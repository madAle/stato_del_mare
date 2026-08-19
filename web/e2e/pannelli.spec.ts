import { expect, test } from "@playwright/test";

/**
 * I pannelli non devono sovrapporsi a nessuna larghezza plausibile.
 *
 * La verifica e' geometrica e non a occhio: si prendono i rettangoli veri e si
 * controlla che non si intersechino. Un test che guardasse solo "l'elemento
 * esiste" non vedrebbe nulla di questo, ed e' esattamente il difetto con cui il
 * foglio di stile e' nato.
 */
const LARGHEZZE = [1440, 900, 680, 500, 390];

type Rett = { x: number; y: number; width: number; height: number };

function siSovrappongono(a: Rett, b: Rett): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const larghezza of LARGHEZZE) {
  test(`a ${larghezza} px i pannelli non si sovrappongono`, async ({ page }) => {
    await page.setViewportSize({ width: larghezza, height: 800 });
    await page.goto("/");
    await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
    await page.waitForTimeout(300);

    const pannelli = ["\.barra-stato", "\.legenda", "\.scrubber", "\.comandi-riproduzione", "select[aria-label='variabile']"];
    const rettangoli: { nome: string; r: Rett }[] = [];
    for (const selettore of pannelli) {
      const r = await page.locator(selettore).boundingBox();
      expect(r, `${selettore} non e' visibile`).not.toBeNull();
      rettangoli.push({ nome: selettore, r: r! });
    }

    for (let i = 0; i < rettangoli.length; i++) {
      for (let j = i + 1; j < rettangoli.length; j++) {
        const a = rettangoli[i];
        const b = rettangoli[j];
        expect(siSovrappongono(a.r, b.r), `${a.nome} si sovrappone a ${b.nome}`).toBe(false);
      }
    }

    // e niente deve uscire dalla finestra
    const fuori = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(fuori, "qualcosa esce dalla finestra").toBe(false);
  });
}

test("la scala del tempo mostra le tacche e il riferimento adesso", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);

  // la finestra iniziale copre 48 ore indietro e 72 avanti, quindi "adesso" ci
  // cade dentro e le tacche devono essere piu' d'una
  await expect(page.getByTestId("adesso")).toBeVisible();
  expect(await page.locator(".scrubber-tacca").count()).toBeGreaterThan(2);
});
