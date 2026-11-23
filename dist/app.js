"use strict";
const steps = [
  [
    "data",
    "Сбор данных",
    "Камера и датчики",
    "Получите кадр с учебной камеры и проверьте, какие измерения можно использовать.",
  ],
  [
    "route",
    "Маршрут",
    "Планирование пути",
    "Сравните маршруты по длине и охвату поля. Собственный путь можно задать точками на карте.",
  ],
  [
    "flight",
    "Полёт",
    "Полёт над полем",
    "Запустите движение и проследите, как экранный симулятор выдерживает заданную скорость на поворотах.",
  ],
  [
    "detection",
    "Обнаружение",
    "Анализ снимка",
    "Найдите участок с изменённой окраской посевов и посмотрите, где он расположен в кадре.",
  ],
  [
    "map",
    "Карта",
    "Построение карты",
    "По мере движения система уточняет положение и наносит на схему наблюдаемые ориентиры.",
  ],
  [
    "coordinates",
    "Координаты",
    "Пересчёт координат",
    "Переведите широту и долготу в метры от юго-западного угла поля и сравните погрешности.",
  ],
  [
    "decision",
    "Решение",
    "Повторная съёмка",
    "Сравните индекс растительности с порогом и посмотрите, нужен ли ещё один кадр.",
  ],
];
const routeNames = {
  rows: "Галсы",
  circle: "Круг",
  eight: "Восьмёрка",
  custom: "По точкам",
};
const eventNames = {
  clear: "Ясная погода",
  cloud: "Тень облака",
  dry: "Подсыхание посевов",
  dropout: "Потеря кадра",
};
const staticHosting = document.documentElement.dataset.hosting === "static" || location.protocol === "file:";
const qwenSite = "https://mezha-field-journal-kz04.tealblossom8.chatgpt.site/";
const { icon, art } = Instruments;
const el = (id) => document.getElementById(id);
const nf = (n, d = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("ru-RU", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : "—";
const safe = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pad = (n) => String(n).padStart(2, "0");
const clock = () => new Date().toLocaleTimeString("ru-RU", { hour12: false });
let stage = 0,
  cell = "C5",
  limit = 0.45,
  kind = "rows",
  target = 15,
  attempt = 0,
  detected = false;
let waypoint = "C5",
  custom = [
    { x: 4, y: 355 },
    { x: 118, y: 395 },
    { x: 525, y: 290 },
    { x: 450, y: 150 },
    { x: 70, y: 52 },
  ];
let run = SurveyLab.createRun(kind),
  flying = false,
  mapLayer = "route",
  routeError = "",
  coordinates = null,
  speed = 1;
let scenario = { kind: "clear", cell: "C5", intensity: 1 },
  origin = "Учебные условия",
  eventNote = "На секторе C5 ясная погода.",
  eventError = "",
  eventRequest = null;
let report = null,
  reportError = "",
  reportRequest = null,
  shot = null,
  evaluated = null,
  archiveView = "clean";
let showCursor = true,
  tour = "manual",
  tourIndex = 0,
  tourElapsed = 0,
  tourPointed = false,
  tourClick = false,
  tourText = "",
  waitFor = null,
  visibleFocus = null;
const visited = new Set(),
  events = [];
function sample(id = cell, exposure = attempt) {
  if (evaluated && id === cell && exposure === attempt) return evaluated;
  return FieldLab.capture(id, scenario, exposure);
}
function log(source, message) {
  events.unshift({ source, message, time: clock() });
  if (events.length > 100) events.pop();
  paintLog();
  el("notice").textContent = message;
}
function paintLog() {
  el("logcount").textContent =
    events.length + " " + (events.length === 1 ? "запись" : "событ.");
  el("logs").innerHTML = events
    .slice(0, 6)
    .map(
      (e) =>
        "<li><time>" +
        e.time +
        '</time><span class="log-source">' +
        safe(e.source) +
        "</span><span>" +
        safe(e.message) +
        "</span></li>",
    )
    .join("");
}
function opts(pairs, selected) {
  return pairs
    .map(
      ([v, t]) =>
        '<option value="' +
        safe(v) +
        '" ' +
        (selected === v ? "selected" : "") +
        ">" +
        safe(t) +
        "</option>",
    )
    .join("");
}
function selectCells(id = "cell", value = cell) {
  return (
    '<label>Сектор<select id="' +
    id +
    '">' +
    opts(
      Field.cells.map((c) => [c.id, c.id]),
      value,
    ) +
    "</select></label>"
  );
}
function rows(entries) {
  return (
    '<dl class="readings">' +
    entries
      .map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>")
      .join("") +
    "</dl>"
  );
}
function table(head, body) {
  return (
    '<div class="tablewrap" tabindex="0" role="region" aria-label="Таблица результатов"><table class="data-table"><thead><tr>' +
    head.map((h) => '<th scope="col">' + h + "</th>").join("") +
    "</tr></thead><tbody>" +
    body
      .map(
        (r) =>
          "<tr>" + r.map((v) => "<td>" + safe(v) + "</td>").join("") + "</tr>",
      )
      .join("") +
    "</tbody></table></div>"
  );
}
function heading(title, meta = "", symbol = "") {
  return (
    '<div class="panel-heading"><h2>' +
    (symbol ? icon(symbol) : "") +
    title +
    '</h2><span class="smallmeta">' +
    meta +
    "</span></div>"
  );
}
function panel(title, body, meta = "") {
  return (
    '<section class="panel">' +
    heading(title, meta) +
    '<div class="panel-body">' +
    body +
    "</div></section>"
  );
}
function controls() {
  const running = tour === "running";
  const modeButton = (id, name, guided) => {
    const active = tour !== "manual" && showCursor === guided;
    const label = active ? (running ? "Пауза" : "Продолжить") : name;
    return (
      '<button id="' +
      id +
      '" class="' +
      (guided ? "primary" : "") +
      '" aria-pressed="' +
      active +
      '" title="' +
      name +
      '">' +
      icon(active && running ? "pause" : guided ? "play" : "cycle") +
      label +
      "</button>"
    );
  };
  el("toolbar").innerHTML =
    modeButton("demo", "Запустить демо", true) +
    modeButton("auto", "Автопрогон", false) +
    '<button id="manual" aria-pressed="' +
    (tour === "manual") +
    '">' +
    icon("manual") +
    'Ручной режим</button><label class="speedlabel"><span>Скорость</span><select id="tour-speed" aria-label="Скорость демонстрации">' +
    opts(
      ["0.5", "1", "2", "4"].map((s) => [s, s.replace(".", ",") + "×"]),
      String(speed),
    ) +
    "</select></label>" +
    '<div class="stage-tools">' +
    (stage === 0 || stage === 3
      ? '<a id="open-flight-algorithm" href="flight-algorithm.html" target="_blank" rel="noopener">Блок-схема полёта <span aria-hidden="true">↗</span><span class="sr"> (в новой вкладке)</span></a>'
      : "") +
    (stage && stage !== 4 ? '<button id="jump-chart" aria-controls="stage-chart">График</button>' : "") +
    (stage ? '<button id="jump-formula" aria-controls="stage-formulas">Разобрать формулу</button>' : "") +
    '</div>';
}
function nav() {
  el("navigation").innerHTML =
    '<div class="mobile-nav"><label for="quick">Перейти к</label><select id="quick">' +
    opts(
      [
        ["0", "Схема обследования"],
        ...steps.map((s, i) => [String(i + 1), pad(i + 1) + " · " + s[1]]),
      ],
      String(stage),
    ) +
    '</select></div><div class="nav-wide"><div class="sectionlabel">Лаборатория</div><a href="#overview" class="nav-item ' +
    (!stage ? "active" : "") +
    '" ' +
    (!stage ? 'aria-current="page"' : "") +
    ">" +
    icon("scheme") +
    'Схема системы</a><div class="sectionlabel">Этапы работы</div>' +
    steps
      .map(
        ([id, name], i) =>
          '<a class="nav-item ' +
          (stage === i + 1 ? "active" : "") +
          '" href="#' +
          id +
          '" ' +
          (stage === i + 1 ? 'aria-current="page"' : "") +
          '><span class="idx">' +
          pad(i + 1) +
          "</span>" +
          name +
          "</a>",
      )
      .join("") +
    "</div>";
}
function intro() {
  const title = stage ? steps[stage - 1][2] : "Схема обследования";
  el("breadcrumb").textContent = stage ? steps[stage - 1][1] : "Обзор";
  document.title = title + " · AgroOculus";
  el("intro").innerHTML =
    '<div class="eyebrow">' +
    (stage ? "Этап " + pad(stage) + " / 07" : "Полевая лаборатория · КЗ-04") +
    "</div><h1>" +
    title +
    "</h1><p>" +
    (stage
      ? steps[stage - 1][3]
      : "Как беспилотник обследует рисовое поле и решает, где нужен повторный снимок.") +
    "</p>";
}
function camFrame(id = "camera", large = false) {
  return (
    '<div class="camera ' +
    (large ? "large" : "") +
    '"><canvas id="' +
    id +
    '" width="600" height="300" aria-label="Учебное изображение рядов риса в секторе ' +
    cell +
    '"></canvas><span class="canvas-tag">CAM 01 / ' +
    cell +
    "</span></div>"
  );
}
function signals(o) {
  return (
    '<div class="metrics">' +
    [
      ["RED", nf(o.red, 3)],
      ["NIR", nf(o.nir, 3)],
      ["NDVI", nf(o.ndvi, 3)],
    ]
      .map(([k, v]) => "<div><small>" + k + "</small><b>" + v + "</b></div>")
      .join("") +
    "</div>"
  );
}
function camera(o) {
  return (
    '<section class="panel">' +
    heading("Камера поля", "Симуляция", "camera") +
    camFrame() +
    signals(o) +
    "</section>"
  );
}
function eventPanel() {
  if (staticHosting) {
    const current = scenario.cell === cell ? scenario.kind : "clear";
    const options = Object.entries(eventNames).map(([kind, name]) =>
      '<option value="' + kind + '"' + (kind === current ? " selected" : "") + ">" + name + "</option>");
    return '<section class="panel event"><div class="event-title">' + icon("sensor") +
      'Событие в поле</div><div class="fields"><label>Условия для сектора ' + cell +
      '<select id="local-event">' + options.join("") + '</select></label></div>' +
      '<p>Выбранные условия меняют сигнал учебной камеры. Генерация сценария доступна после входа владельца.</p>' +
      '<a class="button" href="' + qwenSite + '#data">Открыть версию с Qwen</a></section>';
  }
  return (
    '<section class="panel event"><div class="event-title">' +
    icon("sensor") +
    'Событие в поле</div><p id="event-note" class="' +
    (eventError ? "warning" : "") +
    '">' +
    safe(eventError || eventNote) +
    '</p><button id="scenario" ' +
    (eventRequest ? "disabled" : "") +
    ">" +
    icon("cycle") +
    (eventRequest ? "Qwen отвечает…" : "Сценарий от Qwen") +
    "</button></section>"
  );
}
function diagram() {
  const focus = steps.findIndex((_, i) => !visited.has(i + 1));
  return (
    '<section class="panel">' +
    heading("Цикл обследования", "07 этапов", "scheme") +
    '<div class="diagram-surface"><div class="circuit">' +
    steps
      .map(
        ([id, name], i) =>
          '<a id="node-' +
          (i + 1) +
          '" class="node ' +
          (i === focus ? "active-node" : "") +
          '" href="#' +
          id +
          '" aria-label="Этап ' +
          (i + 1) +
          ". " +
          name +
          '"><span class="node-num">' +
          pad(i + 1) +
          (visited.has(i + 1) ? " <span>✓</span>" : "") +
          "</span>" +
          art(id) +
          "<b>" +
          name +
          "</b></a>",
      )
      .join("") +
    '<span class="row-link" aria-hidden="true"></span></div></div><div class="diagram-foot"><span><i class="linekey"></i>Порядок этапов</span><span>Открыто ' +
    visited.size +
    " / 7</span></div></section>"
  );
}
function mapPanel(title, caption) {
  return (
    '<section class="panel">' +
    heading(title, "Участок КЗ-04", "pin") +
    '<div class="mapframe"><canvas id="map" width="800" height="390" aria-label="План рисового поля, маршрут и положение маркера"></canvas></div><div class="map-caption">' +
    caption +
    "</div></section>"
  );
}
function overview(o) {
  const idx = steps.findIndex((_, i) => !visited.has(i + 1));
  const next = idx === -1 ? 0 : idx;
  return (
    '<div class="workgrid"><div>' +
    diagram() +
    '<div class="panel current">' +
    icon("pin") +
    '<div><b>Рисовый чек № 04</b><small>Сырдарьинский район · 24 га · 24 сектора</small></div><a class="button" href="#' +
    steps[next][0] +
    '">' +
    (idx < 0 ? "К началу" : "Открыть этап " + pad(next + 1)) +
    '</a></div></div><div class="right-stack">' +
    camera(o) +
    eventPanel() +
    "</div></div>"
  );
}
function stageData(o) {
  const dataset = archiveView === "raw" ? Field.raw : Field.data.valid;
  return (
    '<div class="workgrid"><section class="panel">' +
    heading("Мультиспектральная камера", "Red / NIR", "camera") +
    camFrame("camera", true) +
    signals(o) +
    (sensorStill ? '<details class="captured-frame"><summary>Полученный снимок · '+sensorStill.cell+" · "+sensorStill.time+'</summary>'+camFrame("sensor-still")+'</details>' : "") +
    '</section><div class="right-stack">' +
    panel(
      "Получение кадра",
      '<div class="fields">' +
        selectCells() +
        "</div>" +
        rows([
          ["Экспозиция", String(attempt + 1)],
          ["Состояние", o.available ? "Кадр получен" : "Сигнал потерян"],
          ["Условия", eventNames[o.kind]],
        ]) +
        '<div class="actions"><button id="acquire">Получить кадр</button></div>',
    ) +
    eventPanel() +
    '</div></div><details class="panel wide-panel" id="dataset"><summary>Датасет и очистка · 147 исходных записей</summary><div class="panel-body"><p>24 сектора, шесть съёмок с 3 по 18 июня. Пара каналов Red и NIR показывает отражение красного и ближнего инфракрасного света. Измерения моделируются. После удаления дубля, нулевого сигнала и значения вне диапазона остаются 144 записи. Коэффициенты отражения получены делением на 10 000.</p><div class="actions"><button id="raw">Исходные</button><button id="clean">Очищенные</button><button id="csv">Скачать CSV</button></div>' +
    table(
      ["Сектор", "Июнь", "Red", "NIR", "Широта", "Долгота"],
      dataset.map((r) => [
        r.id,
        r.day,
        r.red,
        r.nir,
        nf(r.lat, 6),
        nf(r.lon, 6),
      ]),
    ) +
    "</div></details>"
  );
}
function stageRoute() {
  const comparison = SurveyLab.compare(custom);
  return (
    '<div class="workgrid">' +
    mapPanel(
      "Маршрут съёмки",
      kind === "custom"
        ? "Щёлкните по карте, чтобы добавить точку."
        : "Граница поля · насосная станция · расчётный путь",
    ) +
    panel(
      "Параметры маршрута",
      '<div class="fields"><label>Траектория<select id="route-kind">' +
        opts(Object.entries(routeNames), kind) +
        "</select></label></div>" +
        rows([
          ["Длина", nf(run.total, 0) + " м"],
          ["Охват", comparison.find((r) => r.kind === kind).covered + " / 24"],
          ["Обходы насосной", String(run.detours)],
        ]) +
        (kind === "custom"
          ? '<div class="fields">' +
            selectCells("waypoint", waypoint) +
            '</div><div class="actions"><button id="add-point">Добавить точку</button><button id="undo-point" ' +
            (custom.length <= 2 ? "disabled" : "") +
            ">Убрать</button></div>"
          : "") +
        '<div class="actions"><button id="best-route">Подобрать маршрут</button></div><p class="result-note ' +
        (routeError ? "warning" : "") +
        '" id="route-note">' +
        safe(
          routeError ||
            "Цель — посетить максимум секторов. При равном охвате система выбирает более короткий путь.",
        ) +
        "</p>",
    ) +
    '</div><details class="panel wide-panel"><summary>Сравнение четырёх траекторий</summary><div class="panel-body">' +
    table(
      ["Траектория", "Путь, м", "Секторы", "Обходы"],
      comparison.map((r) => [
        routeNames[r.kind],
        nf(r.length, 0),
        r.covered,
        r.detours,
      ]),
    ) +
    "</div></details>"
  );
}
function flightStats(t) {
  return rows([
    ["Скорость", nf(t.speed, 1) + " м/с"],
    ["Курс", nf(t.heading, 0) + "°"],
    ["Пройдено", nf(t.travel, 0) + " / " + nf(t.total, 0) + " м"],
    ["Посещено", t.covered + " из 24"],
    ["Обследовано", nf(100 * t.progress, 0) + " %"],
  ]);
}
function stageFlight() {
  return (
    '<div class="workgrid">' +
    mapPanel(
      "Движение по полю",
      "Линия — выбранный маршрут · маркер — экранный беспилотник",
    ) +
    '<div class="right-stack"><section class="panel">' +
    heading("Камера в движении", "Симуляция", "camera") +
    camFrame("fly-cam") +
    '<div id="fly-signals"></div></section>' +
    panel(
      "Телеметрия",
      '<label class="range">Заданная скорость · <output id="target">' +
        target +
        ' м/с</output><input id="flight-speed" type="range" min="3" max="24" value="' +
        target +
        '"></label><div class="actions"><button id="flight" class="primary">' +
        (flying
          ? "Приостановить"
          : run.finished
            ? "Повторить полёт"
            : "Запустить полёт") +
        '</button><button id="reset-flight">Сначала</button></div><div id="flight-values">' +
        flightStats(SurveyLab.telemetry(run)) +
        "</div><p>PID-регулятор исправляет отклонения скорости и курса в модели. На повороте маркер замедляется.</p>",
    ) +
    "</div></div>"
  );
}
function stageDetection(o) {
  const evidence = stationView ? FieldLab.station() : (analysedStill || o);
  return (
    '<div class="workgrid"><section class="panel">' +
    heading(
      "Кадр с камеры",
      stationView ? "Насосная" : "Сектор " + cell,
      "camera",
    ) +
    camFrame("camera", true) +
    (stationView
      ? '<div class="panel-foot">Контрольная отметка · насосная станция</div>'
      : signals(o)) +
    "</section>" +
    panel(
      "Распознавание",
      '<div class="fields">' +
        selectCells() +
        '</div><div class="actions"><button id="detect" class="primary">' +
        (o.available ? "Обработать кадр" : "Запросить кадр") +
        "</button>" +
        (analysedStill && !stationView ? '<button id="resume-feed">Вернуться к потоку</button>' : "") +
        "</div>" +
        ((detected || stationView) && evidence.available
          ? rows([
              ["Объектов на кадре", String(evidence.boxes.length)],
              ...evidence.boxes
                .slice(0, 3)
                .map((b, i) => [
                  "Центр " + (i + 1) + " · в кадре",
                  nf(100 * (b.x + b.w / 2), 0) +
                    "%, " +
                    nf(100 * (b.y + b.h / 2), 0) +
                    "%",
                ]),
              ...evidence.boxes
                .slice(0, 1)
                .map((b) => ["Уверенность", nf(100 * b.confidence, 0) + "%"]),
            ])
          : "") +
        '<p class="result-note">' +
        (detected && o.available
          ? evidence.boxes.length
            ? "Рамка отмечает изменённую окраску рядов. Причину изменения по одному кадру установить нельзя."
            : "Модель не выделила пятен в этом кадре."
          : "Детектор сравнивает фрагменты изображения и возвращает рамки пятен на посевах.") +
        "</p>",
    ) +
    '</div><details class="panel wide-panel"><summary>Соседние секторы с низким NDVI</summary><div class="panel-body"><p>Архивный срез 18 июня. Соседи объединяются по общей стороне при пороге ' +
    nf(limit) +
    ".</p>" +
    table(
      ["Зона", "Секторы", "Гектары"],
      Field.clusters(limit).map((g, i) => [
        i + 1,
        g.map((c) => c.id).join(", "),
        g.length,
      ]),
    ) +
    "</div></details>"
  );
}
function mapping(t) {
  return (
    '<div class="workgrid">' +
    mapPanel(
      mapLayer === "ndvi"
        ? "Карта индекса растительности"
        : "Карта наблюдаемых ориентиров",
      mapLayer === "ndvi"
        ? "Архивный NDVI по 24 секторам · низкие значения выделены цветом"
        : "Траектория · насосная станция · ориентиры модели",
    ) +
    panel(
      "Слои и наблюдения",
      '<div class="fields">' +
        selectCells() +
        '<label>Слой<select id="layer">' +
        opts(
          [
            ["route", "Маршрут и SLAM"],
            ["ndvi", "Индекс NDVI"],
          ],
          mapLayer,
        ) +
        "</select></label></div>" +
        rows([
          ["Ориентиров на карте", String(t.landmarks)],
          ["Измерений положения", String(t.samples)],
          ["NDVI · архив " + cell, nf(Field.last(cell).ndvi, 3)],
        ]) +
        '<p class="result-note">' +
        (t.finished ? "Маршрут завершён." : t.travel ? "Карта текущего прохода. Полёт приостановлен." : "Показаны наблюдения в точке старта.") +
        " Посещено секторов: " + t.covered + " из 24. SLAM наносит ориентиры по мере полёта.</p>" +
        '<div class="actions"><button id="map-ndvi">' +
        (mapLayer === "ndvi" ? "Вернуться к траектории" : "Показать архив NDVI") +
        "</button>" +
        (t.finished ? "" : '<a class="button" href="#flight">' + (t.travel ? "Продолжить полёт" : "Перейти к полёту") + "</a>") +
        "</div>",
    ) +
    "</div>"
  );
}
function coords(t) {
  const c = Field.cells.find((c) => c.id === cell),
    gps = Field.toGPS(c.x, c.y),
    val = coordinates || gps;
  return (
    '<div class="workgrid">' +
    mapPanel(
      "Координатная сетка",
      "Сырые координаты GPS и оценка по ориентирам",
    ) +
    panel(
      "Координаты сектора",
      '<div class="fields">' +
        selectCells() +
        '</div><form id="coords"><div class="fields"><label>Широта, °<input id="lat" type="number" step="any" min="-90" max="90" value="' +
        val.lat +
        '" required></label><label>Долгота, °<input id="lon" type="number" step="any" min="-180" max="180" value="' +
        val.lon +
        '" required></label></div><div class="actions"><button id="convert" type="submit">Пересчитать</button></div></form><div id="xy">' +
        (coordinates ? rows([
          ["X · восток", nf(coordinates.x, 1) + " м"],
          ["Y · север", nf(coordinates.y, 1) + " м"],
        ]) : "Нажмите «Пересчитать», чтобы получить X и Y.") +
        "</div>",
    ) +
    '</div><div class="panel wide-panel"><div class="panel-body"><h3>Погрешность на этом проходе</h3><p>Отклонение от известного положения в симуляторе, среднеквадратическая ошибка по ' +
    t.samples +
    " отсчётам.</p>" +
    rows([
      ["Исходный GPS", nf(t.gpsError) + " м"],
      ["GPS и ориентиры", nf(t.fusedError) + " м"],
    ]) +
    "</div></div>"
  );
}
function outcome(o) {
  if (!o.available) return "Камера ожидает кадр";
  return o.repeat ? "Назначена повторная съёмка" : "Достаточно текущего кадра";
}
function decision(o) {
  return (
    '<div class="workgrid"><section class="panel">' +
    heading("Решение системы", "Сектор " + cell) +
    '<div class="panel-body"><h2 class="decision-big">' +
    (evaluated ? outcome(o) : "Решение ещё не рассчитано") +
    "</h2><p>" +
    (evaluated ? safe(o.reason) : "Нажмите «Проверить решение», чтобы сопоставить NDVI с порогом и определить, нужна ли контрольная съёмка.") +
    "</p><p>Для расчёта используется опорная экспозиция мультиспектральной камеры в выбранных условиях. Детектор проверяет этот снимок на пятна." +
    "</p>" +
    rows([
      ["NDVI = (NIR − Red) / (NIR + Red)", nf(o.ndvi, 3)],
      ["Предыдущая дата", nf(o.prior, 3)],
      ["Оценка после EKF", nf(o.filtered, 3)],
      ["Прогноз CNN–LSTM", nf(o.forecast, 3)],
      [
        "Приоритет по Мамдани",
        o.available
          ? nf(SurveyMethods.risk(o.ndvi, o.prior, limit), 0) + " / 100"
          : "—",
      ],
    ]) +
    (shot
      ? '<div class="split-photo"><figure>' +
        camFrame("first-cam") +
        "<figcaption>Опорная экспозиция · " +
        nf(o.ndvi, 3) +
        "</figcaption></figure><figure>" +
        camFrame("repeat-cam") +
        "<figcaption>Повторный кадр · " +
        nf(shot.ndvi, 3) +
        '</figcaption></figure></div><p class="result-note">' +
        (shot.ndvi < limit
          ? "Повторное измерение также ниже порога. Сектор отмечен для проверки агрономом."
          : "Повторный кадр достиг порога. Сектор остаётся под плановым наблюдением.") +
        "</p>"
      : "<div>" + camFrame("camera") + "</div>") +
    '</div></section><div class="right-stack">' +
    panel(
      "Условия решения",
      '<div class="fields">' +
        selectCells() +
        '</div><label class="range">Порог NDVI · <output id="threshold-value">' +
        nf(limit) +
        '</output><input id="threshold" type="range" min="0.20" max="0.80" step="0.01" value="' +
        limit +
        '"></label><p>После изменения порога запустите проверку ещё раз. Если камера потеряла сигнал, система запросит новый кадр.</p><div class="actions"><button id="evaluate" '+ (evaluated || eventRequest ? 'disabled' : '') +'>' + (evaluated ? "Решение рассчитано" : "Проверить решение") + "</button></div>",
    ) +
    eventPanel() +
    '</div></div><section class="panel wide-panel">' +
    heading("Отчёт об обследовании", staticHosting ? "Выгрузка CSV" : "Qwen Flash", "report") +
    (staticHosting
      ? '<div class="panel-body"><p>Нажмите «Проверить решение», затем скачайте показатели этого сектора. Текстовый отчёт Qwen доступен в версии с сервером после входа владельца.</p><div class="actions"><a class="button" href="' + qwenSite + '#decision">Открыть версию с Qwen</a>'
      : '<div class="panel-body"><p>Qwen получает показатели выбранной экспозиции и объясняет, почему принято такое решение.</p><div class="actions"><button id="report" ' +
    (!evaluated || eventRequest || reportRequest || !o.available ? "disabled" : "") +
    ">" +
    (reportRequest ? "Готовится отчёт…" : "Составить отчёт") +
    "</button>" +
    (report ? '<button id="download">Скачать TXT</button>' : "")) +
    '<button id="export" ' + (evaluated ? "" : "disabled") + '>Скачать показатели CSV</button></div>' +
    (report || reportError
      ? '<p class="result-note ' +
        (reportError ? "warning" : "") +
        '">' +
        safe(reportError || report.report) +
        "</p>"
      : "") +
    '</div></section><details class="panel wide-panel" id="methods"><summary>Обучение и проверка моделей</summary><div class="panel-body"><p>Для проверки табличных моделей отложены наблюдения за 18 июня.</p>' +
    table(
      ["Метод", "Сектор " + cell + " · прогноз", "Проверка"],
      SurveyMethods.results(cell),
    ) +
    '<p>У табличных моделей два прошлых измерения на входе, 72 обучающих окна и 24 контрольных значения на 18 июня. Порог учебного класса равен 0,45. Прогноз CNN–LSTM использует отдельную модель синтетического датчика.</p><div id="validation"></div></div></details>'
  );
}
