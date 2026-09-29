const records = [];

// Add a record and return how many there are.
function add(record) {
  records.push(record);
  return records.length;
}

// Every record, oldest first, as a copy the caller may change.
function all() {
  return records.slice();
}

module.exports = { add, all };
