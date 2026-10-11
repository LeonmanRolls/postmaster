// Print the record's tables from the derived data (see ../method.md). A reader without the run
// folders runs this alone and gets every table.
//
//   bun --no-env-file --config=/dev/null render.ts --results <dir> --cut <iso> [--after <iso>]
//
// `--cut` ends the set the tables are about and `--after`, with it, makes the later set the stop
// signals are tried on.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bands,
  CHANGE_BANDS,
  CRITERIA_BANDS,
  changeBand,
  correlations,
  criteriaBand,
  eraOf,
  type RunInput,
  roundsSummary,
  structure,
} from "./analysis.ts";
import type { RunRow } from "./inventory.ts";
import { type LeverFinding, type LeverRun, leverEffect } from "./levers.ts";
import { agreement, type Combined, combine, KINDS, type Mark, parseMarks } from "./marks.ts";
import { type Item, itemsOf } from "./packets.ts";
import {
  type CommitFact,
  type FindingFact,
  RULES,
  type RunFacts,
  signalRows,
  simulate,
  transitions,
} from "./signals.ts";
import { median, pct, permutationP, sum, wilson } from "./stats.ts";
import type { RunMeta, TracedFinding } from "./trace.ts";

type Traced = { cut: string; runs: RunMeta[]; findings: TracedFinding[] };

const num = (x: number, d = 2): string => (Number.isNaN(x) ? "–" : x.toFixed(d));
const link = (run: string): string =>
  `[#${run}](https://github.com/brindlewick/postmaster/issues/${run})`;

export function inputsOf(rows: readonly RunRow[], traced: Traced): RunInput[] {
  const metaOf = new Map(traced.runs.map((m) => [m.run, m]));
  return rows.map((r) => {
    const meta = metaOf.get(r.run);
    const change = (meta?.commits ?? []).filter((c) => c.phase === "change" && !c.onMain);
    const fix = (meta?.commits ?? []).filter((c) => c.phase.startsWith("fix") && !c.onMain);
    return {
      run: r.run,
      mode: r.mode,
      shape: r.ticket?.shape ?? null,
      rounds: r.rounds,
      best: r.seriousBest,
      lines: r.seriousByRound,
      criteria: r.ticket?.criteria ?? null,
      decisions: r.ticket ? r.ticket.decisions : null,
      checks: r.ticket ? r.ticket.checks : null,
      notes: r.ticket ? r.ticket.notes : null,
      chars: r.ticket?.chars ?? null,
      changeLines: meta ? sum(change.map((c) => c.added + c.deleted)) : null,
      changeFiles: meta ? new Set(change.flatMap((c) => c.paths)).size : null,
      fixLines: meta ? sum(fix.map((c) => c.added + c.deleted)) : null,
      dispatchedAt: r.dispatchedAt,
    };
  });
}

export function factsOf(rows: readonly RunRow[], traced: Traced): RunFacts[] {
  const metaOf = new Map(traced.runs.map((m) => [m.run, m]));
  return rows.map((r) => {
    const findings: FindingFact[] = traced.findings
      .filter((f) => f.run === r.run)
      .map((f) => ({
        round: f.round,
        severity: f.severity,
        lanes: f.lanes,
        file: f.file,
        group: f.group,
      }));
    const commits: CommitFact[] = (metaOf.get(r.run)?.commits ?? []).map((c) => ({
      phase: c.phase,
      added: c.added,
      deleted: c.deleted,
      paths: c.paths,
      onMain: c.onMain,
    }));
    const lanes = r.reviewers.filter((l) => !r.security.includes(l) || r.reviewers.length <= 2);
    const pair: [string, string] | null =
      lanes.length >= 2 ? [lanes[0] as string, lanes[1] as string] : null;
    return { run: r.run, rounds: r.rounds, pair, best: r.seriousBest, findings, commits };
  });
}

const table = (head: string[], rows: string[][]): string =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

