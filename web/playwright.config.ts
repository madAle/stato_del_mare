import { defineConfig, devices } from "@playwright/test";

/**
 * Configurazione di Playwright per i due smoke test end to end (task 16).
 *
 * Tre cose non ovvie, spiegate qui perche' altrove non c'e' un posto naturale
 * dove scriverle:
 *
 * 1. Il server di sviluppo parte con VITE_E2E=1: e' la variabile che
 *    src/main.tsx legge per montare l'applicazione con uno stile minimo
 *    locale invece della basemap vettoriale vera. La basemap pesa 700 MB e
 *    non e' pubblicata sul bucket (decisione dell'utente): con lo stile
 *    predefinito `creaMappa` rifiuterebbe sempre in questo ambiente, prima
 *    ancora di arrivare al codice che questi test vogliono verificare.
 * 2. `--use-gl=angle --enable-unsafe-swiftshader` da' un contesto WebGL2 vero
 *    a Chromium headless. Senza questi due flag i test falliscono per la
 *    mancanza di una GPU, un motivo che non ha niente a che fare con
 *    l'applicazione sotto test.
 * 3. `workers: 1`: i due file aprono lo stesso server di sviluppo e leggono lo
 *    stesso bucket pubblico; non condividono stato fra loro, ma non c'e'
 *    nessun vantaggio a parallelizzare due soli file e la seriale e' piu'
 *    facile da leggere quando fallisce.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5183",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "build.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Il bundle compilato e' un altro programma: un difetto che vive solo
      // li' (vedi e2e/build.spec.ts) non lo vede nessun test sul dev server.
      name: "build",
      testMatch: "build.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5184" },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 5183 --strictPort",
      url: "http://localhost:5183",
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: "1" },
    },
    {
      command: "npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 5184 --strictPort",
      url: "http://localhost:5184",
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: "1" },
      timeout: 120_000,
    },
  ],
});
