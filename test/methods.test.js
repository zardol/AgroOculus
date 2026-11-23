const test = require("node:test");
const assert = require("node:assert/strict");
const field = require("../dist/model.js");
const methods = require("../dist/methods.js");

test("Mamdani responds to crossing the operator's threshold and reversals in trend", () => {
  assert.equal(methods.risk(.45, .45, .45), 50);
  assert.ok(methods.risk(.39, .46, .45) > methods.risk(.39, .30, .45));
  assert.ok(methods.risk(.38, .40, .45) > methods.risk(.38, .40, .25));
  assert.ok(methods.risk(.01, 1, .45) <= 100);
  assert.ok(methods.risk(1, .01, .45) >= 0);
  assert.throws(() => methods.risk(NaN, .45, .45));
});

test("the two regression errors are measured on 18 June and a sector change updates its forecast", () => {
  const errors = [0,0];
  for (const cell of field.cells) {
    const records = field.series(cell.id);
    const predictions = methods.predict(records[4].ndvi, records[3].ndvi);
    for (let i = 0; i < 2; i++) errors[i] += Math.abs(records[5].ndvi - predictions[i]) / 24;
  }
  const table = methods.results("C5");
  assert.equal(table.length, 7);
  for (let i = 0; i < 2; i++) {
    assert.equal(table[i][2], "MAE " + errors[i].toFixed(3).replace(".",","));
  }
  assert.ok(errors[0] < .02 && errors[1] < .02);
  assert.notDeepEqual(table, methods.results("A1"));
  assert.equal(table[6][1], "83 / 100");
  assert.throws(() => methods.results("F9"));
});
