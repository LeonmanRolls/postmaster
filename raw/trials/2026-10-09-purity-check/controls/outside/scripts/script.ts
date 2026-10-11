// Control (D2), negative: a script outside both lib/ and any *-core.ts module that reads the
// environment. In the check's scope it is not read, so nothing is flagged; with scope `all` it is
// flagged once.
const name = process.env.NAME ?? "none";
console.log(name);
