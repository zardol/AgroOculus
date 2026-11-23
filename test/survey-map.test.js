const test = require("node:test");
const assert = require("node:assert/strict");
const survey = require("../dist/survey-map.js");
const field = require("../dist/model.js");

test("four survey plans compare length and parcel coverage on the same drawing", () => {
  const plans = survey.compare();
  assert.deepEqual(plans.map(p => p.kind), ["rows", "circle", "eight", "custom"]);
  assert.equal(plans[0].length, 4 * 500 + 3 * 100);
  assert.equal(plans[0].covered, 24);
  assert.equal(plans[1].covered, 12);
  assert.ok(Math.abs(plans[1].length - 2 * Math.PI * 145) < 1);
  assert.equal(plans[3].detours, 1);
});

test("planner detours around the enclosure, preserves user points and rejects unusable routes", () => {
  const requested = [{x:0,y:383},{x:108,y:383},{x:450,y:150}];
  const run = survey.createRun("custom", requested);
  assert.equal(run.detours, 1);
  assert.deepEqual(run.route[0], requested[0]);
  assert.deepEqual(run.route.at(-1), requested.at(-1));
  assert.ok(run.route.some(p => p.x === 108 && p.y === 383));
  for (let i = 1; i < run.route.length; i++) {
    assert.equal(field.crossesStation(run.route[i-1], run.route[i]), false);
  }
  assert.throws(() => survey.createRun("custom", [{x:50,y:382},{x:190,y:130}]), /насосной/);
  assert.throws(() => survey.createRun("custom", [requested[0],requested[0]]), /две разные/);
  assert.throws(() => survey.createRun("custom", [{x:-1,y:30},requested[0]]), /границах/);
});

test("travel, turn animation and noise samples agree across browser frame rates", () => {
  const whole = survey.createRun(), fragmented = survey.createRun();
  survey.advance(whole, 35);
  for (let frame = 0; frame < 2100; frame++) survey.advance(fragmented, 1 / 60);
  const state = survey.telemetry(whole);
  assert.deepEqual(survey.telemetry(fragmented), state);
  assert.equal(state.x, 550);
  assert.ok(state.y < 350 && state.y > 250);
  assert.ok(state.heading > 155 && state.heading < 180);
  assert.ok(state.speed > 0 && state.speed < whole.targetSpeed);
  assert.equal(state.samples, 71);
  assert.ok(state.landmarks > 1 && state.landmarks < 15);
});

test("landmark map grows during the pass, fused position is compared against simulated truth", () => {
  const run = survey.createRun();
  assert.equal(survey.telemetry(run).landmarks, 1);
  survey.advance(run, 400);
  const result = survey.telemetry(run);
  assert.equal(result.progress, 1);
  assert.equal(result.covered, 24);
  assert.equal(result.landmarks, 15);
  assert.ok(result.samples > 300);
  assert.ok(result.gpsError > 5 && result.gpsError < 15);
  assert.ok(result.fusedError > 0 && result.fusedError < result.gpsError);
  assert.deepEqual(result.rawLocal, field.toLocal(result.gps.lat, result.gps.lon));
  assert.notDeepEqual(result.local, result.rawLocal);
  assert.equal(run.mapTrail.length, result.samples);
  survey.advance(run, 300);
  assert.deepEqual(survey.telemetry(run), result);
});

test("click on drawing center chooses an interior sector; click on legend returns no sector", () => {
  const canvas = {getBoundingClientRect: () => ({left: 70, top: 20, width: 800, height: 400})};
  const hit = survey.pick(canvas, {clientX: 70 + 800 * .51, clientY: 220});
  assert.deepEqual(hit, {x:300,y:200,cell:"C4"});
  assert.equal(survey.pick(canvas, {clientX:71, clientY:21}), null);
});
