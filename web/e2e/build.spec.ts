import { expect, test } from "@playwright/test";

/**
 * I test che girano sul **bundle compilato**, non sul dev server.
 *
 * Esistono per un difetto che nessuno degli altri poteva vedere: in
 * produzione ogni sorgente GeoJSON smetteva di caricare, quindi le isolinee
 * non si vedevano, e la sola traccia era un `ReferenceError` nella console
 * dentro un worker. Il dev server serviva i moduli non trasformati e andava
 * benissimo; a rompersi era la build (vedi il commento in map/mappa.ts).
 *
 * La regola che se ne ricava: **quello che gira in produzione e' un altro
 * programma**. Un difetto che vive solo nella build va cercato nella build.
 * Girano su una porta diversa, servita da `vite preview`.
 */

const CHIAVE = "?t=2026-08-16T12:00Z&z=7&c=43.5,14.5";

test("sul bundle compilato le sorgenti GeoJSON caricano davvero", async ({ page }) => {
  const errori: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });

  await page.goto(`/${CHIAVE}`);
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame, null, { timeout: 30_000 });

  // Le isolinee sono la sorgente GeoJSON dell'applicazione: se il worker di
  // MapLibre non riesce a indicizzarle, `querySourceFeatures` resta a zero
  // senza che niente si lamenti a schermo.
  await page.waitForFunction(
    () => ((window as never as { __mappa?: { querySourceFeatures(id: string): unknown[] } }).__mappa
      ?.querySourceFeatures("isolinee").length ?? 0) > 0,
    null,
    { timeout: 25_000 },
  );

  // e una sorgente GeoJSON qualunque, per dire che il difetto era generale e
  // non qualcosa delle isolinee: e' cosi' che e' stato isolato.
  const quante = await page.evaluate(async () => {
    const m = (window as never as { __mappa: {
      addSource(id: string, s: unknown): void;
      addLayer(l: unknown): void;
      querySourceFeatures(id: string): unknown[];
    } }).__mappa;
    m.addSource("prova", { type: "geojson", data: { type: "Feature", properties: {},
      geometry: { type: "LineString", coordinates: [[12, 43], [15, 45]] } } });
    m.addLayer({ id: "prova", type: "line", source: "prova", paint: { "line-width": 2 } });
    await new Promise((r) => setTimeout(r, 3000));
    return m.querySourceFeatures("prova").length;
  });
  expect(quante, "una sorgente GeoJSON banale non carica nel bundle compilato").toBeGreaterThan(0);

  // Il sintomo si vedeva solo qui: un worker che muore lo dice alla console e
  // a nessun altro.
  expect(errori.filter((e) => /is not defined|ReferenceError/.test(e)), "errori nella console").toEqual([]);
});
