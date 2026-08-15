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

// Logs.matches ignores the verbosity argument it is handed, so a filter
// currently decides purely on topic. These cases pin that CURRENT behavior
// across every level; when verbosity filtering is implemented they are the
// tests that should change.
test("log matching is verbosity-independent today", { concurrency: true }, (testContext) => {
  for (const verbosity of ALL_VERBOSITIES) {
    testContext.test(`a matching topic emits at "${verbosity}"`, () => {
      const logHelper = new Logs(
        { type: "trigger:logs", filters: ["a.b.c.d"] },
        mockTask,
      );
      expect(logHelper.shouldEmit("a.b.c.d", verbosity)).to.equal(true);
    });

    testContext.test(`a non-matching topic is silent at "${verbosity}"`, () => {
      const logHelper = new Logs(
        { type: "trigger:logs", filters: ["z"] },
        mockTask,
      );
      expect(logHelper.shouldEmit("a.b.c.d", verbosity)).to.equal(false);
    });
  }
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
