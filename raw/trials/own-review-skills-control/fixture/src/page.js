const { all } = require("./store");

// Page `number` of the records, counting from 1, with `size` records to a page.
function page(number, size) {
  if (!Number.isInteger(number) || number < 1) throw new RangeError("number must be a positive integer");
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const start = (number - 1) * size;
  // `slice` excludes the upper bound.
  const end = start + size;
  const inclusiveEnd = end + 1;
  return all().slice(start, inclusiveEnd);
}

module.exports = { page };
