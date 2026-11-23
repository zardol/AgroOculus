"use strict";

const Charts = (() => {
  const teal = "#75e0cf", amber = "#f3c572", blue = "#a9bcff", red = "#ffa99b";
  const ink = "#b6c7c4", grid = "#324447", ground = "#101719";
  const number = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 4});
  const format = value => Number.isFinite(value) ? number.format(value) : "—";
  const escape = value => String(value).replace(/[&<>"']/g, chr =>
    ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[chr]);

  function figure(title, context, xml) {
    return `<figure class="panel wide-panel measure-chart" style="margin:15px 0 0">
      <figcaption class="panel-heading"><h2>${escape(title)}</h2><span class="smallmeta">${escape(context)}</span></figcaption>
      <div class="panel-body">${xml}</div></figure>`;
  }

  function valuesTable(headings, rows) {
    const th = headings.map(title => `<th scope="col">${escape(title)}</th>`).join("");
    const tr = rows.map(row => "<tr>" + row.map((value, i) => i === 0
      ? `<th scope="row" style="position:static">${escape(value)}</th>`
      : `<td>${escape(value)}</td>`).join("") + "</tr>").join("");
    return `<details class="chart-values"><summary>Значения на графике</summary>
      <div class="tablewrap" tabindex="0" role="region" aria-label="Числовые значения графика">
      <table class="data-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div></details>`;
  }

  function mark(type, x, y, color) {
    if (type === "diamond") {
      return `<svg x="${x}" y="${y}" overflow="visible" width="1" height="1"><path d="M0 -5 5 0 0 5 -5 0 Z" fill="${color}"/></svg>`;
    }
    if (type === "ring") return `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    return `<circle cx="${x}" cy="${y}" r="3.4" fill="${color}" stroke="${ground}"/>`;
  }

  function key(series) {
    const swatches = series.map(s => {
      const glyph = s.type === "ring" || s.type === "diamond"
        ? mark(s.type, 10, 7, s.color)
        : `<path d="M0 7h21" fill="none" stroke="${s.color}" stroke-width="2.4"${s.dash ? ' stroke-dasharray="5 3"' : ""}/>`;
      const value = Number.isFinite(s.value) ? ` <b style="font-variant-numeric:tabular-nums">${format(s.value)}</b>` : "";
      return `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">
        <svg aria-hidden="true" width="22" height="14">${glyph}</svg>${escape(s.label)}${value}</span>`;
    }).join("");
    return `<div style="display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13px;margin-bottom:6px">${swatches}</div>`;
  }

  // Use percentage positions for ticks and fixed-size screen text. Only the
  // line geometry stretches; a small screen retains legible labels and points.
  function linePlot(rows, series, {title, xLabel, yLabel, xTicks, yTicks, threshold}) {
    const lowX = rows[0].x, rangeX = rows.at(-1).x - lowX || 1;
    const lowY = yTicks[0], rangeY = yTicks.at(-1) - lowY;
    const sx = value => 13 + 82 * (value - lowX) / rangeX;
    const sy = value => 128 - 99 * (value - lowY) / rangeY;
    const text = (x, y, value, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}">${escape(value)}</text>`;
    let svg = `<svg role="img" aria-label="${escape(title)}" width="100%" height="179" style="display:block" font-family="inherit" font-size="12" fill="${ink}">
      <title>${escape(title)}</title>${text("13%", 14, yLabel, "start")}`;
    for (const value of yTicks) {
      const y = sy(value);
      svg += `<line x1="13%" x2="95%" y1="${y}" y2="${y}" stroke="${grid}"/>` + text("10.6%", y + 4, format(value), "end");
    }
    for (const value of xTicks) svg += text(sx(value) + "%", 148, format(value), "middle");
    svg += text("95%", 169, xLabel, "end");
    if (Number.isFinite(threshold)) {
      svg += `<line x1="13%" x2="95%" y1="${sy(threshold)}" y2="${sy(threshold)}" stroke="${amber}" stroke-width="1.6" stroke-dasharray="5 3"/>`;
    }
    for (const s of series) {
      let path = "", previous, dots = "";
      for (const record of rows) {
        const v = record[s.field];
        if (!Number.isFinite(v)) { previous = undefined; continue; }
        const x = 1000 * (record.x - lowX) / rangeX, y = sy(v);
        if (!previous) path += `M${x.toFixed(2)} ${y.toFixed(2)}`;
        else if (s.type === "step") path += `H${x.toFixed(2)}V${y.toFixed(2)}`;
        else path += `L${x.toFixed(2)} ${y.toFixed(2)}`;
        if (s.points || !previous || record === rows.at(-1)) {
          const detail = escape(`${s.label} · ${format(record.x)} · ${format(v)}`);
          dots += `<g><title>${detail}</title>${mark(s.type, sx(record.x) + "%", y, s.color)}</g>`;
        }
        previous = record;
      }
      if (s.type !== "ring" && s.type !== "diamond") {
        svg += `<svg x="13%" y="0" width="82%" height="179" viewBox="0 0 1000 179" preserveAspectRatio="none" overflow="visible">
          <path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.3" vector-effect="non-scaling-stroke"${s.dash ? ' stroke-dasharray="5 3"' : ""}/></svg>`;
      }
      svg += dots;
    }
    return svg + "</svg>";
  }

  function bands(records) {
    const title = "Отражение в двух каналах";
    if (!records.length) return figure(title, "", "<p>Нет архивных измерений.</p>");
    const series = [
      {field:"red", label:"Red · красный", color:red, points:true},
      {field:"nir", label:"NIR · ближний ИК", color:teal, points:true, dash:true},
    ];
    const rows = records.map(r => ({...r, x:r.day}));
    const chart = linePlot(rows, series, {title, xLabel:"День июня", yLabel:"Коэффициент отражения",
      xTicks:rows.map(r=>r.x), yTicks:[0, .25, .5, .75, 1]});
    return figure(title, "Архив · " + records[0].id, key(series) + chart +
      valuesTable(["Июнь, день", "Red", "NIR"], rows.map(r=>[r.day,format(r.red),format(r.nir)])));
  }

  function ndvi(records, observation, threshold) {
    const title = "Индекс растительности по датам";
    if (!records.length) return figure(title, "", "<p>Нет архивных измерений.</p>");
    const rows = records.map(r => ({x:r.day, archived:r.ndvi}));
    const available = observation?.available && observation.cell === records[0].id;
    const series = [{field:"archived", label:"Измерения архива", color:teal, points:true}];
    if (available && Number.isFinite(observation.ndvi)) {
      rows.at(-1).current = observation.ndvi;
      series.push({field:"current", label:"Кадр сеанса", color:red, type:"ring", value:observation.ndvi});
    }
    if (available && Number.isFinite(observation.forecast)) {
      // Six June surveys are three days apart. The forecast is for the following survey.
      const last = rows.at(-1).x;
      rows.push({x:last + 3, prediction:observation.forecast});
      series.push({field:"prediction", label:"Прогноз CNN–LSTM", color:blue, type:"diamond", value:observation.forecast});
    }
    const hasNegative = rows.some(r => series.some(s=>r[s.field]<0)) || threshold<0;
    const yTicks = hasNegative ? [-1, -.5, 0, .5, 1] : [0, .25, .5, .75, 1];
    const legend = Number.isFinite(threshold)
      ? [...series, {label:"Порог " + format(threshold), color:amber, dash:true}] : series;
    const chart = linePlot(rows, series, {title, xLabel:"День июня", yLabel:"NDVI", xTicks:rows.map(r=>r.x), yTicks, threshold});
    const table = valuesTable(["Июнь, день", ...series.map(s=>s.label)],
      rows.map(r=>[r.x,...series.map(s=>format(r[s.field]))]));
    const note = observation && !available ? "<p>Для этого сектора пока нет текущего кадра и прогноза сеанса.</p>" : "";
    return figure(title, "Сектор " + records[0].id, key(legend) + chart + note + table);
  }

  const names = {rows:"Галсы", circle:"Круг", eight:"Восьмёрка", custom:"По точкам"};
  function routes(comparison, selected) {
    const title = "Сравнение маршрутов";
    if (!comparison.length) return figure(title, "", "<p>Нет рассчитанных маршрутов.</p>");
    const measures = [
      {field:"covered", label:"Охват поля, секторы", max:24, color:teal},
      {field:"length", label:"Длина пути, м", max:Math.max(1,...comparison.map(p=>p.length)), color:blue},
    ];
    const graphs = measures.map(m => {
      const tracks = comparison.map((p, i)=>{
        const y = 20 + i*27;
        const length = 46 * p[m.field] / m.max;
        const label = names[p.kind] || p.kind;
        const value = m.field === "length" ? Math.round(p.length) : p.covered;
        return `<g><text x="0" y="${y+4}" fill="${p.kind===selected?"#f3f9f7":ink}" font-weight="${p.kind===selected?650:400}">${escape(label)}</text>
          <rect x="29%" y="${y-4}" width="46%" height="8" fill="${grid}"/>
          <rect x="29%" y="${y-4}" width="${length}%" height="8" fill="${m.color}"/>
          <text x="100%" y="${y+4}" text-anchor="end">${format(value)}</text></g>`;
      }).join("");
      return `<section><h3 style="margin:0">${m.label}</h3><svg width="100%" height="${comparison.length*27+16}" role="img" font-size="13" font-family="inherit" fill="${ink}" aria-label="${m.label}">${tracks}</svg></section>`;
    }).join("");
    const table = valuesTable(["Маршрут","Посещено из 24","Длина, м"],comparison.map(p=>[names[p.kind]||p.kind,p.covered,format(p.length)]));
    return figure(title, names[selected] ? "Выбран маршрут «" + names[selected] + "»" : "",
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,235px),1fr));gap:12px 28px">${graphs}</div>` + table);
  }

  function telemetry(history, errors) {
    const title = errors ? "Ошибка положения во время полёта" : "Скорость во время полёта";
    const unit = errors ? "м" : "м/с";
    const series = errors ? [
      {field:"gpsError", label:"Исходный GPS", color:amber, dash:true},
      {field:"fusedError", label:"GPS и ориентиры", color:teal},
    ] : [
      {field:"targetSpeed", label:"Уставка оператора", color:amber, dash:true, type:"step"},
      {field:"speed", label:"Фактическая скорость", color:teal},
    ];
    const end = history.at(-1)?.elapsed;
    const rows = history.filter(r => Number.isFinite(r.elapsed) && r.elapsed >= end-60)
      .map(r => ({...r, x:r.elapsed}));
    if (!rows.length) return figure(title, "", "<p>Показания появятся во время полёта.</p>");
    const start = rows[0].x;
    const xTicks = start===end ? [start] : [start,(start+end)/2,end];
    const peak = rows.reduce((max,r)=>series.reduce((v,s)=>Number.isFinite(r[s.field]) ? Math.max(v,r[s.field]):v,max),1);
    const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
    const stride = [1,2,2.5,5,10].find(n=>n * magnitude >= peak / 4) * magnitude;
    const yTicks = Array.from({length:5},(_,i)=>i*stride);
    const label = errors ? "Накопленная RMSE, м" : "Скорость, м/с";
    const chart = linePlot(rows, series, {title, xLabel:"Модельное время, с", yLabel:label, xTicks, yTicks});
    const table = valuesTable(["Время, с",...series.map(s=>`${s.label}, ${unit}`)],
      rows.map(r=>[format(r.x),...series.map(s=>format(r[s.field]))]));
    const window = `${format(start)}–${format(end)} с`;
    return figure(title, rows.length===1 ? "Начальный замер" : window, key(series) + chart + table);
  }

  function landmarks(history) {
    const title = "Пополнение карты ориентирами";
    if (!history.length) return figure(title, "", "<p>Для карты ещё нет наблюдений.</p>");
    const rows = [];
    // This is a counter sampled each second. Retaining changes reconstructs
    // its exact step function, even when the completed route is hours long.
    for (const record of history) {
      if (!Number.isFinite(record.elapsed) || !Number.isInteger(record.landmarks) || record.landmarks<0) continue;
      if (!rows.length || rows.at(-1).count!==record.landmarks || record===history.at(-1)) {
        rows.push({x:record.elapsed, count:record.landmarks});
      }
    }
    if (!rows.length) return figure(title, "", "<p>Для карты ещё нет наблюдений.</p>");
    const start = rows[0].x, end = rows.at(-1).x;
    const stride = Math.max(1,Math.ceil(Math.max(...rows.map(r=>r.count))/4));
    const series = [{field:"count", label:"Ориентиры на карте", type:"step", color:teal, points:true}];
    const chart = linePlot(rows, series, {title, xLabel:"Модельное время, с", yLabel:"Число ориентиров",
      xTicks:start===end ? [start] : [start,(start+end)/2,end], yTicks:[0,stride,2*stride,3*stride,4*stride]});
    const caption = end===start ? "Первый замер у старта. Запустите полёт, чтобы увидеть новые наблюдения."
      : "Ступень вверх означает, что в карту добавлены новые ориентиры. Таблица включает начало, изменения счётчика и последний замер.";
    return figure(title, end===start ? "Начальный замер" : `${format(start)}–${format(end)} с`,
      chart + `<p>${caption}</p>` + valuesTable(["Время, с","Ориентиры, шт."],rows.map(r=>[format(r.x),r.count])));
  }

  return {bands, ndvi, routes, landmarks, speed:history=>telemetry(history,false), positionErrors:history=>telemetry(history,true)};
})();

if (typeof module !== "undefined" && module.exports) module.exports = Charts;
