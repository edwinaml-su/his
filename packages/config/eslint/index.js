/**
 * Config ESLint base del monorepo HIS.
 * - TypeScript estricto.
 * - React hooks.
 * - Reglas mínimas, sin opinions estéticas (Prettier hace formato).
 */
module.exports = {
  root: false,
  env: { es2022: true, node: true, browser: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  settings: { react: { version: "detect" } },
  rules: {
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/consistent-type-imports": "warn",
    "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    // Permite `@ts-nocheck` con descripción ≥10 chars (migraciones progresivas).
    // El equipo debe documentar por qué se suspende el typecheck en un archivo.
    "@typescript-eslint/ban-ts-comment": [
      "error",
      {
        "ts-nocheck": "allow-with-description",
        "ts-expect-error": "allow-with-description",
        "ts-ignore": true,
        "ts-check": false,
        minimumDescriptionLength: 10,
      },
    ],
  },
  ignorePatterns: ["dist", "node_modules", ".next", "*.config.*"],
};
