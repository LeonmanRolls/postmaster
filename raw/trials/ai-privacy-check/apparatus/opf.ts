// Run OpenAI's Privacy Filter, locally, over numbered lines: JSON {lines} on stdin, JSON
// {findings: [{line, kind}]} on stdout, never a value. The model is read from a local folder
// laid out as <models>/openai/privacy-filter, with its 4-bit ONNX weights; nothing is
// fetched. Each span the model labels at or above the threshold becomes a finding of the
// trial's kind for that label.
//
//   bun opf.ts <models-dir> [<threshold>]
import { env, pipeline } from "@huggingface/transformers";

// Each of the model's labels, and the trial's kind it counts as.
const LABEL_KIND: Record<string, string> = Object.fromEntries([
  ["private_person", "person"],
  ["private_email", "email"],
  ["private_phone", "phone"],
  ["private_address", "postal-address"],
  ["private_url", "other-personal"],
  ["private_date", "other-personal"],
  ["account_number", "account-id"],
  ["secret", "secret"],
]);

const [models, threshold = "0.5"] = process.argv.slice(2);
if (!models) {
  console.error("usage: opf.ts <models-dir> [<threshold>]");
  process.exit(2);
}
env.localModelPath = models;
env.allowRemoteModels = false;
env.allowLocalModels = true;

const { lines } = JSON.parse(await Bun.stdin.text()) as { lines: string[] };
const classify = await pipeline("token-classification", "openai/privacy-filter", { dtype: "q4", device: "cpu" });
const findings: { line: number; kind: string }[] = [];
const unknown = new Set<string>();
for (const [index, line] of lines.entries()) {
  const spans = (await classify(line, { aggregation_strategy: "simple" } as never)) as unknown as {
    entity_group?: string;
    entity?: string;
    score: number;
  }[];
  const kinds = new Set<string>();
  for (const span of spans) {
    const label = (span.entity_group ?? span.entity ?? "").replace(/^[BIES]-/, "");
    if (span.score < Number(threshold) || label === "O") continue;
    const kind = LABEL_KIND[label];
    if (kind) kinds.add(kind);
    else unknown.add(label);
  }
  for (const kind of kinds) findings.push({ line: index + 1, kind });
}
if (unknown.size) console.error("opf: labels with no kind: " + [...unknown].join(", "));
process.stdout.write(JSON.stringify({ findings }));
