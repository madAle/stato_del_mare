import { defineConfig } from "vitest/config";

// jsdom solo dove serve: gli strati puri girano in Node, ed e' proprio il
// punto di tenerli puri.
//
// Nota: "environmentMatchGlobs" e' stato rimosso in Vitest 4 (la versione
// installata da questo progetto), sostituito da "projects". Ogni progetto
// definisce il proprio glob e il proprio environment; quello di default deve
// escludere src/ui esplicitamente, altrimenti un file la' dentro girerebbe
// due volte.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/ui/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "default",
          environment: "node",
          exclude: ["src/ui/**", "node_modules/**"],
        },
      },
    ],
  },
});
