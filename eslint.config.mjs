// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const universalIgnores = [
  "built/**",
  "src/util/bitbang/**",
  "provisioner/**",
  "test/unit/fixtures/**",
  // Temporary: hides the four unported v3 modules (src/outputs/nec.js,
  // switchbots.js, thermal-printer.js, src/triggers/infrared.js), which do not
  // even resolve their imports. Drop this entry once they are ported to the v4
  // Step API.
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
  eslintConfigPrettier,
  {
    ignores: universalIgnores,
  },
);
