const { all } = require("./store");

// How many pages of `size` records there are.
function pageCount(size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  return Math.ceil(all().length / size);
}

module.exports = { pageCount };