export function roundsMarkdown(inputs: readonly RunInput[]): string {
  const out: string[] = [];
  out.push("# Review rounds of the 61 runs", "");
  out.push(
    "A *round* is the highest round any launch, harvest or finding line, or any review file, names. A *serious finding* is a gating P1 or P2 the coachman did not dismiss. *Best* is the finding lines, with the run's own figure for the rounds the lines miss ([method.md](../method.md#what-is-counted)).",
    "",
  );
  const groups = new Map<string, RunInput[]>();
  for (const r of inputs) {
    const e = eraOf(r);
    groups.set(e, [...(groups.get(e) ?? []), r]);
  }
  const head = [
    "Group",
    "Runs",
    "Rounds, median",
    "Rounds, mean",
    "Most",
    "2 or fewer",
    "3",
    "4 or 5",
    "6 or more",
    "Round 1 serious, median",
  ];
  const rowOf = (name: string, rs: readonly RunInput[]): string[] => {
    const s = roundsSummary(rs);
    return [
      name,
      String(s.n),
      String(s.median),
      num(s.mean, 1),
      String(s.max),
      String(s.twoOrFewer),
      String(s.three),
      String(s.fourOrFive),
      String(s.sixOrMore),
      String(s.firstRoundMedian),
    ];
  };
  const rows = [...groups.keys()].sort().map((g) => rowOf(g, groups.get(g) as RunInput[]));
  rows.push(rowOf("All", inputs));
  out.push(table(head, rows), "");
  const st = structure(inputs);
  const total = sum(inputs.map((r) => r.rounds));
  out.push(
    `Of ${total} rounds, ${st.working} come up to and including each run's last round with a serious finding and ${st.confirming} come after it. ${st.endedOnFinding} runs ended on a round that still held a serious finding, ${st.byConfirming[1] ?? 0} had one round after their last, ${st.byConfirming[2] ?? 0} two. ${st.noFindingRoundOne} runs had no serious finding in round 1.`,
    "",
  );
  const long = inputs.filter((r) => r.rounds >= 6);
  out.push(
    `The ${long.length} runs of six rounds or more are ${pct(long.length, inputs.length)} of the runs and hold ${pct(sum(long.map((r) => r.rounds)), total)} of the rounds.`,
    "",
  );
  out.push("## One row per run", "");
  out.push(
    table(
      [
        "Run",
        "Group",
        "Rounds",
        "Serious by round (best)",
        "Round 1 serious",
        "Criteria",
        "Change lines",
      ],
      [...inputs]
        .sort((a, b) => (a.dispatchedAt ?? "").localeCompare(b.dispatchedAt ?? ""))
        .map((r) => [
          link(r.run),
          eraOf(r).slice(0, 1),
          String(r.rounds),
          r.best.join(", "),
          String(r.best[0] ?? 0),
          r.criteria === null ? "–" : String(r.criteria),
          r.changeLines === null ? "–" : String(r.changeLines),
        ]),
    ),
    "",
  );
  return out.join("\n");
}

