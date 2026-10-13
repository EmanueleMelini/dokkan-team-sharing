import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // lib/cache/* sta dietro 'use cache': la chiave e i tag finiscono in
  // chiaro e il risultato e' servito a tutti. Niente sessione, cookie o
  // header qui dentro, ne' moduli che li leggono: un id utente in una voce
  // di cache servirebbe i dati di uno a chiunque.
  {
    files: ["lib/cache/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "next/headers", message: "lib/cache/* non legge la richiesta: niente cookies() o headers()." },
          { name: "@/lib/dal", message: "lib/cache/* non conosce l'utente: la sessione resta fuori dalla cache." },
          { name: "@/lib/versione/server", message: "lib/cache/* non conosce chi guarda: la versione del sito resta fuori dalla cache." },
        ],
        patterns: [{ group: ["@/lib/auth/*", "@/lib/auth"], message: "lib/cache/* non dipende dall'accesso." }],
      }],
    },
  },
  // La versione del sito (il cookie dts_version) la leggono solo le Server
  // Action, le rotte e le pagine per utente: una pagina pubblica che la
  // leggesse sarebbe diversa per chi guarda e uscirebbe dalla cache. Nelle
  // pagine pubbliche la versione arriva dallo script del <head> (data-reg)
  // e dal CSS, o dalle isole client.
  {
    files: ["components/**", "app/layout.tsx", "app/not-found.tsx", "app/sitemap.ts", "app/events/**",
      "app/cards/**", "app/users/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@/lib/versione/server", message: "Le pagine pubbliche non leggono il cookie della versione: usa data-reg (lib/versione/versione.ts) o un'isola client." }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
