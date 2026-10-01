// Run the proposed format's engine under Node: {rules, lines} as JSON on stdin, one list of
// findings per line as JSON on stdout. check.ts compares it with the same engine under Bun.
import { readFileSync } from "node:fs";
import { find, type Rule } from "./format.ts";

const { rules, lines } = JSON.parse(readFileSync(0, "utf-8")) as { rules: Rule[]; lines: string[] };
process.stdout.write(JSON.stringify(lines.map((line) => find(rules, line))));