export function featuresMarkdown(inputs: readonly RunInput[]): string {
  const out: string[] = [];
  out.push("# What a ticket carried, against the rounds its run took", "");
  out.push(
    "Spearman's rho over the runs that have the feature. A rank correlation is a rough guide at these sizes, and a ticket's size sets its criteria, its change and its first round together.",
    "",
  );
  const rowOf = (name: string, rs: readonly RunInput[]): string[][] =>
    correlations(rs).map((c) => [name, c.feature, String(c.n), num(c.rounds), num(c.first)]);
  out.push(
    table(
      ["Runs", "Feature", "n", "rho with rounds", "rho with round 1's serious findings"],
      [
        ...rowOf("all 61", inputs),
        ...rowOf(
          "several workhorses",
          inputs.filter((r) => r.mode === "synthesis"),
        ),
        ...rowOf(
          "single thread",
          inputs.filter((r) => r.mode === "single-thread"),
        ),
      ],
    ),
    "",
  );
  out.push("## Rounds by the number of acceptance criteria", "");
  for (const [label, sel] of [
    ["all runs", () => true],
    ["several workhorses", (r: RunInput) => r.mode === "synthesis"],
    ["single thread", (r: RunInput) => r.mode === "single-thread"],
  ] as const) {
    const rows = bands(inputs.filter(sel), criteriaBand, CRITERIA_BANDS).map((b) => [
      b.band,
      String(b.n),
      String(b.median),
      String(b.atLeastFive),
      String(b.firstMedian),
      String(b.max),
    ]);
    out.push(
      `**${label}**`,
      "",
      table(
        [
          "Criteria",
          "Runs",
          "Rounds, median",
          "Runs of 5 or more",
          "Round 1 serious, median",
          "Most",
        ],
        rows,
      ),
      "",
    );
  }
  out.push("## Rounds by lines changed before the first review", "");
  {
    const rows = bands(inputs, changeBand, CHANGE_BANDS).map((b) => [
      b.band,
      String(b.n),
      String(b.median),
      String(b.atLeastFive),
      String(b.firstMedian),
      String(b.max),
    ]);
    out.push(
      table(
        [
          "Lines changed",
          "Runs",
          "Rounds, median",
          "Runs of 5 or more",
          "Round 1 serious, median",
          "Most",
        ],
        rows,
      ),
      "",
    );
  }
  out.push("## How the ticket was prepared", "");
  const groupA = inputs.filter((r) => eraOf(r).startsWith("A"));
  const groupB = inputs.filter((r) => eraOf(r).startsWith("B"));
  const groupC = inputs.filter((r) => eraOf(r).startsWith("C"));
  out.push(preparationMarkdown(groupA, groupB, "one-part ticket", "two-part ticket"));
  out.push(
    preparationMarkdown(
      groupA,
      groupC,
      "several workhorses, one-part ticket",
      "single thread, two-part ticket",
    ),
  );
  const few = inputs.filter((r) => r.criteria !== null && r.criteria <= 3);
  const many = inputs.filter((r) => r.criteria !== null && r.criteria > 3);
  out.push(
    `Runs with 3 criteria or fewer took a median ${median(few.map((r) => r.rounds))} rounds (${few.length} runs, most ${Math.max(...few.map((r) => r.rounds))}); the rest ${median(many.map((r) => r.rounds))} (${many.length} runs). One-sided permutation p for the mean, 20,000 shuffles, seed 400: ${num(
      permutationP(
        many.map((r) => r.rounds),
        few.map((r) => r.rounds),
      ),
      4,
    )}.`,
    "",
  );
  return out.join("\n");
}

/** Two groups of runs, measure by measure, with a one-sided permutation p that the first is higher. */
export function preparationMarkdown(
  a: readonly RunInput[],
  b: readonly RunInput[],
  nameA: string,
  nameB: string,
): string {
  const total = (r: RunInput): number => sum(r.best);
  const measures: Array<[string, (r: RunInput) => number | null]> = [
    ["rounds", (r) => r.rounds],
    ["serious findings in round 1", (r) => r.best[0] ?? 0],
    ["serious findings in all", total],
    ["acceptance criteria", (r) => r.criteria],
    ["lines changed before review", (r) => r.changeLines],
    ["serious findings per criterion", (r) => (r.criteria ? total(r) / r.criteria : null)],
    [
      "serious findings per 1,000 lines changed",
      (r) => (r.changeLines ? (1000 * total(r)) / r.changeLines : null),
    ],
  ];
  const rows = measures.map(([name, pick]) => {
    const va = a.map(pick).filter((v): v is number => v !== null);
    const vb = b.map(pick).filter((v): v is number => v !== null);
    return [
      name,
      `${num(median(va), 1)} (mean ${num(sum(va) / va.length, 1)})`,
      `${num(median(vb), 1)} (mean ${num(sum(vb) / vb.length, 1)})`,
      num(permutationP(va, vb), 3),
    ];
  });
  return [
    `**${nameA}, ${a.length} runs, against ${nameB}, ${b.length} runs**`,
    "",
    table(
      ["Measure", `${nameA}: median`, `${nameB}: median`, `One-sided p that ${nameA} is higher`],
      rows,
    ),
    "",
  ].join("\n");
}

