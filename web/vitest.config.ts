import { defineConfig } from "vitest/config";

// jsdom solo dove serve: gli strati puri girano in Node, ed e' proprio il
// punto di tenerli puri.
//
// Nota: "environmentMatchGlobs" e' stato rimosso in Vitest 4 (la versione
// installata da questo progetto), sostituito da "projects". Ogni progetto
// definisce il proprio glob e il proprio environment; quello di default deve
// escludere le due cartelle di componenti esplicitamente, altrimenti un file
// la' dentro girerebbe due volte.
//
// I test dei componenti non vivono tutti sotto src/ui: alcuni, come
// web/test/ui/scrubber.test.tsx, stanno in una cartella dedicata dentro
// test/. Lo smistamento e' per cartella, non per estensione: una versione
// precedente smistava su jsdom solo i file test/**/*.tsx (l'estensione .tsx
// come segnale di "e' un componente"), che lasciava un varco vero, un test
// di componente scritto senza JSX (per esempio un test di hook, .ts) dentro
// test/ non sarebbe finito in nessuno dei due progetti per come erano scritti
// gli include/exclude di allora. Una cartella dedicata non lascia aperture:
// tutto cio' che ci sta dentro e' jsdom, qualunque estensione abbia.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/ui/**/*.{test,spec}.{ts,tsx}", "test/ui/**/*.{test,spec}.{ts,tsx}"],
          setupFiles: ["./test/setup-ui.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "default",
          environment: "node",
          // e2e/ sono spec di Playwright (task 16): senza escluderle, Vitest le
          // raccoglie con il proprio pattern predefinito e prova a eseguire
          // test() di Playwright dentro il proprio runner, che fallisce con un
          // errore che non c'entra niente con l'applicazione.
          exclude: ["src/ui/**", "test/ui/**", "node_modules/**", "e2e/**"],
        },
      },
    ],
  },
});
