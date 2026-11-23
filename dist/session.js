"use strict";
const plan = [
  ["#node-1", "Начинаем со снимка рисового поля и двух каналов камеры."],
  [
    "#scenario",
    "Qwen выбирает условия этой съёмки. Смотрите, как они изменят сигнал.",
  ],
  [
    "#acquire",
    "Получаем пригодный кадр. При потере сигнала камера повторяет запрос.",
  ],
  ["#next", "Из камеры и датчиков данные переходят к планированию пути."],
  ["#best-route", "Сравниваем четыре траектории и выбираем охват поля."],
  ["#next", "Передаём маршрут в симулятор движения."],
  [
    "#flight",
    "Запускаем движение. Курс и скорость меняются при прохождении поворотов.",
  ],
  ["#next", "На следующем этапе система ищет на снимке признаки изменений."],
  ["#detect", "Детектор отмечает пятна изменённой окраски на изображении."],
  ["#next", "Открываем карту по наблюдениям, накопленным в полёте."],
  [
    "#map-ndvi",
    "Сопоставляем траекторию и ориентиры этого полёта с архивным индексом растительности.",
  ],
  ["#next", "Переходим от карты к численным координатам."],
  [
    "#convert",
    "Пересчитываем широту и долготу в метры и сравниваем ошибки положения.",
  ],
  ["#next", "Теперь система определяет, нужен ли контрольный снимок."],
  ["#evaluate", "Сопоставляем индекс, порог и подтверждающие признаки."],
  [
    "#report",
    "Qwen составляет итоговое объяснение по показателям текущего сеанса.",
  ],
].filter(([target]) => !staticHosting || (target !== "#scenario" && target !== "#report"));
let stationView = false;
let previewSeconds = 0, lastCameraPaint = 0;
let shownFrame = null, sensorStill = null, analysedStill = null;
function clearDecision() {
  evaluated = null;
  report = null;
  reportError = "";
  reportRequest?.abort();
  reportRequest = null;
  shot = null;
}
function invalidate() {
  clearDecision();
  detected = false;
  stationView = false;
  shownFrame = sensorStill = analysedStill = null;
}
function setCell(id) {
  if (!Field.cells.some((c) => c.id === id) || cell === id) return;
  invalidate();
  eventRequest?.abort();
  eventRequest = null;
  eventError = "";
  attempt = 0;
  cell = id;
  coordinates = null;
  log("Сектор", "Выбран сектор " + id + ".");
  render();
}
function getFrame() {
  const o = sample();
  if (!o.available) {
    attempt = 1;
    invalidate();
    log(
      "Камера",
      "Первый кадр потерян. Принята повторная экспозиция сектора " + cell + ".",
    );
  } else
    log(
      "Камера",
      "Получен кадр " +
        cell +
        " · Red " +
        nf(o.red, 3) +
        ", NIR " +
        nf(o.nir, 3) +
        ".",
    );
}
function evaluate() {
  if (evaluated) return;
  if (!sample().available) getFrame();
  const o = FieldLab.observe(cell, scenario, attempt, limit);
  evaluated = o;
  shot = null;
  if (o.available && o.repeat) {
    shot = sample(cell, attempt + 1);
    log(
      "Камера",
      "Автоматически сделан контрольный снимок " +
        cell +
        ". NDVI " +
        nf(o.ndvi, 3) +
        " → " +
        nf(shot.ndvi, 3) +
        ".",
    );
  } else
    log(
      "Решение",
      "Контрольная экспозиция не требуется. NDVI " +
        nf(o.ndvi, 3) +
        ", порог " +
        nf(limit) +
        ".",
    );
}
function updateMap() {
  const c = el("map");
  if (c)
    SurveyLab.draw(c, {
      run,
      stage,
      selected: cell,
      scenario,
      layer: mapLayer,
    });
}

function tileUnderCamera(id) {
  return FieldLab.readSensor(id, scenario, id === cell ? attempt : 0);
}

function drawFeed(canvas, observation, seconds, position = null) {
  const live = observation.available;
  const exposure = live ? {
    ...observation,
    frame: CameraFeed.render(observation, seconds, position, tileUnderCamera),
  } : observation;
  FieldLab.draw(canvas, exposure, { boxes: false, live });
  const paused = tour === "paused" || (stage === 3 && !flying);
  const state = live ? (paused ? "Пауза" : "Поток") : "Нет сигнала";
  const label = "CAM 01 / " + observation.cell + " · " + state;
  if (canvas.nextElementSibling.textContent !== label) {
    canvas.nextElementSibling.textContent = label;
    canvas.setAttribute("aria-label", state + " учебной камеры, сектор " + observation.cell);
  }
  return exposure;
}

