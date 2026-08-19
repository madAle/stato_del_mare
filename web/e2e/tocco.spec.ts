import { expect, test } from "@playwright/test";

/**
 * Quello che cambia quando si guarda questa mappa da un telefono.
 *
 * Il descrittore di dispositivo di Playwright porterebbe con se' webkit, che
 * non e' installato qui: si tiene chromium e si prendono le tre cose che
 * contano davvero, cioe' la finestra di un telefono, il tocco al posto del
 * mouse e il puntatore grosso (e' `isMobile` a far valere `pointer: coarse`,
 * che e' la condizione sotto cui il foglio di stile allarga i bersagli).
 */
test.use({
  viewport: { width: 390, height: 664 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});

/** Sotto questa misura un bersaglio si sbaglia col dito. */
const MINIMO_PX = 44;

async function pronta(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  await page.waitForTimeout(300);
}

test("i comandi si prendono con un dito", async ({ page }) => {
  await pronta(page);

  for (const b of await page.locator(".comandi-riproduzione button").all()) {
    const nome = (await b.getAttribute("aria-label")) ?? (await b.textContent());
    const r = await b.boundingBox();
    expect(r, `${nome} non e' visibile`).not.toBeNull();
    expect(Math.round(r!.height), `il bottone ${nome} e' alto ${r!.height} px`)
      .toBeGreaterThanOrEqual(MINIMO_PX);
  }

  // Il cursore del tempo resta piccolo a vedersi (deve lasciar vedere la
  // traccia) ma la sua area sensibile no: si misura dove si puo' toccare, non
  // dove si vede. Senza questo, il gesto principale dell'applicazione avrebbe
  // il bersaglio piu' piccolo di tutta l'interfaccia, che sono 14 px.
  const cursore = page.locator("[aria-label='Ora selezionata']");
  const area = await cursore.evaluate((el) => {
    const s = getComputedStyle(el, "::after");
    const r = el.getBoundingClientRect();
    const scarto = Math.abs(parseFloat(s.insetBlockStart || s.top || "0"));
    return { larghezza: r.width + 2 * scarto, altezza: r.height + 2 * scarto };
  });
  expect(Math.round(area.larghezza)).toBeGreaterThanOrEqual(MINIMO_PX);
  expect(Math.round(area.altezza)).toBeGreaterThanOrEqual(MINIMO_PX);
});

test("toccando la mappa si legge il valore", async ({ page }) => {
  await pronta(page);

  // Su un telefono non esiste il passaggio del mouse: se la lettura del valore
  // dipendesse davvero dal solo `mousemove` di un mouse, su un telefono non si
  // leggerebbe mai un numero.
  await expect(page.locator(".valore")).toHaveText("");
  await page.locator("canvas").first().tap({ position: { x: 195, y: 300 } });
  await expect(page.locator(".valore")).not.toHaveText("", { timeout: 5000 });
});

test("le etichette della scala non si accavallano ne' escono", async ({ page }) => {
  await pronta(page);

  const scala = await page.locator(".scrubber-scala").boundingBox();
  expect(scala).not.toBeNull();

  const segni = [
    ...(await page.locator(".scrubber-tacca").all()),
    ...(await page.locator(".scrubber-adesso").all()),
  ];
  const rett: { testo: string; r: { x: number; y: number; width: number; height: number } }[] = [];
  for (const s of segni) {
    const r = await s.boundingBox();
    if (r) rett.push({ testo: (await s.textContent()) ?? "", r });
  }
  expect(rett.length, "nessuna tacca disegnata").toBeGreaterThan(0);

  for (const { testo, r } of rett) {
    expect(Math.round(r.x), `"${testo}" esce a sinistra`).toBeGreaterThanOrEqual(Math.round(scala!.x) - 1);
    expect(Math.round(r.x + r.width), `"${testo}" esce a destra`)
      .toBeLessThanOrEqual(Math.round(scala!.x + scala!.width) + 1);
  }

  for (let i = 0; i < rett.length; i++) {
    for (let j = i + 1; j < rett.length; j++) {
      const a = rett[i], b = rett[j];
      const sovrapposti = a.r.x < b.r.x + b.r.width && b.r.x < a.r.x + a.r.width;
      expect(sovrapposti, `"${a.testo}" e "${b.testo}" si accavallano`).toBe(false);
    }
  }
});
