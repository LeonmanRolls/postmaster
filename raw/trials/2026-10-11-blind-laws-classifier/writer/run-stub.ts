// Runs every law in laws.ts against the stand-in in classifier.ts and prints each result.
// Against the stand-in a result says only that the law loads and its generator runs.
import { laws } from "./laws.ts";

let n = 0;
for (const law of laws) {
  n += 1;
  try {
    law.check();
    console.log(`${n}. ${law.name}: passed against the stand-in`);
  } catch (error) {
    const first = String((error as Error).message ?? error).split("\n")[0];
    console.log(`${n}. ${law.name}: failed against the stand-in: ${first}`);
  }
}
console.log(`${n} laws`);
