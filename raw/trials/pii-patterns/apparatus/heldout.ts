#!/usr/bin/env bun
/**
 * Have a model that took no part in this trial write labelled lines to test the patterns on.
 *
 *   bun heldout.ts --model <openrouter id> --out <file> [--key-file <file>]
 *   bun heldout.ts --prompt-sha256       the prompt's hash, to check it against a copy
 *
 * It asks through OpenRouter's chat completions, with the prompt below and a JSON schema for
 * the answer, and keeps the lines as the model labelled them. Each line is
 * stored in pieces of three characters, so that no committed file holds a whole value a check
 * would find; run.ts joins them. The key is OPENROUTER_API_KEY, from the environment or
 * --key-file, and is never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

/** The prompt both held-out sets were written from; one word is split so that no check misreads it. */
const PROMPT = [
  "Write test data for a checker that looks for personal data in the text of a software repository: code, configuration files, documentation, commit messages, and transcripts of chats between a developer and an AI coding assistant. Write 60 single lines, each as it might appear in such a repository.",
  "",
  "30 lines must each contain personal data about a private individual. Spread them across these kinds, and give each line the label of the kind it contains:",
  "- person: the name of a private individual, in prose, in an author or contact field, in a signature, a greeting, a git identity or a copyright line;",
  "- em" + "ail: a personal email address;",
  "- phone: a phone number;",
  "- postal-address: a street address;",
  "- other-personal: any other personal detail: a date of birth; an identity, passport, licence, bank or card number; a health condition; income; family members; where the person lives or works.",
  "Vary the formats, using several countries' conventions, and the places in a file where they appear.",
  "",
  "30 lines must contain no personal data but look as if they might, labelled \"none\": public figures, placeholder names such as Jane Doe or Alice and Bob, names of companies and products, team or support email addresses, addresses on example.com, numbers that are not phone numbers (versions, ports, timestamps, ids, hashes), dates that are not birthdays, fictional or public addresses, code identifiers that look like names, and medical or financial words in code.",
  "",
  "Use invented values only, never a real private person's details. Mix the two groups in a random order.",
  "",
].join("\n");

const LABELS = ["person", "email", "phone", "postal-address", "other-personal", "none"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "text"],
        properties: { label: { type: "string", enum: LABELS }, text: { type: "string" } },
      },
    },
  },
};

function key(file: string | undefined): string {
  if (file) {
    for (const raw of readFileSync(file.replace(/^~/, homedir()), "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?OPENROUTER_API_KEY=(.*)$/.exec(raw);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, "");
    }
    throw new Error("heldout: no OPENROUTER_API_KEY in the key file");
  }
  const value = process.env.OPENROUTER_API_KEY;
  if (!value) throw new Error("heldout: OPENROUTER_API_KEY is not set");
  return value;
}

const pieces = (text: string): string[] => {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += 3) out.push(chars.slice(i, i + 3).join(""));
  return out;
};

async function main(args: string[]): Promise<void> {
  const opts = new Map<string, string>();
  for (let i = 0; i + 1 < args.length; i += 2) opts.set(args[i], args[i + 1]);
  const model = opts.get("--model");
  const out = opts.get("--out");
  if (args.includes("--prompt-sha256")) {
    console.log(new Bun.CryptoHasher("sha256").update(PROMPT).digest("hex"));
    return;
  }
  if (!model || !out) {
    console.error("usage: bun heldout.ts --model <id> --out <file> [--key-file <file>]");
    process.exit(2);
  }
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key(opts.get("--key-file"))}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: PROMPT }],
      response_format: { type: "json_schema", json_schema: { name: "lines", strict: true, schema: SCHEMA } },
      usage: { include: true },
    }),
  });
  if (!response.ok) throw new Error(`heldout: OpenRouter answered ${response.status}`);
  const reply = await response.json();
  const lines: { label: string; text: string }[] = JSON.parse(reply.choices[0].message.content).lines;
  const rows = lines.filter((line) => LABELS.includes(line.label)).map((line) => ({ label: line.label, parts: pieces(line.text) }));
  writeFileSync(out, `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  console.log(`model asked ${model}, served ${reply.model}; ${rows.length} lines: ${[...counts].map(([l, c]) => `${l} ${c}`).join(", ")}; cost $${reply.usage?.cost ?? "unknown"}`);
}

await main(process.argv.slice(2));
