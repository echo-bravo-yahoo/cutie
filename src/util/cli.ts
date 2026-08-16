import parser, { Arguments } from "yargs-parser";

export interface CLIArgs extends Arguments {
  config: string;
}

export type ParserDefaults = Pick<
  Required<parser.Options>,
  "string" | "default"
> &
  parser.Options;

export const parserDefaults: ParserDefaults = {
  string: ["config"],
  default: {
    config: `${process.cwd()}/cutie.conf.yaml`,
  },
};
