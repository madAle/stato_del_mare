import { expect, test } from "@playwright/test";

/**
 * I pannelli non devono sovrapporsi ne' uscire dalla finestra a nessuna
 * dimensione plausibile.
 *
 * La verifica e' geometrica e non a occhio: si prendono i rettangoli veri e si
 * controlla che non si intersechino. Un test che guardasse solo "l'elemento
 * esiste" non vedrebbe nulla di questo, ed e' esattamente il difetto con cui il
 * foglio di stile e' nato.
 *
 * Le misure sono coppie e non larghezze: la prima versione provava cinque
 * larghezze tutte alte 800 px, e un telefono girato e' basso, non stretto.
 * Quella lacuna ha lasciato passare tutti i difetti trovati il 2026-08-19
 * (barra di stato tagliata, attribuzione sopra lo scrubber, scrubber che si
 * prende un terzo dell'altezza).
 */
const FINESTRE = [
  { width: 1440, height: 900 },
  { width: 900, height: 800 },
  { width: 680, height: 800 },
  { width: 500, height: 800 },
  { width: 390, height: 664 },   // telefono in verticale
  { width: 360, height: 600 },   // telefono piccolo in verticale
  { width: 844, height: 331 },   // telefono girato: basso, non stretto
];

type Rett = { x: number; y: number; width: number; height: number };

function siSovrappongono(a: Rett, b: Rett): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const f of FINESTRE) {
  test(`a ${f.width}x${f.height} i pannelli non si sovrappongono`, async ({ page }) => {
    await page.setViewportSize(f);
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

    // e niente deve uscire dalla finestra. Non basta guardare lo scorrimento:
    // <main> ha overflow: hidden, quindi un pannello piu' largo della finestra
    // viene tagliato in silenzio invece di produrre una barra di scorrimento.
    // E' cosi' che la barra di stato ha perso "previsione +37h" su un telefono.
    for (const { nome, r } of rettangoli) {
      expect(Math.round(r.x + r.width), `${nome} esce a destra`).toBeLessThanOrEqual(f.width);
      expect(Math.round(r.y + r.height), `${nome} esce in basso`).toBeLessThanOrEqual(f.height);
      expect(Math.round(r.x), `${nome} esce a sinistra`).toBeGreaterThanOrEqual(0);
    }
    const fuori = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(fuori, "qualcosa esce dalla finestra").toBe(false);

    // L'attribuzione di MapLibre e' un obbligo di licenza: se finisce sotto un
    // pannello non e' piu' leggibile, che e' come non averla.
    const attribuzione = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
    if (attribuzione) {
      for (const { nome, r } of rettangoli) {
        expect(siSovrappongono(attribuzione, r), `l'attribuzione finisce sotto ${nome}`).toBe(false);
      }
    }
  });
}

test("ogni pannello ha un fondo suo, non la mappa", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);

  // Il contrasto vero non si misura qui (i test montano uno sfondo grigio
  // piatto apposta), ma il difetto era piu' grossolano: barra di stato e
  // legenda scrivevano direttamente sulla mappa, senza riquadro, e sopra i nomi
  // delle citta' della basemap vera non si leggevano. Sul grigio dei test si
  // leggevano benissimo, ed e' per questo che nessuna misura geometrica se n'e'
  // accorta. Un fondo dichiarato e' l'invariante che sarebbe bastato.
  for (const selettore of [".barra-stato", ".legenda", ".scrubber", ".comandi-riproduzione"]) {
    const fondo = await page.locator(selettore).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fondo, `${selettore} non ha un fondo suo`).not.toBe("rgba(0, 0, 0, 0)");
    expect(fondo, `${selettore} non ha un fondo suo`).not.toBe("transparent");
  }
});

test("la scala del tempo mostra le tacche e il riferimento adesso", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);

  // la finestra iniziale copre 48 ore indietro e 72 avanti, quindi "adesso" ci
  // cade dentro e le tacche devono essere piu' d'una
  await expect(page.getByTestId("adesso")).toBeVisible();
  expect(await page.locator(".scrubber-tacca").count()).toBeGreaterThan(2);
});
