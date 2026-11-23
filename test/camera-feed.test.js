const test = require("node:test");
const assert = require("node:assert/strict");
const camera = require("../dist/camera-feed.js");
const crops = require("../dist/lab-camera.js");

const source = {available: true, cell: "C5", frame: crops.frame(9041, 0.262)};
const pixel = (frame, x, y) => {
  const index = 3 * (frame.size * y + x);
  return Array.from(frame.pixels.subarray(index, index + 3));
};

function difference(a, b) {
  return a.pixels.reduce((sum, value, i) => sum + Math.abs(value - b.pixels[i]), 0) / a.pixels.length;
}

test("rice rows change smoothly over time inside a single parcel and freeze at the same timestamp", () => {
  const first = camera.render(source, 2);
  const next = camera.render(source, 2 + 1 / 15);
  const later = camera.render(source, 2.8);
  assert.equal(first.size, 128);
  assert.ok(difference(first, next) > 0.1);
  assert.ok(difference(first, later) > 2 * difference(first, next));
  const paused = camera.render(source, 2);
  assert.deepEqual(paused.pixels, first.pixels);
  assert.notEqual(paused.pixels, first.pixels);
});

test("a north-up pass crosses a parcel edge gradually and retains invalid neighbour signals", () => {
  const read = [];
  const tileFor = id => {
    read.push(id);
    return {available:false};
  };
  const center = camera.render(source, 1, {x:450, y:150}, tileFor);
  assert.deepEqual(read, []);
  const advanced = camera.render(source, 1, {x:455, y:150}, tileFor);
  assert.ok(difference(center, advanced) > 2);
  const straddle = camera.render(source, 1, {x:500, y:150}, tileFor);
  assert.deepEqual(read, ["C6"]);
  assert.deepEqual(pixel(straddle, 120, 30), [23, 34, 38]);
  assert.ok(pixel(straddle, 2, 30)[1] > 60);
  const north = camera.render(source, 1, {x:450, y:200}, tileFor);
  assert.deepEqual(read, ["C6", "B5"]);
  assert.deepEqual(pixel(north, 64, 30), [23, 34, 38]);
  assert.ok(pixel(north, 64, 110)[1] > 60);
  const near = camera.render(source, 1, {x:500.01, y:150}, tileFor);
  assert.ok(difference(straddle, near) < 0.4);
});

test("no fabricated source frame on signal loss; the virtual field has a visible edge", () => {
  assert.throws(() => camera.render({available:false}, 0), RangeError);
  const corner = camera.render({...source, cell:"A1"}, 0, {x:0, y:400}, () => source);
  assert.deepEqual(pixel(corner, 12, 12), [28, 37, 31]);
  assert.ok(pixel(corner, 110, 110)[1] > 60);
});
