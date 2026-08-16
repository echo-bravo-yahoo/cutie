// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const universalIgnores = [
  // A git worktree is a full copy of the repo, so linting from the main
  // checkout would otherwise lint every sibling worktree's sources too. The
  // other patterns here are root-relative and so do not match inside one.
  "**/worktrees/**",
  "built/**",
  "provisioner/**",
  "test/unit/fixtures/**",
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
  eslintConfigPrettier,
  {
    ignores: universalIgnores,
  },
);
