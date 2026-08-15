import { expect } from "chai";

import Logs from "../../src/triggers/logs.js";

import { test } from "node:test";
import { mockTask } from "../helpers.js";
import { Verbosity } from "../../src/triggers/logs.js";

test("log matching", { concurrency: true }, (testContext) => {
  for (const { title, topic, filters, expected, verbosity } of logTestCases) {
    testContext.test(title, () => {
      const logHelper = new Logs({ type: "trigger:logs", filters }, mockTask);
      expect(
        logHelper.shouldEmit(topic, (verbosity ?? "debug") as Verbosity),
      ).to.equal(expected);
    });
  }
});

const ALL_VERBOSITIES: Array<Verbosity> = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];

// A config that omits minVerbosity emits at every level, so adding verbosity
// filtering did not change what an existing config sees.
test(
  "log matching without a minVerbosity",
  { concurrency: true },
  (testContext) => {
    for (const verbosity of ALL_VERBOSITIES) {
      testContext.test(`a matching topic emits at "${verbosity}"`, () => {
        const logHelper = new Logs(
          { type: "trigger:logs", filters: ["a.b.c.d"] },
          mockTask,
        );
        expect(logHelper.shouldEmit("a.b.c.d", verbosity)).to.equal(true);
      });

      testContext.test(
        `a non-matching topic is silent at "${verbosity}"`,
        () => {
          const logHelper = new Logs(
            { type: "trigger:logs", filters: ["z"] },
            mockTask,
          );
          expect(logHelper.shouldEmit("a.b.c.d", verbosity)).to.equal(false);
        },
      );
    }
  },
);

test("log matching with a minVerbosity", { concurrency: true }, (testContext) => {
  // ranked trace < debug < info < warn < error < fatal
  const atOrAbove: Array<Verbosity> = ["warn", "error", "fatal"];
  const below: Array<Verbosity> = ["trace", "debug", "info"];

  const logHelper = () =>
    new Logs(
      { type: "trigger:logs", filters: ["*"], minVerbosity: "warn" },
      mockTask,
    );

  for (const verbosity of atOrAbove) {
    testContext.test(`emits at "${verbosity}"`, () => {
      expect(logHelper().shouldEmit("a.b.c.d", verbosity)).to.equal(true);
    });
  }

  for (const verbosity of below) {
    testContext.test(`is silent at "${verbosity}"`, () => {
      expect(logHelper().shouldEmit("a.b.c.d", verbosity)).to.equal(false);
    });
  }

  testContext.test("still requires the topic filter to match", () => {
    const narrow = new Logs(
      { type: "trigger:logs", filters: ["z"], minVerbosity: "trace" },
      mockTask,
    );
    expect(narrow.shouldEmit("a.b.c.d", "fatal")).to.equal(false);
  });
});

const logTestCases: Array<{
  title: string;
  topic: string;
  filters: Array<string>;
  expected: boolean;
  verbosity?: Verbosity;
}> = [
  {
    title: "matches when filter is a literal match",
    topic: "a.b.c.d",
    filters: ["a.b.c.d"],
    expected: true,
  },
  {
    title: "matches a wildcard filter at the error level",
    topic: "core.registration.connections",
    filters: ["*"],
    expected: true,
    verbosity: "error",
  },
  {
    title: "respects a negated filter at the fatal level",
    topic: "core.registration.connections",
    filters: ["*", "!core.registration.*"],
    expected: false,
    verbosity: "fatal",
  },
  {
    title: "doesn't match when filter is a literal non-match",
    topic: "a.b.c.d",
    filters: ["z"],
    expected: false,
  },
  {
    title:
      "doesn't match for filters with a wildcard match and a specific negated match",
    topic: "a.b.c.d",
    filters: ["*", "!a.b.c.d", "unrelated"],
    expected: false,
  },
  {
    title:
      "matches for filters with a wildcard negated match and a specific match",
    topic: "a.b.c.d",
    filters: ["!*", "a.b.c.d", "unrelated"],
    expected: true,
  },
  {
    title: "defaults to not matching",
    topic: "a.b.c.d",
    filters: [],
    expected: false,
  },
  {
    title: "can match lone wildcards",
    topic: "a.b.c.d",
    filters: ["*"],
    expected: true,
  },
  {
    title: "can match leading wildcards",
    topic: "a.b.c.d",
    filters: ["*c.d"],
    expected: true,
  },
  {
    title: "can match trailing wildcards",
    topic: "a.b.c.d",
    filters: ["a.b*"],
    expected: true,
  },
  {
    title: "can handle complex cases with many wildcards",
    topic: "a.b.c.d.e.f.g",
    filters: ["*c*f*"],
    expected: true,
  },
  {
    title: "does not match empty filter strings",
    topic: "a.b.c.d",
    filters: [""],
    expected: false,
  },
];
