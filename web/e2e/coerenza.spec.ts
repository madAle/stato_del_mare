import { expect, test } from "@playwright/test";

/**
 * Il test che vale piu' di tutti: la stessa cella, letta dal frame pubblicato e
 * mostrata dall'applicazione, deve dare lo stesso numero.
 *
 * Se questa catena regge (bucket, decodifica, proiezione, lettura sotto il
 * mouse), regge tutto il percorso di lettura. Si usa la cella di Nausicaa 2,
 * che e' la stessa boa su cui il test di rete dell'ingestore verifica la catena
 * dall'altro capo, cioe' dal NetCDF sorgente.
 */
const NAUSICAA = { lon: 12.4772, lat: 44.2247 };

test("il valore sotto il mouse coincide con quello nel frame", async ({ page, request }) => {
  const url = "https://pub-58d91a839da640f8ab33e576c44b89c8.r2.dev";
  const catalogo = await (await request.get(`${url}/catalog.json`)).json();
  const indice = await (await request.get(`${url}/index/hwave/an/2026-08.json`)).json();
  const ore = Object.keys(indice.hours).sort();
  const ora = ore[ore.length - 1];
  const riferimento = indice.hours[ora];
  const chiave = ora.replace(/:00:00Z$/, "").replace(":", "") + "00";

  const grezzo = await (await request.get(
    `${url}/frames/hwave/an/${riferimento}/${chiave}.bin`)).body();
  const dato = new Int16Array(grezzo.buffer, grezzo.byteOffset, grezzo.byteLength / 2);

  const g = catalogo.grid;
  const R = 6378137.0;
  const merc = (lon: number, lat: number) => ({
    x: (lon * Math.PI) / 180 * R,
    y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  });
  const nw = merc(g.bounds_lonlat.west, g.bounds_lonlat.north);
  const p = merc(NAUSICAA.lon, NAUSICAA.lat);
  const colonna = Math.floor((p.x - nw.x) / g.resolution_m);
  const riga = Math.floor((nw.y - p.y) / g.resolution_m);
  const atteso = dato[riga * g.width + colonna] * 0.001;

  await page.goto(`/?t=${ora}&var=hwave&z=11&c=${NAUSICAA.lat},${NAUSICAA.lon}`);
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  const punto = await page.evaluate(([lon, lat]) =>
    (window as never as { __mappa: { project(c: [number, number]): { x: number; y: number } } })
      .__mappa.project([lon, lat]), [NAUSICAA.lon, NAUSICAA.lat]);
  await page.mouse.move(punto.x, punto.y);

  const mostrato = await page.locator(".valore").textContent();
  const numero = Number((mostrato ?? "").replace(",", ".").replace(/[^\d.-]/g, ""));
  // la tolleranza e' quella dell'arrotondamento a due decimali della UI
  expect(Math.abs(numero - atteso)).toBeLessThan(0.005);
});
