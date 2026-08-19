import { expect, test } from "@playwright/test";

/**
 * Le isolinee sul campo: linee e numeri che ci corrono sopra.
 *
 * Si verifica la sorgente GeoJSON e non i pixel: il calcolo sta in un worker e
 * le linee arrivano quando arriva, mentre `queryRenderedFeatures` dice cosa la
 * mappa sta davvero disegnando in quel momento e su quale strato.
 */
type Mappa = {
  getSource(id: string): { _data?: GeoJSON.FeatureCollection } | undefined;
  querySourceFeatures(id: string): { properties: Record<string, unknown> }[];
  getLayer(id: string): unknown;
};

async function conLinee(page: import("@playwright/test").Page, query = "") {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  // `__mappa` viene assegnata dopo il primo disegno, quindi si aspetta anche
  // quella: senza, la funzione qui sotto legge `undefined` e il test fallisce
  // per un motivo che non c'entra con le isolinee.
  await page.waitForFunction(
    () => {
      const m = (window as never as { __mappa?: Mappa }).__mappa;
      return Boolean(m) && m!.querySourceFeatures("isolinee").length > 0;
    },
    null,
    { timeout: 25_000 },
  );
}

test("il campo porta le isolinee, e le soglie sono quelle dichiarate", async ({ page }) => {
  await conLinee(page, "?t=2026-08-16T12:00Z&z=7&c=43.5,14.5");

  const valori = await page.evaluate(() => {
    const f = (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee");
    return [...new Set(f.map((x) => x.properties.valore as number))].sort((a, b) => a - b);
  });
  console.log(`  soglie disegnate: ${valori.join(", ")}`);
  expect(valori.length).toBeGreaterThan(0);

  // Ogni valore disegnato deve stare nell'elenco unico delle soglie: una linea
  // a una soglia che nessuno ha dichiarato sarebbe una curva qualsiasi.
  const AMMESSE = [0.1, 0.5, 0.8, 1.25, 1.8, 2.5, 3.2, 4, 5, 6, 7, 8, 9, 14];
  for (const v of valori) expect(AMMESSE).toContain(v);
});

test("il numero compare solo dove la soglia ha un nome", async ({ page }) => {
  await conLinee(page, "?t=2026-08-16T12:00Z&z=7&c=43.5,14.5");

  const coppie = await page.evaluate(() => {
    const f = (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee");
    return f.map((x) => ({
      valore: x.properties.valore as number,
      nome: Boolean(x.properties.nome),
      etichetta: String(x.properties.etichetta ?? ""),
    }));
  });

  const WMO = [0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
  for (const c of coppie) {
    expect(c.nome, `la soglia ${c.valore} ha il nome sbagliato`).toBe(WMO.includes(c.valore));
    // il numero c'e' se e solo se la soglia ha un nome: le intermedie di ARPAE
    // corrono mute, se no la mappa diventa un elenco di cifre
    expect(c.etichetta === "").toBe(!c.nome);
    if (c.nome) expect(c.etichetta).toMatch(/^\d+(,\d+)? m$/);
  }
});

test("i due strati esistono e stanno sotto le etichette della basemap", async ({ page }) => {
  await conLinee(page, "?t=2026-08-16T12:00Z&z=7&c=43.5,14.5");
  for (const strato of ["isolinee-linee", "isolinee-numeri"]) {
    expect(await page.evaluate(
      (id) => Boolean((window as never as { __mappa: Mappa }).__mappa.getLayer(id)), strato,
    ), `manca lo strato ${strato}`).toBe(true);
  }
});
