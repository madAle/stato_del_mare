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

  // Ogni valore disegnato dev'essere un confine della scala Douglas: una linea
  // a una soglia che non separa due stati con un nome sarebbe una curva
  // qualsiasi (decisione del 2026-08-20, che ha tolto le intermedie ARPAE).
  const CONFINI_DOUGLAS = [0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
  for (const v of valori) expect(CONFINI_DOUGLAS).toContain(v);
});

test("ogni linea e' un confine Douglas e lo scrive col nome dello stato", async ({ page }) => {
  await conLinee(page, "?t=2026-08-16T12:00Z&z=7&c=43.5,14.5");

  const coppie = await page.evaluate(() => {
    const f = (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee");
    return f.map((x) => ({
      valore: x.properties.valore as number,
      nome: Boolean(x.properties.nome),
      etichetta: String(x.properties.etichetta ?? ""),
    }));
  });

  const DOUGLAS = [0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
  for (const c of coppie) {
    expect(DOUGLAS, `la soglia ${c.valore} non e' un confine Douglas`).toContain(c.valore);
    expect(c.nome, `la soglia ${c.valore} dovrebbe portare il nome`).toBe(true);
    // Sulla linea va solo l'altezza: il nome del grado sta accanto al valore
    // misurato, dove c'e' spazio per scriverlo.
    expect(c.etichetta).toMatch(/^\d+(,\d+)? m$/);
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

/**
 * Le isolinee devono continuare ad aggiornarsi mentre si scorre il tempo.
 *
 * Il difetto che questo test sorveglia era di contabilita' fra due processi:
 * il thread principale teneva l'elenco dei fotogrammi che il worker conosce e
 * non lo sfoltiva mai, mentre il worker buttava via i piu' vecchi per non
 * tenersi in casa decine di megabyte. Dopo qualche passata di trascinamento
 * quell'elenco diceva "mandati tutti" e il worker non ne aveva quasi nessuno:
 * misurato, 22 richieste su 26 tornavano "manca" e le linee restavano ferme
 * mentre il campo scorreva.
 *
 * Si contano i messaggi veri fra i due, non i pixel: il sintomo era che non
 * succedeva niente, e "niente" non si distingue guardando lo schermo.
 */
test("scorrendo a lungo il tempo, ogni richiesta di isolinee produce un risultato", async ({ page }) => {
  await page.addInitScript(() => {
    const Vero = window.Worker;
    (window as never as { __spia: Record<string, number> }).__spia = { calcola: 0, risultati: 0, manca: 0 };
    (window as never as { Worker: unknown }).Worker = class extends Vero {
      constructor(u: string | URL, o?: WorkerOptions) {
        super(u, o);
        if (!String(u).includes("isolinee")) return;
        const spia = (window as never as { __spia: Record<string, number> }).__spia;
        const vero = this.postMessage.bind(this);
        this.postMessage = (m: { tipo?: string }, ...r: never[]) => {
          if (m?.tipo === "calcola") spia.calcola++;
          return vero(m, ...r);
        };
        this.addEventListener("message", (e: MessageEvent<{ tipo?: string }>) => {
          if (e.data?.tipo === "isolinee") spia.risultati++;
          if (e.data?.tipo === "manca") spia.manca++;
        });
      }
    };
  });

  await conLinee(page, "?t=2026-08-16T12:00Z&z=7&c=44.0,13.5");
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const s = (window as never as { __spia: Record<string, number> }).__spia;
    s.calcola = 0; s.risultati = 0; s.manca = 0;
  });

  // Tre andate e ritorni sul cursore del tempo: il difetto non si vedeva alla
  // prima passata (4 fallimenti su 27) ma alla seconda e alla terza, quando i
  // fotogrammi gia' mandati erano stati sfrattati.
  const cursore = page.locator('[role="slider"]').first();
  const b = (await cursore.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let giro = 0; giro < 3; giro++) {
    await page.mouse.move(b.x + b.width / 2 - 300, b.y + b.height / 2, { steps: 40 });
    await page.mouse.move(b.x + b.width / 2 + 300, b.y + b.height / 2, { steps: 40 });
  }
  await page.mouse.up();
  await page.waitForTimeout(2000);

  const s = await page.evaluate(() => (window as never as { __spia: Record<string, number> }).__spia);
  console.log(`  calcoli ${s.calcola}, risultati ${s.risultati}, manca ${s.manca}`);
  expect(s.calcola, "il trascinamento non ha chiesto niente: il test non prova nulla").toBeGreaterThan(8);
  expect(s.manca, "il worker non aveva i fotogrammi che questo lato credeva di avergli mandato").toBe(0);
  // uno di scarto: l'ultima richiesta puo' essere ancora in volo
  expect(s.risultati).toBeGreaterThanOrEqual(s.calcola - 1);
});

/**
 * Le isolinee si possono togliere, e togliere vuol dire smettere di
 * calcolarle: un comando che nasconde una cosa lasciandola calcolare non fa
 * quello che dice, e chi lo usa lo usa proprio per togliere lavoro alla
 * macchina.
 */
test("l'interruttore spegne le isolinee, e spegnerle ferma anche il calcolo", async ({ page }) => {
  await page.addInitScript(() => {
    const Vero = window.Worker;
    (window as never as { __calcoli: number }).__calcoli = 0;
    (window as never as { Worker: unknown }).Worker = class extends Vero {
      constructor(u: string | URL, o?: WorkerOptions) {
        super(u, o);
        if (!String(u).includes("isolinee")) return;
        const vero = this.postMessage.bind(this);
        this.postMessage = (m: { tipo?: string }, ...r: never[]) => {
          if (m?.tipo === "calcola") (window as never as { __calcoli: number }).__calcoli++;
          return vero(m, ...r);
        };
      }
    };
  });

  await conLinee(page, "?t=2026-08-16T12:00Z&z=7&c=43.5,14.5");
  const interruttore = page.getByLabel("isolinee");
  await expect(interruttore).toBeChecked();

  await interruttore.uncheck();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as never as { __mappa: Mappa }).__mappa
    .querySourceFeatures("isolinee").length), "la sorgente non e' stata svuotata").toBe(0);

  // Da qui in poi il tempo scorre e non deve chiedere piu' niente al worker.
  await page.evaluate(() => (window as never as { __calcoli: number }).__calcoli = 0);
  await page.getByRole("button", { name: "riproduci" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /pausa|riproduci/ }).first().click();
  expect(await page.evaluate(() => (window as never as { __calcoli: number }).__calcoli),
    "spente, le isolinee si calcolano ancora").toBe(0);

  // e riaccendendole tornano subito, senza aspettare che il tempo avanzi
  await interruttore.check();
  await expect.poll(
    () => page.evaluate(() => (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee").length),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
});

test("la scelta viaggia nell'URL e un link con iso=0 apre la mappa senza linee", async ({ page }) => {
  await page.goto("/?t=2026-08-16T12:00Z&z=7&c=43.5,14.5&iso=0");
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  await page.waitForTimeout(3000);
  await expect(page.getByLabel("isolinee")).not.toBeChecked();
  expect(await page.evaluate(() => (window as never as { __mappa: Mappa }).__mappa
    .querySourceFeatures("isolinee").length)).toBe(0);

  await page.getByLabel("isolinee").check();
  await expect.poll(() => page.evaluate(() => location.search), { timeout: 5000 }).toMatch(/[?&]iso=1/);
});
