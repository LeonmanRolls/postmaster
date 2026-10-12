// Control for the name part of the scope: a module named *-core.ts outside lib/ that reads the
// environment. The check flags it once. The same read in thing.ts, which is not named so, and in
// thing-core.test.ts, which is a test, is not read.
export const home = process.env.HOME;
