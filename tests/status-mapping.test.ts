import { describe, expect, it } from "vitest";
import {
  TASK_STATUSES,
  mapListsToStatuses,
  statusListSuggestions,
  STATUS_PATTERNS,
} from "../src/status-mapping.js";

function lists(...names: string[]) {
  return names.map((name, i) => ({ id: `L${i + 1}`, name, closed: false }));
}

describe("mapListsToStatuses", () => {
  it("maps a classic 5-list engineering board correctly", () => {
    const result = mapListsToStatuses(
      lists("Backlog", "In Progress", "QA", "Done", "Production"),
    );
    expect(result.mapping).toEqual({
      backlog: "L1",
      in_progress: "L2",
      qa: "L3",
      done: "L4",
      production_critical: "L5",
    });
    expect(result.unmapped).toEqual(["todo", "blocked", "review"]);
    expect(result.ambiguous).toEqual([]);
  });

  it("is case-insensitive", () => {
    const result = mapListsToStatuses(lists("BACKLOG", "doing", "dONe"));
    expect(result.mapping).toEqual({
      backlog: "L1",
      in_progress: "L2",
      done: "L3",
    });
  });

  it("recognizes common synonyms", () => {
    const result = mapListsToStatuses(
      lists("Inbox", "Up Next", "WIP", "On Hold", "Code Review", "Staging", "Completed", "Hotfix"),
    );
    expect(result.mapping.backlog).toBe("L1");
    expect(result.mapping.todo).toBe("L2");
    expect(result.mapping.in_progress).toBe("L3");
    expect(result.mapping.blocked).toBe("L4");
    expect(result.mapping.review).toBe("L5");
    expect(result.mapping.qa).toBe("L6");
    expect(result.mapping.done).toBe("L7");
    expect(result.mapping.production_critical).toBe("L8");
    expect(result.unmapped).toEqual([]);
  });

  it("reports unmapped statuses when no list matches", () => {
    const result = mapListsToStatuses(lists("Backlog", "Done"));
    expect(result.unmapped).toContain("in_progress");
    expect(result.unmapped).toContain("qa");
    expect(result.unmapped).toContain("production_critical");
    expect(result.mapping).toEqual({ backlog: "L1", done: "L2" });
  });

  it("flags ambiguous matches but still chooses the first one", () => {
    const result = mapListsToStatuses(
      lists("Done — Q1", "Done — Q2", "In Progress"),
    );
    expect(result.mapping.done).toBe("L1");
    expect(result.ambiguous).toEqual([
      { status: "done", chose: "Done — Q1", alternatives: ["Done — Q2"] },
    ]);
  });

  it("ignores closed (archived) lists", () => {
    const closedQa = { id: "X1", name: "QA Archive", closed: true };
    const openDone = { id: "L1", name: "Done", closed: false };
    const result = mapListsToStatuses([closedQa, openDone]);
    expect(result.mapping).toEqual({ done: "L1" });
    expect(result.unmapped).toContain("qa");
  });

  it("walks patterns in declared order — earlier pattern wins over a later one", () => {
    // "in progress" should match L1, not L2 ("doing"), because "in progress"
    // is the first pattern for in_progress.
    const result = mapListsToStatuses(lists("Doing", "In Progress"));
    // First pattern is "in progress" → matches L2.
    // L1 only matches the later "doing" pattern, so it doesn't win.
    expect(result.mapping.in_progress).toBe("L2");
  });

  it("returns an empty mapping for an empty board", () => {
    const result = mapListsToStatuses([]);
    expect(result.mapping).toEqual({});
    expect(result.unmapped).toEqual([...TASK_STATUSES]);
  });

  it("STATUS_PATTERNS covers every TaskStatus", () => {
    for (const status of TASK_STATUSES) {
      expect(STATUS_PATTERNS[status]).toBeDefined();
      expect(STATUS_PATTERNS[status]!.length).toBeGreaterThan(0);
    }
  });

  it("never assigns the same list to two statuses (claim tracking)", () => {
    // "Production QA" matches `qa` (pattern "qa") AND `production_critical`
    // (pattern "production"). The first status in declaration order — `qa` —
    // claims it; `production_critical` falls through to `unmapped`.
    const result = mapListsToStatuses(lists("Production QA"));
    expect(result.mapping).toEqual({ qa: "L1" });
    expect(result.unmapped).toContain("production_critical");
    // The list id is mapped to exactly one status.
    const claimedIds = Object.values(result.mapping);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });

  it("when a list could fit two statuses, the *next* matching list is available for the second", () => {
    // "Production QA" → qa.
    // "Production" → production_critical (no longer competes with qa).
    const result = mapListsToStatuses(lists("Production QA", "Production"));
    expect(result.mapping.qa).toBe("L1");
    expect(result.mapping.production_critical).toBe("L2");
  });
});

describe("statusListSuggestions", () => {
  it("returns capitalized human-readable variants of the lowercase patterns", () => {
    expect(statusListSuggestions("backlog")).toEqual([
      "Backlog",
      "Inbox",
      "Ideas",
      "Future",
    ]);
    expect(statusListSuggestions("in_progress")).toEqual([
      "In Progress",
      "Doing",
      "WIP",
      "Working",
    ]);
    expect(statusListSuggestions("qa")).toEqual([
      "QA",
      "Staging",
      "Testing",
      "Test",
    ]);
    expect(statusListSuggestions("production_critical")).toEqual([
      "Production",
      "Hotfix",
      "Critical",
      "Incident",
      "Urgent",
    ]);
  });

  it("trims trailing whitespace and renders known acronyms in all caps", () => {
    const review = statusListSuggestions("review");
    // STATUS_PATTERNS.review = ["in review", "code review", "review", "pr "]
    expect(review).toEqual(["In Review", "Code Review", "Review", "PR"]);
  });

  it("provides a suggestion for every status (no missing keys)", () => {
    for (const status of TASK_STATUSES) {
      expect(statusListSuggestions(status).length).toBeGreaterThan(0);
    }
  });
});
