// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const universalIgnores = [
  "built/**",
  "src/util/bitbang/**",
  "provisioner/**",
  "test/util/fixtures/**",
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
    ignores: universalIgnores,
  }
);
