"use strict";

const SurveyFormulas = (() => {
  const field = typeof Field !== "undefined" ? Field : require("./model.js");
  const methods = typeof SurveyMethods !== "undefined" ? SurveyMethods : require("./methods.js");
  const formatters = new Map();
  function n(value, digits = 2) {
    if (!formatters.has(digits)) {
      formatters.set(digits, new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: digits, maximumFractionDigits: digits
      }));
    }
    return formatters.get(digits).format(value);
  }
  function line(label, text) {
    return `<p><strong>${label}.</strong> ${text}</p>`;
  }
  const titles = ["", "От сигнала камеры к NDVI", "Длина и охват маршрута",
    "Ход полёта и поправка скорости", "Центр рамки на снимке",
    "Как оценить точность карты", "Из градусов в метры", "Порог и ошибка прогноза"];

  function index(o) {
    if (!o?.available || !(o.red + o.nir > 0)) {
      return line("NDVI", "Для расчёта нужны оба канала и положительная сумма сигналов. Запросите кадр с камеры.");
    }
    return line("NDVI = (NIR − Red) / (NIR + Red)",
      `Для текущего кадра (${n(o.nir,4)} − ${n(o.red,4)}) / (${n(o.nir,4)} + ${n(o.red,4)}) ≈ <b>${n(o.ndvi,3)}</b>. Индекс безразмерный, от −1 до 1.`);
  }

  function data({cell, observation}) {
    const row = field.raw.find(r => r.id === cell && r.day === field.days.at(-1));
    return line("Отражение = отсчёт датчика / 10 000",
      `В архиве за ${row.day} июня красный канал Red дал ${n(row.red,0)} / 10 000 = ${n(row.red/10000,4)}, ближний инфракрасный NIR дал ${n(row.nir,0)} / 10 000 = ${n(row.nir/10000,4)}. Шкала исходных отсчётов — от 0 до 10 000.`) +
      index(observation);
  }

  function route({run}) {
    const [start, end] = run.route;
    const dx = end.x-start.x, dy = end.y-start.y;
    const coverage = field.covered(run.route,run.total).size, count = field.cells.length;
    return line("Длина пути",
      `Для первого отрезка берём смещения по двум осям. Его длина √(Δx² + Δy²) = √((${n(dx,1)})² + (${n(dy,1)})²) ≈ ${n(Math.hypot(dx,dy),1)} м. Складываем длины всех отрезков с учётом обходов и получаем <b>${n(run.total,1)} м</b>.`) +
      line("Плановый охват", `${coverage} посещаемых секторов / ${count} × 100 % ≈ <b>${n(100*coverage/count,1)} %</b>. Повторный проход через один сектор засчитывается один раз.`);
  }

  function flight({run, telemetry:t}) {
    let control;
    if (t.finished) control="Маршрут завершён, скорость маркера равна нулю.";
    else if (run.speedControl.last === null) control="Для первого отсчёта запустите полёт.";
    else {
      control = `Ошибка последнего шага <b>${n(run.speedControl.last,2)} м/с</b>. Положительный знак означает, что скорость была ниже цели, отрицательный — выше.`;
    }
    return line("Выполнение = пройденное расстояние / длина пути",
      `${n(t.travel,1)} / ${n(t.total,1)} × 100 % ≈ <b>${n(100*t.progress,1)} %</b>.`) +
      line("Ошибка скорости = цель на шаге − скорость в начале шага",
        `Оператор задал ${n(run.targetSpeed,1)} м/с. На повороте симулятор уменьшает цель с учётом отклонения курса. ${control}`) +
      line("PID", "Регулятор учитывает текущую ошибку (P), её накопленную сумму (I) и скорость изменения (D). По этим трём величинам он корректирует движение экранного маркера.");
  }

  function detection({evidence}) {
    const box=evidence?.boxes?.[0];
    const meaning=line("Как читать координаты",
      "Левый верхний угол изображения принят за ноль. X растёт вправо, Y — вниз. Детектор выдаёт левую и верхнюю границы рамки (x, y), её ширину w и высоту h в долях размера кадра.");
    if (!box) {
      return meaning + line("Центр рамки", `X = (x + w / 2) × 100 %, Y = (y + h / 2) × 100 %. ${evidence ? "На обработанном кадре рамок нет." : "Обработайте кадр, чтобы подставить значения найденной рамки."}`);
    }
    return meaning + line("Горизонталь",
      `X = (x + w / 2) × 100 % = (${n(box.x,4)} + ${n(box.w,4)} / 2) × 100 % ≈ <b>${n(100*(box.x+box.w/2),1)} %</b> ширины кадра.`) +
      line("Вертикаль",
        `Y = (y + h / 2) × 100 % = (${n(box.y,4)} + ${n(box.h,4)} / 2) × 100 % ≈ <b>${n(100*(box.y+box.h/2),1)} %</b> высоты. Пример относится к первой рамке на снимке.`);
  }

  function mapping({run, telemetry:t}) {
    return line("Ошибка одного наблюдения", "Симулятор знает точное положение маркера. Для оценки положения по GPS или по ориентирам берём расстояние до этой точки в метрах, d = √(Δx² + Δy²).") +
      line("Среднеквадратическая ошибка, RMSE", `Складываем квадраты расстояний d, делим на число наблюдений и извлекаем корень. Число отсчётов — ${n(t.samples,0)}. Для GPS получаем √(${n(run.rawSquared,4)} / ${n(t.samples,0)}) ≈ <b>${n(t.gpsError,2)} м</b>. После уточнения по ориентирам √(${n(run.fusedSquared,4)} / ${n(t.samples,0)}) ≈ <b>${n(t.fusedError,2)} м</b>. Меньшее значение означает более близкую к истинной траекторию.`);
  }

  function coordinates({coordinates: point}) {
    const origin = line("Начало отсчёта", `Юго-западный угол поля, ${n(field.origin.lat,2)}° с. ш., ${n(field.origin.lon,2)}° в. д. Модель использует радиус Земли R = 6 371 008,8 м.`);
    if (!point) return origin +
      line("X — на восток", `Разность долгот в градусах умножается на π / 180 × R × cos(${n(field.origin.lat,2)}°).`) +
      line("Y — на север", "Разность широт в градусах умножается на π / 180 × R. Чтобы подставить введённые координаты, нажмите «Пересчитать».");
    const {x,y}=point;
    const dLon=point.lon-field.origin.lon, dLat=point.lat-field.origin.lat;
    return origin +
      line("X — на восток", `Разность долгот Δλ = ${n(dLon,7)}°. X = Δλ × π / 180 × R × cos(${n(field.origin.lat,2)}°) ≈ <b>${n(x,1)} м</b>. Косинус учитывает широту поля.`) +
      line("Y — на север", `Разность широт Δφ = ${n(dLat,7)}°. Y = Δφ × π / 180 × R ≈ <b>${n(y,1)} м</b>. Множитель π / 180 переводит градусы в радианы. Область пересчёта в приложении — до 5 км от начала отсчёта.`);
  }

  function decision({cell,observation:o,limit,evaluated}) {
    const series=field.series(cell), latest=series.at(-1);
    const [heldOut]=methods.predict(series.at(-2).ndvi,series.at(-3).ndvi);
    let text=index(o);
    if (o?.available && evaluated) {
      const comparison=o.ndvi<limit?"ниже":o.ndvi>limit?"выше":"на уровне";
      text+=line("Решение о съёмке", `Индекс ${comparison} выбранного порога ${n(limit,2)}. Контрольный кадр нужен при NDVI ниже порога и хотя бы одном подтверждении — индекс снизился с предыдущей даты, найдено пятно или оценка EKF тоже ниже порога.`);
    } else if (o?.available) text+=line("Правило порога", `Порог равен ${n(limit,2)}. При NDVI ниже порога программа ищет подтверждение по динамике, детектору и оценке EKF. Для проверки нажмите «Проверить решение».`);
    return text + line("Ошибка прогноза",
      `Проверка линейной регрессии на архиве за ${latest.day} июня даёт для этого сектора |прогноз − измерение| = |${n(heldOut,4)} − ${n(latest.ndvi,4)}| ≈ <b>${n(Math.abs(heldOut-latest.ndvi),4)}</b>. Среднее таких абсолютных ошибок по всем ${field.cells.length} секторам — MAE. Прогноз следующей даты можно проверить после нового измерения.`);
  }

  const stages=[null,data,route,flight,detection,mapping,coordinates,decision];
  function body(stage, state) {
    return stages[stage] ? stages[stage](state) : "";
  }
  function html(stage, state) {
    if (!stages[stage]) return "";
    return `<details class="panel wide-panel" id="stage-formulas"><summary>Формулы · ${titles[stage]}</summary><div class="panel-body formula-body">${body(stage,state)}</div></details>`;
  }
  return {html,body};
})();

if (typeof module !== "undefined" && module.exports) module.exports=SurveyFormulas;
