// Every encoding node's fs accepts, so a typo in a config is caught before any
// file is opened. Shared by read:file and output:file.
export const ENCODINGS = [
  "ascii",
  "utf8",
  "utf-8",
  "utf16le",
  "utf-16le",
  "ucs2",
  "ucs-2",
  "base64",
  "base64url",
  "latin1",
  "binary",
  "hex",
];
