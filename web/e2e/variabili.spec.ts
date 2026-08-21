import { expect, test } from "@playwright/test";

/**
 * Cambiare grandezza disegnata.
 *
 * Non e' "accendere un layer": cambia la scala dei valori grezzi (millesimi di
 * metro contro centesimi di secondo), la cima della legenda, l'unita', se il
 * numero porta lo stato del mare, e se le isolinee hanno senso. Ognuna di
 * queste, sbagliata, non si vede come un errore: si vede come un mare diverso.
 */

type Mappa = { querySourceFeatures(id: string): unknown[] };

async function pronta(page: import("@playwright/test").Page, query: string) {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as never as { __primoFrame: boolean }).__primoFrame);
  await page.waitForTimeout(2000);
}

test("passando al periodo cambiano scala, unita', numero e isolinee", async ({ page }) => {
  const errori: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });

  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6");
  await page.locator("canvas").first().click({ position: { x: 640, y: 380 } });
  await expect(page.locator(".valore")).toHaveText(/m · /, { timeout: 8000 });
  await expect.poll(() => page.evaluate(
    () => (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee").length,
  ), { timeout: 20_000 }).toBeGreaterThan(0);

  await page.getByLabel("variabile").selectOption("pwave");
  await page.waitForTimeout(6000);

  // La legenda dev'essere quella del periodo, non quella dell'onda: 8 s, non 4 m.
  await expect(page.locator(".legenda")).toContainText("8 s");
  // Il numero non porta piu' lo stato del mare: un periodo in secondi non e'
  // "poco mosso", e appiccicarglielo sarebbe una cosa falsa accanto a una vera.
  // Un decimale solo: il passo e' mezzo secondo, e "4,50 s" prometterebbe
  // centesimi che il modello non produce.
  await expect(page.locator(".valore")).toHaveText(/^\d+,\d s$/);
  // Le isolinee sono i confini Douglas in metri d'onda: su un campo di secondi
  // una linea a 0,5 m affermerebbe una cosa falsa, quindi spariscono e il
  // comando che le accende si disabilita invece di restare li' a mentire.
  expect(await page.evaluate(
    () => (window as never as { __mappa: Mappa }).__mappa.querySourceFeatures("isolinee").length,
  )).toBe(0);
  await expect(page.getByLabel("isolinee")).toBeDisabled();

  expect(errori, "errori in console cambiando grandezza").toEqual([]);
});

test("il periodo a mezz'ora esatta e' quello dell'ora piu' vicina, non uno in mezzo", async ({ page }) => {
  // Il periodo non si dissolve fra un'ora e l'altra: prende i 17 valori della
  // griglia delle frequenze di SWAN, e interpolare fra due ore darebbe un
  // periodo che il modello non ha calcolato. E' la stessa regola per cui
  // l'orologio non scrive mai "09:37" su un dato orario.
  //
  // **Questo test non sa piu' trovare l'interpolazione, ed e' misurato.**
  // Prima del 2026-08-21 confrontava il numero a schermo con i 17 livelli a
  // tolleranza 0,005 s; da quando il periodo si scrive al mezzo secondo quel
  // confronto e' quasi vuoto (su 48 valori interpolati che non devono esistere
  // ne scarterebbe 4). E nemmeno l'uguaglianza qui sotto basta: rimettendo
  // `dissolvenza: true` su pwave, il 2026-08-21, questo test **passava
  // comunque**, perche' in questo punto il valore interpolato arrotondato cade
  // sullo stesso mezzo secondo di quello vero. E' il prezzo dell'arrotondamento
  // e non si paga qui: la prova esatta sta nei test unitari, dove non c'e'
  // nessun arrotondamento in mezzo (`oraPiuVicina` in test/sorgente.test.ts, e
  // il ramo di `valoreCorrente` che la chiama in test/valoreInterpolato.test.ts,
  // scritto appunto perche' questo test ha smesso di coprirlo).
  //
  // Quello che resta e' comunque vero e vale tenerlo: a mezz'ora esatta il
  // numero e' quello di un'ora vera, non uno inventato in mezzo.
  const leggi = async (istante: string) => {
    await pronta(page, `?t=2026-08-16T${istante}Z&z=7&c=44.2,13.6&p=44.2,13.6&var=pwave`);
    await expect(page.locator(".valore")).toHaveText(/\d s$/, { timeout: 8000 });
    return (await page.locator(".valore").textContent())!;
  };

  const mezzaOra = await leggi("12:30");
  const oraDopo = await leggi("13:00");
  const oraPrima = await leggi("12:00");

  // Le due ore devono dire numeri diversi, se no l'uguaglianza qui sotto
  // sarebbe vera anche interpolando e questo test non proverebbe niente.
  expect(oraPrima, "le 12:00 e le 13:00 mostrano lo stesso periodo").not.toBe(oraDopo);
  expect(mezzaOra, `12:30 mostra ${mezzaOra}, le 13:00 ${oraDopo}`).toBe(oraDopo);
});