const GROUP_LABEL: Record<string, string> = {
  "missed-lens-reviewed": "Missed: in the change as first reviewed, not named before",
  "missed-not-asked": "Missed: in the change, and no reviewer of its lens had run",
  "made-by-last-fix": "Made by the last round's fix",
  "made-by-older-fix": "Made by an older fix",
  outside: "Outside the change: older than the run, or main's",
  "held-open": "The same lines named again",
  unplaced: "Unplaced: no line to read, or no history to read it in",
};

const GROUP_ORDER = Object.keys(GROUP_LABEL);

/** The groups of the later findings, by group of runs and by round. */
export function groupsMarkdown(
  findings: readonly TracedFinding[],
  eraOfRun: ReadonlyMap<string, string>,
  filled: number,
): string {
  const later = findings.filter((f) => f.round >= 2);
  const out: string[] = [];
  out.push("# What the findings after round 1 are made of", "");
  out.push(
    `${later.length} serious findings name round 2 or later in the 61 runs. Each is put in the first group of [rule.md](../rule.md) that applies, by where \`git blame\` says the cited lines came from. ${filled} more serious findings are counted by round from the runs' own cards and cannot be traced one by one; they are in no group.`,
    "",
  );
  const eras = [...new Set(eraOfRun.values())].sort();
  const head = [
    "Group",
    "All",
    ...eras.map((e) => e.slice(0, 1)),
    ...["2", "3", "4", "5 or later"].map((r) => `Round ${r}`),
  ];
  const rows = GROUP_ORDER.map((g) => {
    const mine = later.filter((f) => f.group === g);
    const byEra = eras.map((e) => mine.filter((f) => eraOfRun.get(f.run) === e).length);
    const byRound = [2, 3, 4].map((r) => mine.filter((f) => f.round === r).length);
    byRound.push(mine.filter((f) => f.round >= 5).length);
    return [
      GROUP_LABEL[g] as string,
      `${mine.length} (${pct(mine.length, later.length)})`,
      ...byEra.map(String),
      ...byRound.map(String),
    ];
  });
  const total = (pick: (f: TracedFinding) => boolean): string => String(later.filter(pick).length);
  rows.push([
    "All later findings",
    String(later.length),
    ...eras.map((e) => total((f) => eraOfRun.get(f.run) === e)),
    total((f) => f.round === 2),
    total((f) => f.round === 3),
    total((f) => f.round === 4),
    total((f) => f.round >= 5),
  ]);
  out.push(table(head, rows), "");
  const made = later.filter(
    (f) => f.group === "made-by-last-fix" || f.group === "made-by-older-fix",
  ).length;
  const placed = later.filter((f) => f.group !== "unplaced").length;
  out.push(
    `Of the ${placed} that could be placed, ${made} (${pct(made, placed)}) are in lines an earlier round's fix wrote, ${later.filter((f) => f.group?.startsWith("missed")).length} (${pct(later.filter((f) => f.group?.startsWith("missed")).length, placed)}) were in the change when round 1 reviewed it and no round had named them, and ${later.filter((f) => f.group === "outside").length} (${pct(later.filter((f) => f.group === "outside").length, placed)}) are outside the change.`,
    "",
  );
  const one = later.filter((f) => f.relog).length;
  out.push(
    `${one} of the later findings are a re-log: their target text was already a serious finding in an earlier round of the same run.`,
    "",
  );
  return out.join("\n");
}

type LaneRoundRow = {
  run: string;
  round: number;
  lane: string;
  minutes: number | null;
  named: number;
  alone: number;
};

