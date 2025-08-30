/**
 * @see https://prettier.io/docs/en/configuration.html
 * @see https://prettier.io/docs/en/options
 * @type {import("prettier").Config}
 */
const config = {
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  proseWrap: "preserve",
  endOfLine: "lf",
  embeddedLanguageFormatting: "auto",
  singleAttributePerLine: false,
};

module.exports = config;
