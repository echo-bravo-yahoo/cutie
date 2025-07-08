import { expect } from "chai";

import { setGlobals } from "../../src/index.js";
import Logs from "../../src/inputs/logs.js";
import Task from "../../src/util/Task.js";

describe("log matching", function () {
  before(() => {
    setGlobals({ name: "island", deeply: { nested: "metadata" } });
  });

  [
    {
      title: "matches when filter is a literal match",
      topic: "a.b.c.d",
      filters: ["a.b.c.d"],
      expected: true,
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
  ].forEach(({ title, topic, filters, expected }) => {
    it(title, async function () {
      const logHelper = new Logs({ type: "input:logs", filters }, {} as Task);
      expect(logHelper.shouldEmit(topic, "debug")).to.equal(expected);
    });
  });
});
