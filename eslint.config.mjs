// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const universalIgnores = [
  "**/worktrees/**",
  "built/**",
  "provisioner/**",
  "src/util/bitbang/**",
  "test/unit/fixtures/**",
  // Scratch and investigation artifacts. Gitignored globally, so linting them
  // only breaks `npm run lint` for whoever happens to have files there.
  "echobravoyahoo/**",
  "**/*.js",
];

export default tseslint.config(
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "no-empty": [
        "error",
        {
          allowEmptyCatch: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-empty-object-type": [
        "error",
        {
          allowInterfaces: "always",
        },
      ],
      "@typescript-eslint/no-explicit-any": ["warn"],
    },
  },
  {
    files: ["test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // The provisioner, the example scripts, and the reference generator are
    // plain Node ESM run from the CLI, not part of the TypeScript build, so
    // they need Node's globals declared explicitly.
    files: ["provisioner/**/*.mjs", "examples/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  eslintConfigPrettier,
  {
    ignores: universalIgnores,
  },
);