test("un link con ?var=pwave apre direttamente il periodo", async ({ page }) => {
  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&var=pwave");
  await expect(page.getByLabel("variabile")).toHaveValue("pwave");
  await expect(page.locator(".legenda")).toContainText("8 s");
});

test("un link con una grandezza non disegnabile ricade sull'altezza d'onda", async ({ page }) => {
  // Aprire la mappa su una grandezza che non si sa disegnare lascerebbe la
  // legenda su un'unita' e il campo su un'altra fin dal primo render.
  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&var=dwave");
  await expect(page.getByLabel("variabile")).toHaveValue("hwave");
  await expect(page.locator(".legenda")).toContainText("4 m");
});

test("il livello del mare ha la scala col segno e una tavolozza divergente", async ({ page }) => {
  const errori: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });

  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&var=sealevel");
  await page.waitForTimeout(3000);

  // Con la scala ancorata a zero, meta' del fenomeno (tutta l'acqua sotto il
  // livello medio) finirebbe schiacciata nello stesso colore.
  await expect(page.locator(".legenda")).toContainText("-0,8 m");
  await expect(page.locator(".legenda")).toContainText("0,8 m");

  // Una grandezza con segno vuole una tavolozza divergente: con una sequenziale
  // lo zero non avrebbe nessun colore che lo distingue. Ce n'e' una sola,
  // quindi il comando resta ma disabilitato, invece di sparire.
  const tavolozza = page.getByLabel("tavolozza dei colori");
  await expect(tavolozza).toBeDisabled();
  await expect(tavolozza).toHaveValue("balance");

  expect(errori).toEqual([]);
});

test("una tavolozza scelta sull'onda non segue sul livello del mare", async ({ page }) => {
  // Il selettore mostrerebbe il nome di una tavolozza e la mappa ne
  // disegnerebbe un'altra: due parti dello schermo che si contraddicono.
  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&palette=amp");
  await expect(page.getByLabel("tavolozza dei colori")).toHaveValue("amp");

  await page.getByLabel("variabile").selectOption("sealevel");
  await page.waitForTimeout(3000);
  await expect(page.getByLabel("tavolozza dei colori")).toHaveValue("balance");
});

/**
 * L'animazione della direzione dell'onda.
 *
 * Si guardano i numeri del livello e non i pixel: un'animazione che non si vede
 * puo' essere spenta per cinque ragioni diverse, e a schermo sono tutte
 * identiche, cioe' niente. La prima volta trovare quella giusta e' costato
 * un'ora, e la ragione vera (le scie erano lunghe un quarto di pixel) da uno
 * screenshot non si sarebbe vista mai.
 */
type Livello = { implementation?: { diagnosi: Record<string, number | boolean> } };

test("le particelle della direzione si muovono davvero", async ({ page }) => {
  const errori: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });
  page.on("pageerror", (e) => errori.push(String(e)));

  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&dir=1&iso=0");
  const diagnosi = async () => page.evaluate(() => {
    const l = (window as never as { __mappa: { getLayer(id: string): Livello } })
      .__mappa.getLayer("direzione-onda");
    return l?.implementation?.diagnosi ?? null;
  });
  await expect.poll(async () => (await diagnosi())?.vertici ?? 0, { timeout: 25_000 })
    .toBeGreaterThan(1000);

  const d = (await diagnosi())!;
  expect(d.campi, "i tre campi non sono arrivati").toBe(true);
  expect(d.particelle, "nessuna particella e' nata").toBeGreaterThan(100);
  // Il fattore di velocita' dipende dallo zoom: se fosse zero le particelle
  // starebbero ferme, e a schermo sarebbe identico a "non ci sono".
  expect(d.fattore, "le particelle sono ferme").toBeGreaterThan(0);
  expect(d.pixelPerCella, "la scala della griglia non e' nota").toBeGreaterThan(0);
  expect(errori).toEqual([]);
});

test("spegnendo la direzione le particelle spariscono e non si calcolano piu'", async ({ page }) => {
  await pronta(page, "?t=2026-08-16T12:00Z&z=7&c=44.2,13.6&dir=1&iso=0");
  const vertici = async () => page.evaluate(() => {
    const l = (window as never as { __mappa: { getLayer(id: string): Livello } })
      .__mappa.getLayer("direzione-onda");
    return l?.implementation?.diagnosi.vertici ?? 0;
  });
  await expect.poll(vertici, { timeout: 25_000 }).toBeGreaterThan(1000);

  await page.getByLabel("direzione").uncheck();
  await page.waitForTimeout(1500);
  expect(await vertici(), "le particelle continuano a girare da spente").toBe(0);
  await expect.poll(() => page.evaluate(() => location.search), { timeout: 5000 }).toMatch(/dir=0/);
});
