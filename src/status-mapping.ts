export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "qa"
  | "done"
  | "production_critical";

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "review",
  "qa",
  "done",
  "production_critical",
] as const satisfies readonly TaskStatus[];

/**
 * Ordered substring patterns per status. Match is case-insensitive. For each
 * status, the first pattern that matches any open list wins.
 */
export const STATUS_PATTERNS: Record<TaskStatus, readonly string[]> = {
  backlog: ["backlog", "inbox", "ideas", "future"],
  todo: ["to do", "todo", "up next", "next", "ready"],
  in_progress: ["in progress", "doing", "wip", "working"],
  blocked: ["blocked", "on hold", "waiting", "stuck"],
  review: ["in review", "code review", "review", "pr "],
  qa: ["qa", "staging", "testing", "test"],
  done: ["done", "completed", "shipped", "closed"],
  production_critical: ["production", "hotfix", "critical", "incident", "urgent"],
};

/** Words inside STATUS_PATTERNS that should render as all-caps acronyms. */
const ACRONYMS = new Set(["qa", "wip", "pr"]);

/**
 * Human-friendly list-name suggestions for a status, derived from its
 * patterns. Capitalizes the first letter of each word, but renders known
 * acronyms (QA, WIP, PR) in all caps, and strips trailing whitespace.
 *   "in progress" -> "In Progress"
 *   "qa"          -> "QA"
 *   "pr "         -> "PR"
 */
export function statusListSuggestions(status: TaskStatus): string[] {
  return STATUS_PATTERNS[status].map((p) =>
    p
      .trim()
      .split(/\s+/)
      .map((word) => {
        if (word.length === 0) return word;
        if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
        return word[0]!.toUpperCase() + word.slice(1);
      })
      .join(" "),
  );
}

export interface InputList {
  id: string;
  name: string;
  closed: boolean;
}

export interface MappingResult {
  mapping: Partial<Record<TaskStatus, string>>;
  unmapped: TaskStatus[];
  /** When more than one open list matched a status's chosen pattern. */
  ambiguous: Array<{ status: TaskStatus; chose: string; alternatives: string[] }>;
}

/**
 * Map open lists to statuses. For each status in declaration order:
 *  1. Walk its patterns in order.
 *  2. Find all *unclaimed* open lists whose lowercased name contains the
 *     pattern.
 *  3. If 1+ match, take the first (by the order Trello returned the lists,
 *     which mirrors board order) and record alternatives as `ambiguous`.
 *     The chosen list is then claimed — later statuses skip it.
 *  4. If no pattern matches anywhere (after claims), the status is
 *     `unmapped`.
 *
 * Claim tracking means a list named ambiguously (e.g. "Production QA")
 * goes to the *first* status it matches in declaration order (`qa` before
 * `production_critical`), never to both. Predictable, inspectable, and the
 * `unmapped` array makes the trade-off visible.
 */
export function mapListsToStatuses(lists: readonly InputList[]): MappingResult {
  const open = lists.filter((l) => !l.closed);
  const claimed = new Set<string>();
  const mapping: Partial<Record<TaskStatus, string>> = {};
  const unmapped: TaskStatus[] = [];
  const ambiguous: MappingResult["ambiguous"] = [];

  for (const status of TASK_STATUSES) {
    const patterns = STATUS_PATTERNS[status];
    let matchedLists: InputList[] = [];
    for (const pattern of patterns) {
      const lower = pattern.toLowerCase();
      matchedLists = open.filter(
        (l) => !claimed.has(l.id) && l.name.toLowerCase().includes(lower),
      );
      if (matchedLists.length > 0) break;
    }
    if (matchedLists.length === 0) {
      unmapped.push(status);
      continue;
    }
    const [chosen, ...rest] = matchedLists;
    mapping[status] = chosen!.id;
    claimed.add(chosen!.id);
    if (rest.length > 0) {
      ambiguous.push({
        status,
        chose: chosen!.name,
        alternatives: rest.map((l) => l.name),
      });
    }
  }

  return { mapping, unmapped, ambiguous };
}
