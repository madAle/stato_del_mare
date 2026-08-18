import { defineConfig } from "vitest/config";

// jsdom solo dove serve: gli strati puri girano in Node, ed e' proprio il
// punto di tenerli puri.
//
// Nota: "environmentMatchGlobs" e' stato rimosso in Vitest 4 (la versione
// installata da questo progetto), sostituito da "projects". Ogni progetto
// definisce il proprio glob e il proprio environment; quello di default deve
// escludere src/ui esplicitamente, altrimenti un file la' dentro girerebbe
// due volte.
//
// I test dei componenti pero' non vivono tutti sotto src/ui: alcuni, come
// web/test/scrubber.test.tsx, stanno in test/ insieme al resto della
// suite. L'estensione .tsx e' il segnale giusto per smistarli su jsdom
// (implica JSX, quindi quasi certamente un componente), mentre .ts resta un
// test di uno strato puro e continua a girare su Node.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/ui/**/*.{test,spec}.{ts,tsx}", "test/**/*.{test,spec}.tsx"],
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
          exclude: ["src/ui/**", "test/**/*.tsx", "node_modules/**", "e2e/**"],
        },
      },
    ],
  },
});