/** Each reviewer lane's findings and time, in round 1 and in the rounds after it. */
export function lanesMarkdown(rows: readonly LaneRoundRow[], label: string): string {
  const out: string[] = [`## ${label}`, ""];
  const lanes = [...new Set(rows.map((r) => r.lane))].sort();
  const body: string[][] = [];
  for (const lane of lanes) {
    for (const [name, pick] of [
      ["round 1", (r: LaneRoundRow) => r.round === 1],
      ["rounds 2 and after", (r: LaneRoundRow) => r.round >= 2],
    ] as const) {
      const mine = rows.filter((r) => r.lane === lane && pick(r));
      if (mine.length === 0) continue;
      const minutes = mine.map((r) => r.minutes).filter((m): m is number => m !== null);
      const named = sum(mine.map((r) => r.named));
      const alone = sum(mine.map((r) => r.alone));
      body.push([
        lane,
        name,
        String(mine.length),
        String(named),
        String(alone),
        pct(alone, named),
        minutes.length === 0 ? "–" : num(median(minutes), 1),
        minutes.length === 0 ? "–" : num((60 * named) / sum(minutes), 1),
      ]);
    }
  }
  out.push(
    table(
      [
        "Lane",
        "Rounds",
        "Lane-rounds",
        "Serious findings it names",
        "Of those, named by it alone",
        "Share alone",
        "Minutes per lane-round, median",
        "Findings named per lane-hour",
      ],
      body,
    ),
    "",
  );
  return out.join("\n");
}

const ROUNDS_PER_SERIOUS = 0.18;

/** The readers' marks, their agreement, and what the marked findings would have removed. */
export function marksMarkdown(
  items: readonly Item[],
  a: readonly Mark[],
  b: readonly Mark[],
  runs: readonly LeverRun[],
): string {
  const out: string[] = ["# The readers' marks of the later findings", ""];
  const withText = items.filter((i) => i.text !== "");
  const ag = agreement(a, b);
  out.push(
    `${items.length} later findings, ${withText.length} with text. Reader A marked ${a.length}, reader B ${b.length}, both ${ag.n}.`,
    "",
  );
  const row = (name: string, x: { same: number; kappa: number }): string[] => {
    const [lo, hi] = wilson(x.same, ag.n);
    return [
      name,
      `${x.same} of ${ag.n} (${pct(x.same, ag.n)})`,
      `${Math.round(100 * lo)}–${Math.round(100 * hi)}%`,
      num(x.kappa),
    ];
  };
  out.push(
    table(
      ["Mark", "Same mark from both readers", "Wilson 95% interval", "Cohen's kappa"],
      [row("ticket open", ag.ticketOpen), row("disagrees", ag.disagrees), row("kind", ag.kind)],
    ),
    "",
  );
  const rows = combine(a, b);
  const byId = new Map(items.map((i) => [i.id, i]));
  const countOf = (pick: (c: Combined) => boolean): number => rows.filter(pick).length;
  out.push("## Ticket open", "");
  out.push(
    table(
      ["Reading", "Findings", "Share of the marked"],
      [
        [
          "both readers say yes",
          String(countOf((c) => c.openBoth)),
          pct(
            countOf((c) => c.openBoth),
            rows.length,
          ),
        ],
        [
          "at least one says yes",
          String(countOf((c) => c.openEither)),
          pct(
            countOf((c) => c.openEither),
            rows.length,
          ),
        ],
      ],
    ),
    "",
  );
  out.push("## Kind", "");
  out.push(
    table(
      ["Kind", "Reader A", "Reader B", "Both the same"],
      KINDS.map((k) => [
        k,
        String(a.filter((m) => m.kind === k).length),
        String(b.filter((m) => m.kind === k).length),
        String(countOf((c) => c.kind === k)),
      ]),
    ),
    "",
  );
  out.push("## By how the finding came to be found", "");
  const groups = [...new Set(items.map((i) => i.group))].filter(
    (g): g is NonNullable<typeof g> => g !== null,
  );
  out.push(
    table(
      ["Group", "Marked", "Ticket open, both", "Ticket open, either", "Disagrees, either"],
      groups.map((g) => {
        const ids = new Set(withText.filter((i) => i.group === g).map((i) => i.id));
        const mine = rows.filter((c) => ids.has(c.id));
        return [
          GROUP_LABEL[g] ?? g,
          String(mine.length),
          String(mine.filter((c) => c.openBoth).length),
          String(mine.filter((c) => c.openEither).length),
          String(mine.filter((c) => c.disagreesEither).length),
        ];
      }),
    ),
    "",
  );
  out.push("## Rounds a change would have removed", "");
  out.push(
    `Each row removes the chosen findings and the ones that followed from them: a finding in lines a fix of a removed finding wrote, or in lines a removed finding named. *Strict* counts a round only where every serious finding of the run's last rounds is removed. *By the fitted relation* takes ${ROUNDS_PER_SERIOUS} rounds for each serious finding, from the 61 runs (rounds = 2.1 + 0.18 × serious findings, Theil–Sen slope 0.19).`,
    "",
  );
  const lf = (i: Item): LeverFinding => ({
    run: i.run,
    round: i.round,
    target: i.target,
    fixOf: i.fixOf,
    placedBefore: i.placedBefore,
  });
  const all = items.map(lf);
  const pickSet = (pick: (i: Item, c: Combined | undefined) => boolean): Set<LeverFinding> => {
    const byIdRow = new Map(rows.map((c) => [c.id, c]));
    const chosen = new Set<LeverFinding>();
    items.forEach((i, ix) => {
      if (pick(i, byIdRow.get(i.id))) chosen.add(all[ix] as LeverFinding);
    });
    return chosen;
  };
  const levers: Array<[string, Set<LeverFinding>]> = [
    ["The ticket left it open (both readers)", pickSet((_, c) => c?.openBoth === true)],
    ["The ticket left it open (either reader)", pickSet((_, c) => c?.openEither === true)],
    [
      "The same defect at one more place (kind site, both readers)",
      pickSet((_, c) => c?.kind === "site"),
    ],
    [
      "Two places that must agree do not (kind contract, both readers)",
      pickSet((_, c) => c?.kind === "contract"),
    ],
    ["In lines outside the change", pickSet((i) => i.group === "outside")],
    [
      "Made by an earlier fix, for comparison",
      pickSet((i) => i.group === "made-by-last-fix" || i.group === "made-by-older-fix"),
    ],
  ];
  const tableRows = levers.map(([name, chosen]) => {
    const e = leverEffect(runs, all, chosen, true);
    return [
      name,
      String(chosen.size),
      String(e.findings),
      String(e.runs),
      String(e.roundsRemoved),
      num(ROUNDS_PER_SERIOUS * e.findings, 0),
    ];
  });
  out.push(
    table(
      [
        "Change",
        "Findings chosen",
        "With what followed from them",
        "Runs touched",
        "Rounds removed, strict",
        "Rounds removed, by the fitted relation",
      ],
      tableRows,
    ),
    "",
  );
  const _ = byId;
  return out.join("\n");
}

