"use strict";
const SurveyLab = (() => {
  const field = typeof Field !== "undefined" ? Field : require("./model.js");
  const kinds = ["rows", "circle", "eight", "custom"];
  const station = field.restricted;
  const example = [{x: 4, y: 355}, {x: 118, y: 395}, {x: 525, y: 290}, {x: 450, y: 150}, {x: 70, y: 52}];
  const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const inside = p => p.x >= 0 && p.x <= 600 && p.y >= 0 && p.y <= 400;
  const cellAt = p => inside(p) ? field.cells[Math.min(3, Math.floor((400 - p.y) / 100)) * 6 + Math.min(5, Math.floor(p.x / 100))].id : null;

  function aroundStation(a, b) {
    if (!field.crossesStation(a, b)) return [b];
    const nodes = [a, b];
    for (const x of [station.left - 2, station.right + 2]) {
      for (const y of [station.bottom - 2, station.top + 2]) nodes.push({x, y});
    }
    // Visibility graph for the single rectangular pump enclosure on this drawing.
    const cost = nodes.map(() => Infinity), previous = [], visited = new Set();
    cost[0] = 0;
    while (visited.size < nodes.length) {
      let best = -1;
      for (let i = 0; i < nodes.length; i++) {
        if (!visited.has(i) && (best < 0 || cost[i] < cost[best])) best = i;
      }
      if (!Number.isFinite(cost[best])) throw new Error("Этот отрезок нельзя проложить через насосную.");
      if (best === 1) break;
      visited.add(best);
      for (let i = 1; i < nodes.length; i++) {
        if (visited.has(i) || field.crossesStation(nodes[best], nodes[i])) continue;
        const next = cost[best] + length(nodes[best], nodes[i]);
        if (next < cost[i]) { cost[i] = next; previous[i] = best; }
      }
    }
    const result = [];
    for (let i = 1; i !== 0; i = previous[i]) result.unshift(nodes[i]);
    return result;
  }

  function plan(kind, custom) {
    if (!kinds.includes(kind)) throw new Error("Неизвестная схема маршрута.");
    const requested = kind === "custom" ? (custom ?? example) : field.route(kind);
    if (!Array.isArray(requested) || requested.length < 2) throw new Error("Добавьте хотя бы две разные точки.");
    for (const p of requested) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !inside(p)) throw new Error("Точка должна лежать в границах поля.");
      if (field.crossesStation(p, p)) throw new Error("Точка внутри насосной. Выберите место за её границей.");
    }
    const points = [{...requested[0]}];
    let detours = 0;
    for (const p of requested.slice(1)) {
      if (length(points.at(-1), p) < 0.001) continue;
      const section = aroundStation(points.at(-1), p);
      if (section.length > 1) detours++;
      points.push(...section.map(s => ({...s})));
    }
    if (points.length < 2) throw new Error("Добавьте хотя бы две разные точки.");
    return {points, detours};
  }

  function compare(custom) {
    return kinds.map(kind => {
      const {points, detours} = plan(kind, custom);
      const distance = field.length(points);
      return {kind, length: distance, covered: field.covered(points, distance).size, detours};
    });
  }

  // Distinct virtual parcel posts. Their true locations belong to the simulated sensor only.
  const posts = [80, 205, 338, 472, 585].flatMap((x, i) => [36, 183, 349].map((y, j) =>
    ({id: i * 3 + j, x: x + 5 * Math.sin(i + j), y: y + 11 * Math.cos(i - j)})));

  function seeded(seed) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296;
  }

  function observe(run) {
    const filter = run.filter;
    const gaussian = () => Math.sqrt(-2 * Math.log(run.random())) * Math.cos(2 * Math.PI * run.random());
    const dx = run.position.x - run.lastSample.x, dy = run.position.y - run.lastSample.y;
    const moving = Math.hypot(dx, dy) > 0;
    if (moving) {
      filter.x[0] += dx * 1.008 + gaussian() * 0.48;
      filter.y[0] += dy * 0.994 + gaussian() * 0.48;
      filter.cov[0][0] += 0.35;
    }
    const gps = field.toGPS(run.position.x + gaussian() * 7, run.position.y + gaussian() * 7);
    const raw = field.toLocal(gps.lat, gps.lon);

    // X and Y share one covariance: this exercise measures Cartesian offsets with isotropic noise.
    function correct(index, measurement, variance) {
      const p = filter.cov;
      const cross = p.map(row => index === 0 ? row[0] : row[index] - row[0]);
      const innovationVariance = variance + (index === 0 ? cross[0] : cross[index] - cross[0]);
      for (const axis of ["x", "y"]) {
        const state = filter[axis];
        const predicted = index === 0 ? state[0] : state[index] - state[0];
        const residual = measurement[axis] - predicted;
        for (let i = 0; i < state.length; i++) state[i] += cross[i] / innovationVariance * residual;
      }
      for (let i = 0; i < p.length; i++) {
        for (let j = 0; j < p.length; j++) p[i][j] -= cross[i] * cross[j] / innovationVariance;
      }
    }
    correct(0, raw, 49);
    for (const post of posts) {
      if (length(run.position, post) > 92) continue;
      const relative = {x: post.x - run.position.x + gaussian() * 1.8, y: post.y - run.position.y + gaussian() * 1.8};
      if (filter.ids.has(post.id)) {
        correct(filter.ids.get(post.id), relative, 3.24);
        continue;
      }
      const index = filter.x.length, p = filter.cov, newRow = [...p[0], p[0][0] + 3.24];
      filter.ids.set(post.id, index);
      filter.x.push(filter.x[0] + relative.x);
      filter.y.push(filter.y[0] + relative.y);
      for (const row of p) row.push(row[0]);
      p.push(newRow);
    }
    const local = {x: filter.x[0], y: filter.y[0]};
    run.gps = gps;
    run.rawLocal = raw;
    run.local = local;
    run.samples++;
    run.rawSquared += length(raw, run.position) ** 2;
    run.fusedSquared += length(local, run.position) ** 2;
    run.lastSample = {...run.position};
    run.mapTrail.push({...local});
    if (run.steps % 20 === 0 || run.finished) {
      run.history.push({
        elapsed: run.elapsed, speed: run.speed, targetSpeed: run.targetSpeed,
        landmarks: filter.ids.size,
        gpsError: Math.sqrt(run.rawSquared / run.samples),
        fusedError: Math.sqrt(run.fusedSquared / run.samples)
      });
    }
  }

  function createRun(kind = "rows", custom) {
    const {points, detours} = plan(kind, custom);
    const start = points[0], next = points[1];
    const run = {
      kind, route: points, detours, total: field.length(points), travel: 0, elapsed: 0,
      position: {...start}, speed: 0, heading: Math.atan2(next.y - start.y, next.x - start.x),
      segment: 1, segmentProgress: 0, samples: 0, rawSquared: 0, fusedSquared: 0,
      filter: {x: [start.x], y: [start.y], cov: [[1]], ids: new Map()},
      random: seeded(1891), remainder: 0, steps: 0, finished: false,
      lastSample: {...start}, mapTrail: [], history: [], speedControl: {sum: 0, last: null},
      turnControl: {sum: 0, last: null}, targetSpeed: 15
    };
    observe(run);
    return run;
  }

  function pid(error, state, gains, limit, dt) {
    const change = state.last === null ? 0 : (error - state.last) / dt;
    state.last = error;
    const sum = clamp(state.sum + error * dt, -limit, limit);
    const value = gains[0] * error + gains[1] * sum + gains[2] * change;
    if (Math.abs(value) <= limit || Math.sign(value) !== Math.sign(error)) state.sum = sum;
    return clamp(value, -limit, limit);
  }

  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  function advance(run, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Время должно быть неотрицательным числом.");
    const dt = 0.05;
    run.remainder += seconds;
    while (run.remainder + 1e-9 >= dt && !run.finished) {
      run.remainder -= dt;
      const a = run.route[run.segment - 1], b = run.route[run.segment];
      const span = length(a, b), desired = Math.atan2(b.y - a.y, b.x - a.x);
      const error = wrap(desired - run.heading);
      run.heading = wrap(run.heading + pid(error, run.turnControl, [2.4, 0.08, 0.12], 2.2, dt) * dt);
      const target = clamp(run.targetSpeed, 1, 35) * Math.max(0.12, Math.cos(error));
      run.speed = clamp(run.speed + pid(target - run.speed, run.speedControl, [1.45, 0.18, 0.08], 9, dt) * dt, 0, 38);
      // The screen marker stays on the chosen path; rotation slows its progress through turns.
      const step = Math.min(span - run.segmentProgress, run.speed * dt * Math.max(0, Math.cos(error)));
      run.segmentProgress += step;
      run.travel += step;
      const t = run.segmentProgress / span;
      run.position = {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
      run.steps++;
      run.elapsed = run.steps * dt;
      if (span - run.segmentProgress < 1e-7) {
        run.segmentProgress = 0;
        run.segment++;
        if (run.segment === run.route.length) {
          run.finished = true;
          run.travel = run.total;
          run.speed = 0;
        }
      }
      if (run.steps % 10 === 0 || run.finished) observe(run);
    }
    if (run.finished) run.remainder = 0;
    return run;
  }

  function telemetry(run) {
    return {
      ...run.position, speed: run.speed, heading: (90 - run.heading * 180 / Math.PI + 360) % 360,
      progress: run.travel / run.total, travel: run.travel, total: run.total, elapsed: run.elapsed,
      landmarks: run.filter.ids.size, samples: run.samples, gps: {...run.gps}, local: {...run.local},
      rawLocal: {...run.rawLocal}, gpsError: Math.sqrt(run.rawSquared / run.samples),
      fusedError: Math.sqrt(run.fusedSquared / run.samples), finished: run.finished,
      covered: field.covered(run.route, run.travel).size, cell: cellAt(run.position), detours: run.detours
    };
  }

  const cosine = Math.cos(-0.12), sine = Math.sin(-0.12);
  function projection(w, h) {
    const scale = Math.min((w - 28) / 750, (h - 24) / 545);
    const cx = w * 0.51, cy = h * 0.50;
    return {
      scale,
      screen(x, y) {
        return {x: cx + scale * (cosine * (x - 300) + sine * (y - 200)),
          y: cy + scale * (sine * (x - 300) - cosine * (y - 200))};
      },
      ground(x, y) {
        const u = (x - cx) / scale, v = (y - cy) / scale;
        return {x: 300 + cosine * u + sine * v, y: 200 + sine * u - cosine * v};
      }
    };
  }

  function pick(canvas, event) {
    const r = canvas.getBoundingClientRect();
    const p = projection(r.width, r.height).ground(event.clientX - r.left, event.clientY - r.top);
    const cell = cellAt(p);
    return cell ? {...p, cell} : null;
  }

  function trace(ctx, points, stroke, width = 1, fill) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function label(ctx, value, x, y, color, size = 11, align = "center") {
    ctx.font = size + "px Consolas, 'Courier New', monospace";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  function parcel(project, x, y, w, h) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => project.screen(a, b));
  }

  function terrain(ctx, w, h, project) {
    const random = seeded(7801);
    ctx.fillStyle = "#0a1a1b";
    ctx.fillRect(0, 0, w, h);
    // Tight bathymetric-style contours belong to the canal and its bank.
    const west = [], east = [];
    const bank = y => -79 - y * 0.095 + 21 * Math.sin(y / 92) + 10 * Math.sin(y / 44);
    for (let y = -1150; y <= 1500; y += 10) {
      west.push(project.screen(bank(y) - 11, y));
      east.push(project.screen(bank(y) + 11, y));
    }
    for (const side of [-1, 1]) {
      for (let k = 1; k <= (side === -1 ? 64 : 12); k++) {
        const path = [];
        for (let y = -850; y < 1200; y += 14) {
          const offset = 11 + k * 5.2 + Math.sin(y / 44 + k * .18) * Math.min(11, k * .9)
            + Math.sin(y / 109 - k * .36) * Math.min(24, k * 1.3);
          path.push(project.screen(bank(y) + side * offset, y));
        }
        trace(ctx, path, k % 5 === 0 ? "#28514d" : "#173532", k % 5 === 0 ? 0.85 : 0.64);
      }
    }
    trace(ctx, west.concat([...east].reverse()), null, 0, "#123b3d");
    for (const bankPath of [west, east]) trace(ctx, bankPath, "#3d7770", 1);
    for (let n = 1; n <= 3; n++) {
      const water = [];
      for (let y = -750; y <= 1200; y += 14) water.push(project.screen(bank(y) - 8 + 4 * n + Math.sin(y / 20 + n), y));
      trace(ctx, water, "#25524f", .7);
    }
    const base = ["#173330", "#183835", "#1a3631", "#193831", "#1b3b34", "#193834", "#17312f"];
    const outer = ["#112422", "#112824", "#142823", "#132923"];
    for (let row = -5; row <= 8; row++) {
      for (let col = -1; col <= 14; col++) {
        const x = col * 100, y = row * 100;
        const box = parcel(project, x + 1, y + 1, 98, 98);
        if (box.every(p => p.x < -5) || box.every(p => p.x > w + 5) || box.every(p => p.y < -5) || box.every(p => p.y > h + 5)) continue;
        const focus = row >= 0 && row < 4 && col >= 0 && col < 6;
        if (!focus && col < 0) continue;
        const colors = focus ? base : outer;
        trace(ctx, box, focus ? "#42635a" : "#203a34", focus ? 1.0 : .7, colors[Math.floor(random() * colors.length)]);
        const vertical = (col + 2 * row + 100) % 5 === 0;
        for (let t = 5; t < 96; t += 4.1) {
          const drift = random() * 2;
          const a = vertical ? project.screen(x + t, y + 3) : project.screen(x + 3, y + t);
          const b = vertical ? project.screen(x + t + drift, y + 97) : project.screen(x + 97, y + t + drift);
          trace(ctx, [a, b], focus ? (random() < .65 ? "#28493d" : "#102e2c") : "#18302a", .68);
        }
        if (focus) {
          const c = field.cells[(3 - row) * 6 + col];
          const density = Math.max(0, .53 - field.last(c.id).ndvi);
          for (let i = 0; i < 40 * density; i++) {
            const px = x + 10 + 76 * random(), py = y + 12 + 75 * random();
            trace(ctx, [project.screen(px - 4, py), project.screen(px + random() * 10, py + 1)], "#70734a", 1);
          }
        }
      }
    }
    // Irrigation distributors with small concrete turnouts at plot boundaries.
    for (const y of [-9, 403]) {
      const line = [project.screen(bank(y) + 15, y), project.screen(112, y), project.screen(746, y)];
      trace(ctx, line, "#0b2021", 5.4);
      trace(ctx, line, "#32665f", 2.1);
      for (let x = 0; x <= 600; x += 100) trace(ctx, [project.screen(x, y - 4), project.screen(x, y + 4)], "#7d9780", 1.3);
    }
    const z = station;
    trace(ctx, parcel(project, z.left, z.bottom, z.right-z.left, z.top-z.bottom), "#a79b77", 0.9, "#363b32");
    for (let x = z.left + 4; x < z.right - 15; x += 7) {
      trace(ctx, [project.screen(x, z.bottom + 2), project.screen(x + 13, z.top - 2)], "#8e8465", .9);
    }
    for (let n = 0; n < w*h/70; n++) {
      ctx.fillStyle = random() < .5 ? "#a8cfc710" : "#03131125";
      ctx.fillRect(random() * w, random() * h, 1, .8);
    }
    ctx.setLineDash([4, 3]);
    const border = parcel(project, 0, 0, 600, 400);
    trace(ctx, [...border, border[0]], "#81a99c", .9);
    ctx.setLineDash([]);
    if (w >= 340 && h >= 170) {
      const mark = project.screen(-101, 115);
      ctx.save(); ctx.translate(mark.x, mark.y); ctx.rotate(-1.44);
      label(ctx, "ОРОСИТЕЛЬНЫЙ КАНАЛ", 0, 0, "#749c91", 9);
      ctx.restore();
    }
  }

  const canvasCache = new WeakMap();
  function draw(canvas, {run, stage = 1, selected = "C5", scenario = null, overview = false, layer = "route"} = {}) {
    if (!canvas || !run) return;
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 20 || h < 20) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(w * ratio), height = Math.round(h * ratio);
    const project = projection(w, h), pt = p => project.screen(p.x, p.y);
    let entry = canvasCache.get(canvas);
    if (!entry || entry.width !== width || entry.height !== height || entry.ratio !== ratio) {
      const sheet = document.createElement("canvas");
      sheet.width = width; sheet.height = height;
      const paper = sheet.getContext("2d");
      paper.scale(ratio, ratio);
      terrain(paper, w, h, project);
      entry = {sheet, width, height, ratio};
      canvasCache.set(canvas, entry);
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.drawImage(entry.sheet, 0, 0, w, h);
    const compact = w < 330 || h < 185;
    const ndviLayer = layer === "ndvi";
    const bands = ["#b47343", "#897a43", "#47795e", "#286964"];
    if (ndviLayer) {
      ctx.globalAlpha = .76;
      for (const cell of field.cells) {
        const value = field.last(cell.id).ndvi;
        const band = value < .30 ? 0 : value < .45 ? 1 : value < .60 ? 2 : 3;
        trace(ctx, parcel(project, cell.x - 49, cell.y - 49, 98, 98), null, 0, bands[band]);
      }
      ctx.globalAlpha = 1;
    }
    const routeVisible = stage >= 2 || overview;
    if (routeVisible) {
      ctx.lineJoin = "round";
      ctx.setLineDash([5, 4]);
      trace(ctx, run.route.map(pt), "#64b4ab", compact ? .95 : 1.25);
      ctx.setLineDash([]);
      const traversed = run.route.slice(0, run.segment);
      traversed.push(run.position);
      if (run.travel > 0) trace(ctx, traversed.map(pt), "#67e0d2", 2.1);
      if (run.kind === "custom") {
        for (const point of run.route) {
          const p = pt(point);
          ctx.fillStyle = "#b7ece1"; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        }
      }
    }
    const selectedCell = field.cells.find(c => c.id === selected);
    if (selectedCell) {
      const color = scenario?.kind === "dry" && scenario.cell === selected ? "#f2bd69" : "#7af4dc";
      const {x, y} = selectedCell;
      const border = parcel(project, x - 47, y - 47, 94, 94);
      trace(ctx, [...border, border[0]], color, compact ? 1.3 : 1.6, "#44d4ae17");
      for (const p of border) { ctx.fillStyle = color; ctx.fillRect(p.x-1.7, p.y-1.7, 3.4, 3.4); }
    }
    const affected = stage >= 4 && scenario?.kind === "dry" && field.cells.find(c => c.id === scenario.cell);
    if (affected) {
      const radius = 9 + 4 * clamp(scenario.intensity || 1, 1, 3);
      const outline = [];
      for (let i = 0; i <= 24; i++) {
        const angle = i * Math.PI / 12, drift = 1 + .13 * Math.sin(3 * angle) + .09 * Math.cos(5 * angle);
        outline.push(project.screen(affected.x + 13 + Math.cos(angle) * radius * drift,
          affected.y - 13 + .65 * Math.sin(angle) * radius * drift));
      }
      trace(ctx, outline, "#d5ab69", 1, "#bf874836");
    }
    for (const c of field.cells) {
      if (compact && c.id !== selected) continue;
      const active = c.id === selected;
      const p = active ? pt(c) : project.screen(c.x - 34, c.y + 30);
      ctx.save();
      if (active) { ctx.fillStyle = "#102521"; ctx.fillRect(p.x - 12, p.y - 8, 24, 16); }
      label(ctx, c.id, p.x, p.y, active ? "#c5f9e8" : ndviLayer ? "#e6eee0" : "#a2c4b0", active ? 12 : 11);
      ctx.restore();
    }
    if (stage === 5 || stage === 6) {
      if (run.mapTrail.length > 1) trace(ctx, run.mapTrail.map(pt), "#ecd296", 1.1);
      const observer = pt(run.local);
      for (const index of run.filter.ids.values()) {
        const feature = {x: run.filter.x[index], y: run.filter.y[index]}, p = pt(feature);
        if (length(run.local, feature) < 91) {
          ctx.setLineDash([2, 4]); trace(ctx, [observer, p], "#c6ba81a3", 1); ctx.setLineDash([]);
        }
        trace(ctx, [{x:p.x,y:p.y-4},{x:p.x+4,y:p.y},{x:p.x,y:p.y+4},{x:p.x-4,y:p.y}], "#f4d59a", 1, "#78683d");
      }
      if (stage === 6) {
        const raw = pt(run.rawLocal);
        ctx.beginPath(); ctx.arc(raw.x, raw.y, 5, 0, 2 * Math.PI);
        ctx.strokeStyle = "#fab188"; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    if (routeVisible) {
      const p = pt(run.position), forward = pt({x: run.position.x + Math.cos(run.heading), y: run.position.y + Math.sin(run.heading)});
      ctx.save();ctx.translate(p.x, p.y);ctx.rotate(Math.atan2(forward.y-p.y,forward.x-p.x));
      ctx.beginPath();ctx.arc(0, 0, compact ? 9 : 12, 0, Math.PI * 2);
      ctx.fillStyle = "#103431ce";ctx.fill();ctx.strokeStyle = "#88dbcaa8";ctx.lineWidth = 1;ctx.stroke();
      trace(ctx, [{x:7,y:0},{x:-5,y:-4.2},{x:-2.5,y:0},{x:-5,y:4.2}], "#d2ffef", 1, "#75f0d1");
      ctx.restore();
    }
    if (w > 210 && h > 120) {
      const ax = w - 22, ay = 24;
      label(ctx, "С", ax, ay - 11, "#acccbf", 11);
      const north = project.screen(300, 210), center = project.screen(300, 200);
      ctx.save();ctx.translate(ax, ay + 9);ctx.rotate(Math.atan2(north.y-center.y,north.x-center.x) + Math.PI/2);
      trace(ctx, [{x:0,y:-9},{x:-3.7,y:5},{x:0,y:2},{x:3.7,y:5}], "#c1d7c6", .65, "#9cb8a7");
      ctx.restore();
      const unit = project.scale * 100, x = 16, y = h - 12;
      trace(ctx, [{x,y:y-4},{x,y},{x:x+unit,y},{x:x+unit,y:y-4}], "#abc5b4", 1);
      label(ctx, "100 м", x, y-10, "#b0c6b8", 10, "left");
    }
    if (ndviLayer && w >= 200 && h >= 95) {
      const step = w < 420 ? 29 : 43, left = w - step * 4 - 13, top = h - 30;
      ctx.fillStyle = "#0a1919ed";
      ctx.fillRect(left - 42, top - 5, step * 4 + 50, 32);
      label(ctx, "NDVI", left - 7, top + 3, "#dceade", 11, "right");
      for (let i = 0; i < bands.length; i++) {
        ctx.fillStyle = bands[i]; ctx.fillRect(left + step * i, top, step - 1, 7);
      }
      const limits = ["0,30", "0,45", "0,60"];
      limits.forEach((limit, i) => label(ctx, limit, left + step * (i+1), top + 17, "#c8d7c9", 10));
    }
  }

  return {createRun, advance, telemetry, compare, draw, pick};
})();
if (typeof window !== "undefined") window.SurveyLab = SurveyLab;
if (typeof module !== "undefined" && module.exports) module.exports = SurveyLab;
