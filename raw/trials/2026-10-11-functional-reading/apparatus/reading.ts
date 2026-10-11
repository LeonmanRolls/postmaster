// The pure parts of the reading trial: the prompt a reader gets, the answers read back out of its
// reply, and the scoring of those answers against the ground truth. Nothing here reads a file or
// starts a process; run-readers.ts and tabulate.ts are the edges.

export type Question = Readonly<{ id: string; type: string; prompt: string }>;

export type Answers = Readonly<Record<string, unknown>>;

export type Scored = Readonly<{
  id: string;
  type: string;
  answered: boolean;
  correct: boolean;
}>;

/** How a reader is asked to work: tracing step by step, or answering straight from the reading. */
export type Mode = "careful" | "quick";

const COMMON = [
  "Below are the source of one TypeScript module, a glossary of the helpers it imports (their",
  "source is not shown), and a list of questions about the module's behaviour.",
  "",
  "You cannot run code. The glossary is exact; rely on it.",
  "",
  'If the source and the glossary do not determine an answer, answer "undetermined".',
];

const HOW: Readonly<Record<Mode, readonly string[]>> = {
  careful: [
    "",
    "Work out each answer by reading the source. Trace it carefully, step by step, for each",
    "question before you answer.",
  ],
  quick: [
    "",
    "Answer from your reading of the source. Do not write out your reasoning or any working: your",
    "whole reply is the JSON block below and nothing else.",
  ],
};

const CLOSING = [
  "",
  "Finish with one JSON object in a ```json block: its keys are the question ids and its values the",
  "answers, each in the format its question asks for. Put nothing after the block.",
];

const intro = (mode: Mode): string => [...COMMON, ...HOW[mode], ...CLOSING].join("\n");

/** The text a reader is given: the module as it is, the glossary, and the questions. */
export function buildPrompt(
  args: Readonly<{
    file: string;
    source: string;
    glossary: string;
    questions: readonly Question[];
    mode?: Mode;
  }>,
): string {
  const questions = args.questions.map((q) => `### ${q.id}\n${q.prompt.trim()}`).join("\n\n");
  return [
    intro(args.mode ?? "careful"),
    "",
    `## Source: ${args.file}`,
    "",
    "```ts",
    args.source.replace(/\n$/u, ""),
    "```",
    "",
    "## Glossary of imported helpers",
    "",
    args.glossary.trim(),
    "",
    "## Questions",
    "",
    questions,
    "",
  ].join("\n");
}

const parseObject = (text: string): Answers | null => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Answers)
      : null;
  } catch {
    return null;
  }
};

/** The answers object in a reply: the last ```json block, else the last balanced top-level object. */
export function extractAnswers(reply: string): Answers | null {
  const blocks = [...reply.matchAll(/```json\s*([\s\S]*?)```/giu)];
  const last = blocks[blocks.length - 1];
  if (last?.[1] !== undefined) {
    const parsed = parseObject(last[1].trim());
    if (parsed !== null) return parsed;
  }
  const end = reply.lastIndexOf("}");
  if (end < 0) return null;
  for (
    let start = reply.lastIndexOf("{", end);
    start >= 0;
    start = reply.lastIndexOf("{", start - 1)
  ) {
    const parsed = parseObject(reply.slice(start, end + 1));
    if (parsed !== null) return parsed;
  }
  return null;
}

/** A canonical string for a value, so that "3" and 3, or "yes" and true, compare equal. */
export function canonical(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim().replace(/\s+/gu, " ");
    if (/^-?\d+(\.\d+)?$/u.test(text)) return `n:${Number(text)}`;
    const lower = text.toLowerCase();
    if (lower === "true" || lower === "yes") return "b:true";
    if (lower === "false" || lower === "no") return "b:false";
    return `s:${text}`;
  }
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  return "?";
}

/** Whether an answer matches the ground truth. */
export function isCorrect(answer: unknown, truth: unknown): boolean {
  if (typeof truth === "string" && truth.trim().toLowerCase() === "undetermined") {
    return typeof answer === "string" && answer.trim().toLowerCase() === "undetermined";
  }
  return canonical(answer) === canonical(truth);
}

/** One reader's answers against the truth, a row per question; a missing answer is wrong. */
export function scoreRun(
  answers: Answers | null,
  truth: Answers,
  questions: readonly Question[],
): Scored[] {
  return questions.map((q) => {
    const answered = answers !== null && Object.hasOwn(answers, q.id);
    return {
      id: q.id,
      type: q.type,
      answered,
      correct: answered && isCorrect(answers?.[q.id], truth[q.id]),
    };
  });
}

/** The Wilson 95% interval for k of n. */
export function wilson(k: number, n: number, z = 1.96): readonly [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