export function signalsMarkdown(first: readonly RunFacts[], later: readonly RunFacts[]): string {
  const out: string[] = [];
  out.push("# Stop signals", "");
  out.push(
    "A *transition* is a point at which a loop went on: round r ended with its fixes in, and round r+1 ran. *Clean* means round r+1 held no serious finding. The signals and rules were fixed in `apparatus/signals.ts` before the later set was read.",
    "",
  );
  for (const [label, runs] of [
    ["The 61 runs", first],
    ["The later set (runs whose review ended after the first set was fixed)", later],
  ] as const) {
    if (runs.length === 0) continue;
    const ts = transitions(runs);
    const clean = ts.filter((t) => t.clean).length;
    out.push(`## ${label}`, "");
    out.push(
      `${runs.length} runs, ${ts.length} transitions, of which ${clean} (${pct(clean, ts.length)}) went to a clean round. A transition after round 1 is ${ts.filter((t) => t.round >= 2).length}, of which ${ts.filter((t) => t.round >= 2 && t.clean).length} went to a clean round.`,
      "",
    );
    const rows = signalRows(ts).map((s) => {
      const [lo, hi] = wilson(s.flaggedClean, s.flagged);
      return [
        s.says,
        String(s.flagged),
        s.flagged === 0
          ? "–"
          : `${pct(s.flaggedClean, s.flagged)} (${Math.round(100 * lo)}–${Math.round(100 * hi)}%)`,
        String(s.other),
        s.other === 0 ? "–" : pct(s.otherClean, s.other),
      ];
    });
    out.push(
      table(
        [
          "Signal at the end of round r",
          "Transitions where it holds",
          "Next round clean there (95% interval)",
          "Where it does not",
          "Next round clean there",
        ],
        rows,
      ),
      "",
    );
    out.push("### Stopping rules, applied after each round to each run", "");
    out.push(
      table(
        [
          "Rule",
          "Runs where it fires early",
          "Rounds it would save",
          "Serious findings in the rounds it would skip",
          "Runs it skips only clean rounds in",
          "Rounds after a run's last serious finding",
        ],
        RULES.map((rule) => {
          const s = simulate(rule, runs);
          return [
            rule.says,
            `${s.fires} of ${s.runs}`,
            String(s.roundsSaved),
            String(s.seriousSkipped),
            `${s.cleanSkips} of ${s.fires}`,
            String(s.confirmingRounds),
          ];
        }),
      ),
      "",
    );
  }
  return out.join("\n");
}

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const main = (args: string[]): void => {
  const dir = arg(args, "--results");
  const cut = arg(args, "--cut");
  if (!dir || !cut)
    throw new Error("usage: render.ts --results <dir> --cut <iso> [--later <findings file>]");
  const runs = (JSON.parse(readFileSync(join(dir, "runs.json"), "utf8")) as { runs: RunRow[] })
    .runs;
  const traced = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")) as Traced;
  const first = runs.filter(
    (r) => r.rounds > 0 && r.reviewEndedAt !== null && r.reviewEndedAt <= cut,
  );
  const inputs = inputsOf(first, traced);
  writeFileSync(join(dir, "rounds.md"), roundsMarkdown(inputs));
  writeFileSync(join(dir, "features.md"), featuresMarkdown(inputs));
  const eraOfRun = new Map(inputs.map((r) => [r.run, eraOf(r).slice(0, 1)]));
  const filledSerious = sum(first.map((r) => sum(r.seriousBest) - sum(r.seriousByRound)));
  writeFileSync(
    join(dir, "later-findings.md"),
    groupsMarkdown(traced.findings, eraOfRun, filledSerious),
  );
  const laterFile = arg(args, "--later");
  const laterFacts: RunFacts[] = [];
  if (laterFile && existsSync(join(dir, laterFile))) {
    const later = JSON.parse(readFileSync(join(dir, laterFile), "utf8")) as Traced & {
      runIds: string[];
    };
    const laterRows = runs.filter((r) => later.runIds.includes(r.run));
    laterFacts.push(...factsOf(laterRows, later));
  }
  const lanesFile = join(dir, "lane-rounds.json");
  const lanesLater = join(dir, "lane-rounds-later.json");
  let lanesText =
    "# Reviewer lanes\n\nA lane's serious findings, its time and its share named by it alone, per lane-round. Time is from the launch line to the lane's last exit, summed over its lenses.\n\n";
  if (existsSync(lanesFile)) {
    const rows = (JSON.parse(readFileSync(lanesFile, "utf8")) as { rows: LaneRoundRow[] }).rows;
    lanesText += lanesMarkdown(rows, "The 61 runs");
  }
  if (existsSync(lanesLater)) {
    const rows = (JSON.parse(readFileSync(lanesLater, "utf8")) as { rows: LaneRoundRow[] }).rows;
    lanesText += lanesMarkdown(rows, "The later set");
  }
  writeFileSync(join(dir, "lanes.md"), lanesText);
  writeFileSync(join(dir, "signals.md"), signalsMarkdown(factsOf(first, traced), laterFacts));
  const aFile = join(dir, "..", "readers", "reader-a.tsv");
  const bFile = join(dir, "..", "readers", "reader-b.tsv");
  if (existsSync(aFile) && existsSync(bFile)) {
    const a = parseMarks(readFileSync(aFile, "utf8")).marks;
    const b = parseMarks(readFileSync(bFile, "utf8")).marks;
    const items = itemsOf(traced.findings);
    const runsInput: LeverRun[] = first.map((r) => ({
      run: r.run,
      rounds: r.rounds,
      best: r.seriousBest,
    }));
    writeFileSync(join(dir, "marks.md"), marksMarkdown(items, a, b, runsInput));
  }
};

if (import.meta.main) main(process.argv.slice(2));
