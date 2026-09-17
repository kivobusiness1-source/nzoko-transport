import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // ============================================================
    // Gardes-fous qualité RÉARMÉS (audit d'architecture Task 11 —
    // ~25 règles avaient été désarmées au démarrage du projet).
    // Volontairement maintenus désarmés :
    //   - react-compiler/react-compiler + react-hooks/purity (expérimentaux, bruit)
    //   - no-undef (géré par TypeScript, doublon en JS)
    //   - no-unused-disable-directive (différences de comportement ESLint v9)
    // ============================================================

    // TypeScript — strict
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
    ],
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/ban-ts-comment": [
      "error",
      { "ts-expect-error": "allow-with-description", "ts-ignore": true },
    ],
    "@typescript-eslint/prefer-as-const": "error",

    // React — hooks et JSX
    "react-hooks/exhaustive-deps": "warn",
    "react/no-unescaped-entities": "error",

    // Next.js
    "@next/next/no-img-element": "warn",

    // Bugs objectifs JavaScript
    "prefer-const": "error",
    "no-debugger": "error",
    "no-unreachable": "error",
    "no-fallthrough": "error",
    "no-redeclare": "error",
    "no-useless-escape": "error",
    "no-case-declarations": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-irregular-whitespace": "error",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-console": ["error", { allow: ["warn", "error"] }],
  },
}, {
  // prisma/seed.ts + scripts/*.ts : scripts CLI one-shot — les console.*
  // affichent la progression d'installation (comptes, villes, voyages) et
  // les assertions non-null reflètent le contrat interne garanti par le
  // script lui-même (les villes/agences viennent d'être créées dans le même run).
  files: ["prisma/seed.ts", "scripts/**/*.ts"],
  rules: {
    "no-console": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
  },
}, {
  // mini-services/*.ts : services daemon CLI (socket.io GPS…) — les console.*
  // tracent les démarrages/ports dans les logs du service (exploitation).
  files: ["mini-services/**/*.ts"],
  rules: {
    "no-console": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