function livePreviewStage() {
  return stage === 0 || stage === 1 || (stage === 4 && !detected && !stationView);
}

function paintPreview() {
  shownFrame = drawFeed(el("camera"), tileUnderCamera(cell), previewSeconds);
}

function takeVisibleFrame() {
  getFrame();
  if (!shownFrame?.available || stationView) paintPreview();
  return { ...shownFrame, time: clock() };
}
function validation() {
  const slot = el("validation");
  if (!slot) return;
  const m = FieldLab.metrics;
  slot.innerHTML =
    "<h3>Проверка нейросетей</h3><p>Детектор обучен на учебных изображениях и проверен на отдельной серии. CNN–LSTM предсказывает следующий индекс по истории двух спектральных каналов.</p>" +
    table(
      ["Модель", "Контрольный результат"],
      [
        ["YOLOv8 · mAP при IoU 0,5", nf(m.detector.map50, 3)],
        ["CNN–LSTM · MAE", nf(m.sequence.mae, 4)],
      ],
    );
}
function formulaState(o = sample(), t = SurveyLab.telemetry(run)) {
  return { cell, observation: o, run, telemetry: t, limit, coordinates, evaluated,
    evidence: stationView ? FieldLab.station() : analysedStill };
}

function stageChart(o) {
  switch (stage) {
    case 1: return Charts.bands(Field.series(cell));
    case 2: return Charts.routes(SurveyLab.compare(custom), kind);
    case 3: return Charts.speed(run.history);
    case 5: return Charts.landmarks(run.history);
    case 6: return Charts.positionErrors(run.history);
    case 7: return Charts.ndvi(Field.series(cell), o, limit);
    default: return "";
  }
}

function refreshFormula() {
  const detail = el("stage-formulas");
  if (detail?.open) detail.querySelector(".formula-body").innerHTML =
    SurveyFormulas.body(stage, formulaState());
}

function updateSpeedGraph() {
  const plot = el("stage-chart");
  const next = document.createElement("template");
  next.innerHTML = Charts.speed(run.history);
  for (const selector of ["figcaption .smallmeta", "svg[role=img]", "tbody"]) {
    plot.querySelector(selector).replaceWith(next.content.querySelector(selector));
  }
}

