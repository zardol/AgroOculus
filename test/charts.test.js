"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const Charts = require("../dist/charts.js");
const Field = require("../dist/model.js");
const FieldLab = require("../dist/field-lab.js");
const SurveyLab = require("../dist/survey-map.js");

function entries(chart) {
  const body = chart.match(/<tbody>(.*?)<\/tbody>/s)?.[1] || "";
  return [...body.matchAll(/<tr>(.*?)<\/tr>/gs)].map(row =>
    [...row[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map(cell=>cell[1]));
}

test("archived observations, scenario frame and next survey forecast are separate data", () => {
  const series = Field.series("C5");
  const shot = FieldLab.observe("C5", {kind:"dry",cell:"C5",intensity:2}, 0, .45);
  const chart = Charts.ndvi(series, shot, .45), rows = entries(chart);
  assert.equal(rows.length,7);
  // C5 dry intensity 2: Red 0.2733, NIR 0.3741, their NDVI is 0.1557.
  assert.deepEqual(rows.at(-2), ["18", "0,2618", "0,1557", "—"]);
  assert.equal(rows.at(-1)[0], "21");
  assert.deepEqual(rows.at(-1).slice(1,3), ["—","—"]);
  assert.equal(rows.at(-1)[3], new Intl.NumberFormat("ru-RU",{maximumFractionDigits:4}).format(shot.forecast));
  assert.match(chart,/Порог 0,45/);
  const dropout = FieldLab.observe("C5", {kind:"dropout",cell:"C5",intensity:1}, 0);
  assert.equal(entries(Charts.ndvi(series,dropout,.45)).length,6);
  assert.doesNotMatch(Charts.ndvi(series,dropout,.45),/Прогноз CNN–LSTM/);
  assert.match(Charts.bands(series),/0,2493<\/td><td>0,4261/);
});

test("route bars compare separate physical units with the route planner's exact data", () => {
  const compared = SurveyLab.compare(), chart=Charts.routes(compared,"rows");
  const records=entries(chart);
  assert.equal(records.length,compared.length);
  assert.deepEqual(records[0],["Галсы","24","2 300"]);
  assert.match(chart,/Охват поля, секторы/);
  assert.match(chart,/Длина пути, м/);
});

test("setpoint plot keeps earlier settings and rejects a fabricated speed for a missing sample", () => {
  const readings = [{elapsed:0,speed:0,targetSpeed:15}, {elapsed:1,speed:null,targetSpeed:15}, {elapsed:2,speed:3,targetSpeed:4}];
  const chart=Charts.speed(readings);
  assert.deepEqual(entries(chart),[["0","15","0"],["1","15","—"],["2","4","3"]]);
  assert.match(chart,/H500\.00V/);
  assert.doesNotMatch(chart,/NaN|Infinity/);
  assert.match(Charts.speed([]),/Показания появятся/);
  assert.match(Charts.speed(readings.slice(0,1)),/Начальный замер/);
});

test("long flights bound live time windows and preserve each change in the landmark count", () => {
  const history=Array.from({length:201},(_,elapsed)=>({
    elapsed,speed:4,targetSpeed:4,gpsError:elapsed/100,fusedError:elapsed/1000,
    landmarks:elapsed<10 ? 2 : elapsed<120 ? 5 : 8,
  }));
  const speed=entries(Charts.speed(history)), errors=entries(Charts.positionErrors(history));
  assert.deepEqual([speed.length,speed[0][0],speed.at(-1)[0]],[61,"140","200"]);
  assert.deepEqual(errors.at(-1),["200","2","0,2"]);
  const map=Charts.landmarks(history);
  assert.deepEqual(entries(map),[["0","2"],["10","5"],["120","8"],["200","8"]]);
  assert.match(map,/H50\.00V/);
  assert.equal(entries(Charts.landmarks(history.slice(0,1))).length,1);
});