function render() {
  const workspace = el("workspace");
  const sameStage = workspace.dataset.stage === String(stage);
  const keepFormulas = sameStage && el("stage-formulas")?.open;
  const keepValues = sameStage && workspace.querySelector(".chart-values")?.open;
  workspace.dataset.stage = stage;
  const o = sample(),
    t = SurveyLab.telemetry(run),
    pages = [
      () => overview(o),
      () => stageData(o),
      stageRoute,
      stageFlight,
      () => stageDetection(o),
      () => mapping(t),
      () => coords(t),
      () => decision(o),
    ];
  const label =
    stage < 7 && stage > 0 ? "Далее · " + steps[stage][1] : "Вернуться к схеме";
  el("workspace").innerHTML =
    (tour !== "manual" && tourText
      ? '<div class="tour-caption" id="tour-caption">' +
        safe(tourText) +
        "</div>"
      : "") +
    pages[stage]() +
    (stage
      ? '<div class="stepnav"><a class="button" id="back" href="#' +
        (stage > 1 ? steps[stage - 2][0] : "overview") +
        '">Назад</a><a class="button primary" id="next" href="#' +
        (stage === 7 ? "overview" : steps[stage][0]) +
        '">' +
        label +
        "</a></div>"
      : "");
  if (stage) {
    const graph = stageChart(o);
    workspace.querySelector(".workgrid").insertAdjacentHTML("afterend",
      SurveyFormulas.html(stage, formulaState(o,t)) +
      (graph ? '<div id="stage-chart">' + graph + '</div>' : ""));
    el("stage-formulas").open = Boolean(keepFormulas);
    el("stage-formulas").addEventListener("toggle", refreshFormula);
    const values = workspace.querySelector(".chart-values");
    if (values) values.open = Boolean(keepValues);
  }
  if (stage === 1 && FieldLab.calibration) {
    const v = FieldLab.calibration;
    el("dataset").insertAdjacentHTML(
      "beforebegin",
      '<details class="panel wide-panel" id="calibration"><summary>OpenCV · фильтрация шума камеры</summary><div class="panel-body"><p>На учебный кадр добавлены одиночные шумовые пиксели. Медианный фильтр OpenCV заменяет выбросы по соседним пикселям. Средняя ошибка яркости относительно чистого кадра снизилась с ' +
        nf(v.maeBefore, 2) +
        " до " +
        nf(v.maeAfter, 2) +
        '.</p><div class="split-photo"><figure>' +
        camFrame("cal-before") +
        "<figcaption>До фильтра</figcaption></figure><figure>" +
        camFrame("cal-after") +
        "<figcaption>После фильтра</figcaption></figure></div></div></details>",
    );
    for (const id of ["cal-before", "cal-after"])
      el(id).nextElementSibling.textContent = "Образец 0007";
    FieldLab.drawCalibration(el("cal-before"), "before");
    FieldLab.drawCalibration(el("cal-after"), "after");
  }
  if (stage === 4 && typeof FieldLab.station === "function") {
    const b = el("detect");
    b.insertAdjacentHTML(
      "afterend",
      '<button id="station">' +
        (stationView ? "Вернуть посевы" : "Проверить насосную") +
        "</button>",
    );
    if (stationView) {
      const s = FieldLab.station();
      const p = b.closest(".panel-body").querySelector(".result-note");
      p.textContent = s.boxes.some((box) => box.label === "pump_house")
        ? "Детектор выделил насосную станцию. На плане её зона занимает X " +
          s.mapRect.left +
          "–" +
          s.mapRect.right +
          " м, Y " +
          s.mapRect.bottom +
          "–" +
          s.mapRect.top +
          " м."
        : "Детектор не выделил станцию в этом кадре.";
      el("camera").closest(".camera").querySelector(".canvas-tag").textContent =
        "CAM 02 / Насосная";
    }
  }
  if (livePreviewStage()) {
    paintPreview();
  } else if (el("camera")) {
    FieldLab.draw(
      el("camera"),
      stage === 4 ? (stationView ? FieldLab.station() : analysedStill) : o,
      { boxes: (stage === 4 && (detected || stationView)) || stage === 7 },
    );
    if (!stationView) el("camera").nextElementSibling.textContent = "Снимок / " + cell;
  }
  if (el("sensor-still")) {
    FieldLab.draw(el("sensor-still"), sensorStill, { boxes: false });
    el("sensor-still").nextElementSibling.textContent = "Снимок / " + sensorStill.cell;
  }
  if (el("first-cam")) {
    FieldLab.draw(el("first-cam"), o);
    FieldLab.draw(el("repeat-cam"), shot);
  }
  if (stage === 3) {
    paintFlightCamera(t, true);
  }
  updateMap();
  validation();
  controls();
  nav();
  intro();
  paintLog();
}
let lastFlyCell = "";
function paintFlightCamera(t, redrawSignals = false) {
  if (!t.cell) return;
  const exposure = tileUnderCamera(t.cell);
  drawFeed(el("fly-cam"), exposure, t.elapsed / 12, t);
  if (redrawSignals || t.cell !== lastFlyCell) {
    el("fly-signals").innerHTML = signals(exposure);
    lastFlyCell = t.cell;
  }
}
function navigate(i, replace = false) {
  const hash = i ? steps[i - 1][0] : "overview";
  if (location.hash !== "#" + hash)
    history[replace ? "replaceState" : "pushState"](null, "", "#" + hash);
  stage = i;
  stationView = false;
  flying = false;
  if (i) visited.add(i);
  if (stage) log("Этап " + pad(stage), steps[stage - 1][2] + ".");
  render();
  el("main").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function fromHash() {
  const hash = location.hash.slice(1),
    i = steps.findIndex((s) => s[0] === hash);
  navigate(i < 0 ? 0 : i + 1, true);
}
function manualMode() {
  tour = "manual";
  waitFor = null;
  tourText = "";
  flying = false;
  hidePointer();
  controls();
}
function hidePointer() {
  el("demo-pointer").classList.remove("show");
  visibleFocus?.classList.remove("tour-focus");
  visibleFocus = null;
}
function point(selector) {
  const item = document.querySelector(selector);
  if (!item) return;
  let r = item.getBoundingClientRect();
  if (r.top < 4 || r.bottom > window.innerHeight - 12) {
    item.scrollIntoView({ block: "center", behavior: "instant" });
    r = item.getBoundingClientRect();
  }
  visibleFocus?.classList.remove("tour-focus");
  visibleFocus = item;
  item.classList.add("tour-focus");
  const cursor = el("demo-pointer");
  cursor.style.transform =
    "translate(" +
    Math.round(r.left + r.width * 0.59) +
    "px," +
    Math.round(r.top + r.height * 0.6) +
    "px)";
  cursor.classList.add("show");
}
function startDemo(guided) {
  if (tour !== "manual" && showCursor !== guided) manualMode();
  showCursor = guided;
  if (tour === "running") {
    tour = "paused";
    hidePointer();
    render();
    return;
  }
  if (tour === "paused") {
    tour = "running";
    tourPointed = false;
    render();
    return;
  }
  eventRequest?.abort();
  eventRequest = null;
  invalidate();
  eventError = "";
  eventNote = "На секторе C5 ясная погода.";
  origin = "Учебные условия";
  scenario = { kind: "clear", intensity: 1, cell: "C5" };
  cell = "C5";
  limit = 0.45;
  kind = "rows";
  run = SurveyLab.createRun(kind);
  run.targetSpeed = 15;
  target = 15;
  attempt = 0;
  visited.clear();
  coordinates = null;
  mapLayer = "route";
  tour = "running";
  tourIndex = 0;
  tourElapsed = 0;
  tourPointed = false;
  waitFor = null;
  tourText = guided ? plan[0][1] : "Автопрогон обследования.";
  log(
    guided ? "Демо" : "Авто",
    guided
      ? "Начат автоматический показ семи этапов."
      : "Начат автоматический проход без указателя.",
  );
  navigate(0);
}
function planStep(dt) {
  if (tour !== "running") return;
  if (
    (waitFor === "event" && eventRequest) ||
    (waitFor === "report" && reportRequest)
  )
    return;
  waitFor = null;
  if (tourIndex >= plan.length) {
    tour = "manual";
    tourText = "";
    hidePointer();
    log(
      showCursor ? "Демо" : "Авто",
      showCursor
        ? "Показ завершён. Итоги доступны на этапе 07."
        : "Автопрогон завершён. Результаты доступны на этапе 07.",
    );
    render();
    return;
  }
  tourElapsed += dt * speed;
  const [selector, explanation] = plan[tourIndex];
  if (selector === "#next" && stage === 3 && !run.finished) {
    tourElapsed = 0;
    return;
  }
  if (!tourPointed) {
    tourText = showCursor
      ? explanation
      : "Автопрогон · " + (stage ? steps[stage - 1][2] : "Запуск обследования");
    const cap = el("tour-caption");
    if (cap) cap.textContent = tourText;
    if (showCursor) point(selector);
    tourPointed = true;
  }
  if (tourElapsed < (showCursor ? 3.0 : 0.95)) return;
  const item = document.querySelector(selector);
  if (!item) {
    manualMode();
    log("Демо", "Показ остановлен: элемент текущего этапа недоступен.");
    render();
    return;
  }
  tourClick = true;
  try {
    item.click();
  } finally {
    tourClick = false;
  }
  if (selector === "#scenario") waitFor = "event";
  if (selector === "#report") waitFor = "report";
  tourIndex++;
  tourElapsed = 0;
  tourPointed = false;
}
async function requestScenario() {
  if (eventRequest) return;
  const ctrl = new AbortController();
  eventRequest = ctrl;
  eventError = "";
  const id = cell,
    prev = scenario.kind;
  const timer = setTimeout(() => ctrl.abort("timeout"), 33000);
  render();
  try {
    const res = await fetch("/api/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mezha-Scenario": "1" },
      body: JSON.stringify({ stage: stage || 1, cell: id, previous: prev }),
      signal: ctrl.signal,
    });
    if (!res.headers.get("content-type")?.includes("application/json"))
      throw Error(
        "Для связи с Qwen откройте сайт или запустите start-qwen.cmd.",
      );
    const s = await res.json();
    if (!res.ok) throw Error(s.error || "Сервис событий недоступен.");
    if (
      !Object.hasOwn(eventNames, s.kind) ||
      s.cell !== id ||
      ![1, 2, 3].includes(s.intensity) ||
      typeof s.note !== "string"
    )
      throw Error("Сервис вернул неполное событие.");
    if (eventRequest !== ctrl || cell !== id) return;
    invalidate();
    scenario = s;
    origin = "Qwen Flash";
    eventNote = s.note;
    attempt = 0;
    log("Qwen", eventNames[s.kind] + " · " + id + " · " + s.note);
  } catch (e) {
    if (eventRequest !== ctrl) return;
    eventError =
      ctrl.signal.reason === "timeout"
        ? "Qwen не успел ответить. Можно повторить запрос."
        : e instanceof TypeError
          ? "Нет связи с Qwen. Сохранены текущие условия учебного участка."
          : e.message;
    log("Связь", eventError);
  } finally {
    clearTimeout(timer);
    if (eventRequest === ctrl) {
      eventRequest = null;
      render();
    }
  }
}
async function requestReport() {
  if (!evaluated || reportRequest || !sample().available) return;
  const ctrl = new AbortController();
  reportRequest = ctrl;
  reportError = "";
  report = null;
  const timer = setTimeout(() => ctrl.abort("timeout"), 33000);
  const id = cell,
    threshold = limit,
    path = [
      id,
      Math.round(limit * 100),
      scenario.kind,
      scenario.intensity,
      scenario.cell,
      attempt,
    ].join("/");
  render();
  try {
    const res = await fetch("/api/report/" + path, {
      method: "POST",
      headers: { "X-Mezha-Report": "1" },
      signal: ctrl.signal,
    });
    if (!res.headers.get("content-type")?.includes("application/json"))
      throw Error("Для отчёта откройте сайт или запустите start-qwen.cmd.");
    const data = await res.json();
    if (!res.ok) throw Error(data.error || "Сервис отчётов недоступен.");
    if (
      typeof data.report !== "string" ||
      data.facts?.сектор !== id ||
      Math.abs(data.facts.порог - threshold) > 1e-8 ||
      Math.abs(data.facts.NDVI - sample().ndvi) > 0.00051
    )
      throw Error("Показания в отчёте отличаются от выбранного кадра.");
    if (reportRequest !== ctrl) return;
    report = data;
    log("Отчёт", "Получено объяснение Qwen для сектора " + id + ".");
  } catch (e) {
    if (reportRequest !== ctrl) return;
    reportError =
      ctrl.signal.reason === "timeout"
        ? "Время ожидания отчёта истекло."
        : e instanceof TypeError
          ? "Нет связи с сервисом отчётов."
          : e.message;
    log("Связь", reportError);
  } finally {
    clearTimeout(timer);
    if (reportRequest === ctrl) {
      reportRequest = null;
      render();
      if (tour === "running")
        el("report")?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }
}
function resetRoute(k = kind, points = custom) {
  const next = SurveyLab.createRun(k, points);
  kind = k;
  custom = points;
  run = next;
  run.targetSpeed = target;
  flying = false;
  routeError = "";
}
function addPoint(p) {
  if (custom.length >= 50) {
    routeError = "Достигнут предел в 50 точек.";
  } else
    try {
      resetRoute("custom", [...custom, { x: p.x, y: p.y }]);
      log("Маршрут", "Добавлена точка на плане.");
    } catch (e) {
      routeError = e.message;
    }
  render();
}
function download(name, content, type) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type }));
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadCSV(name, head, lines) {
  download(
    name,
    [head, ...lines]
      .map((row) =>
        row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(";"),
      )
      .join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function routeFromLink(a) {
  return a.hash === "#overview"
    ? 0
    : steps.findIndex((s) => "#" + s[0] === a.hash) + 1;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href^='#']");
  if (a) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.id === "skip") {
      el("main").focus();
      return;
    }
    if (!tourClick) manualMode();
    navigate(routeFromLink(a));
    return;
  }
  if (e.target.id === "map") {
    const p = SurveyLab.pick(e.target, e);
    if (p) {
      if (stage === 2 && kind === "custom") addPoint(p);
      else if ([5, 6].includes(stage)) setCell(p.cell);
    }
    return;
  }
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "jump-chart" || b.id === "jump-formula") {
    if (tour === "running") startDemo(showCursor);
    const target = el(b.getAttribute("aria-controls"));
    const formula = b.id === "jump-formula";
    if (formula) target.open = true;
    const heading = target.querySelector(formula ? "summary" : "h2");
    if (!formula) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
    return;
  }
  const flightWasRunning = flying;
  if (
    !tourClick &&
    tour !== "manual" &&
    !["demo", "auto", "manual"].includes(b.id)
  ) {
    manualMode();
  }
  switch (b.id) {
    case "demo":
    case "auto":
      startDemo(b.id === "demo");
      break;
    case "manual":
      manualMode();
      log("Режим", "Управление передано пользователю.");
      if (!stage) navigate(1);
      else render();
      break;
    case "scenario":
      void requestScenario();
      break;
    case "acquire":
      sensorStill = takeVisibleFrame();
      render();
      break;
    case "raw":
    case "clean":
      archiveView = b.id;
      render();
      el("dataset").open = true;
      el(b.id).focus({ preventScroll: true });
      break;
    case "csv": {
      const data = archiveView === "raw" ? Field.raw : Field.data.valid;
      const keys = [
        "id",
        "day",
        "red",
        "nir",
        "lat",
        "lon",
        ...(archiveView === "raw" ? [] : ["ndvi"]),
      ];
      downloadCSV(
        "AgroOculus-" + archiveView + ".csv",
        keys,
        data.map((r) => keys.map((k) => r[k])),
      );
      break;
    }
    case "best-route": {
      const best = SurveyLab.compare(custom).sort(
        (x, y) => y.covered - x.covered || x.length - y.length,
      )[0];
      resetRoute(best.kind);
      log(
        "Маршрут",
        routeNames[kind] +
          " · " +
          best.covered +
          " сектора, " +
          nf(best.length, 0) +
          " м.",
      );
      render();
      el("route-note").textContent =
        "Выбраны " +
        routeNames[kind].toLowerCase() +
        ". Охват " +
        best.covered +
        " из 24, длина " +
        nf(best.length, 0) +
        " м.";
      break;
    }
    case "add-point":
      addPoint(Field.cells.find((c) => c.id === waypoint));
      break;
    case "undo-point":
      if (custom.length > 2) {
        resetRoute("custom", custom.slice(0, -1));
        render();
      }
      break;
    case "flight":
      if (run.finished) resetRoute();
      flying = !flightWasRunning;
      log(
        "Полёт",
        flying ? "Начат проход по маршруту." : "Движение приостановлено.",
      );
      render();
      break;
    case "reset-flight":
      resetRoute();
      log("Полёт", "Маркер возвращён к началу маршрута.");
      render();
      break;
    case "detect": {
      const exposure = takeVisibleFrame();
      analysedStill = { ...exposure, boxes: FieldLab.detectCrop(exposure.frame) };
      detected = true;
      stationView = false;
      log(
        "Детектор",
        "Сектор " +
          cell +
          " · участков на снимке: " +
          analysedStill.boxes.length +
          ".",
      );
      render();
      break;
    }
    case "resume-feed":
      analysedStill = null;
      detected = false;
      render();
      break;
    case "station":
      stationView = !stationView;
      render();
      break;
    case "map-ndvi": {
      mapLayer = mapLayer === "ndvi" ? "route" : "ndvi";
      render();
      break;
    }
    case "evaluate":
      evaluate();
      render();
      break;
    case "report":
      void requestReport();
      break;
    case "download":
      if (report)
        download(
          "AgroOculus-" + cell + "-qwen.txt",
          [
            "AgroOculus · обследование рисового поля",
            "Сектор " +
              cell +
              " · " +
              origin +
              " · " +
              eventNames[scenario.kind],
            "NDVI " + nf(sample().ndvi, 3) + " · порог " + nf(limit),
            outcome(sample()),
            "",
            report.report,
          ].join("\r\n"),
          "text/plain;charset=utf-8",
        );
      break;
    case "export": {
      if (!evaluated) break;
      const o = sample();
      downloadCSV(
        "AgroOculus-observation.csv",
        [
          "sector",
          "scenario_cell",
          "event",
          "intensity",
          "red",
          "nir",
          "ndvi",
          "threshold",
          "filtered",
          "forecast",
          "repeat",
          "confirmation_ndvi",
        ],
        [
          [
            cell,
            scenario.cell,
            scenario.kind,
            scenario.intensity,
            o.red,
            o.nir,
            o.ndvi,
            limit,
            o.filtered,
            o.forecast,
            o.repeat,
            shot?.ndvi ?? "",
          ],
        ],
      );
      break;
    }
  }
});
document.addEventListener("change", (e) => {
  const v = e.target.value;
  switch (e.target.id) {
    case "local-event":
      if (!staticHosting || !Object.hasOwn(eventNames, v)) return;
      if (tour !== "manual") manualMode();
      invalidate();
      attempt = 0;
      scenario = { kind: v, intensity: 2, cell };
      origin = "Ручной выбор";
      log("Условия", cell + " · " + eventNames[v] + " · ручной выбор.");
      render();
      el("local-event").focus({ preventScroll: true });
      break;
    case "tour-speed":
      speed = Number(v);
      break;
    case "quick":
      manualMode();
      navigate(Number(v));
      break;
    case "cell":
      if (tour !== "manual") manualMode();
      setCell(v);
      break;
    case "waypoint":
      waypoint = v;
      break;
    case "route-kind":
      try {
        resetRoute(v);
        render();
      } catch (error) {
        routeError = error.message;
        render();
      }
      break;
    case "layer":
      mapLayer = v;
      render();
      break;
    case "threshold":
      if (tour !== "manual") manualMode();
      limit = Number(v);
      clearDecision();
      render();
      el("threshold").focus({ preventScroll: true });
      break;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "flight-speed") {
    target = Number(e.target.value);
    run.targetSpeed = target;
    el("target").value = target + " м/с";
    refreshFormula();
  }
  if (e.target.id === "threshold")
    el("threshold-value").value = nf(Number(e.target.value));
  if (["lat", "lon"].includes(e.target.id)) {
    coordinates = null;
    el("xy").textContent = "Нажмите «Пересчитать», чтобы обновить результат.";
    refreshFormula();
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "coords") return;
  e.preventDefault();
  const lat = el("lat").valueAsNumber,
    lon = el("lon").valueAsNumber,
    xy = Field.toLocal(lat, lon);
  if (Math.hypot(xy.x, xy.y) > 5000) {
    el("xy").textContent = "Эта точка вне локальной модели поля (радиус 5 км).";
    return;
  }
  coordinates = { lat, lon, ...xy };
  refreshFormula();
  el("xy").innerHTML = rows([
    ["X · восток", nf(xy.x, 1) + " м"],
    ["Y · север", nf(xy.y, 1) + " м"],
  ]);
  log(
    "GPS",
    "Локальные координаты: " +
      nf(xy.x, 1) +
      " м на восток, " +
      nf(xy.y, 1) +
      " м на север.",
  );
});
let last = performance.now(),
  lastPaint = 0, lastGraphPaint = 0;
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (!document.hidden) {
    if (tour !== "paused" && livePreviewStage()) {
      previewSeconds += dt;
      if (now - lastCameraPaint >= 1000 / 15) {
        paintPreview();
        lastCameraPaint = now;
      }
    }
    if (flying && stage === 3 && tour !== "paused") {
      SurveyLab.advance(run, dt * 12 * (tour === "running" ? speed : 1));
      if (now - lastPaint >= 1000 / 15 || run.finished) {
        const t = SurveyLab.telemetry(run);
        el("flight-values").innerHTML = flightStats(t);
        paintFlightCamera(t);
        updateMap();
        if (now - lastGraphPaint >= 450) {
          updateSpeedGraph();
          refreshFormula();
          lastGraphPaint = now;
        }
        lastPaint = now;
      }
      if (run.finished) {
        flying = false;
        log("Полёт", "Маршрут пройден.");
        render();
      }
    }
    planStep(dt);
  }
  requestAnimationFrame(tick);
}
window.addEventListener("popstate", () => {
  manualMode();
  fromHash();
});
window.addEventListener("resize", updateMap);
el("clock").textContent = clock();
setInterval(() => {
  el("clock").textContent = clock();
}, 1000);
log("Станция", "Открыт учебный участок КЗ-04 · рисовое поле, 24 га.");
log("Камера", "Подготовлен кадр сектора C5 и два спектральных канала.");
fromHash();
requestAnimationFrame(tick);
