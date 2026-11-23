const model = "qwen-flash";
const endpoint = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const instructions = [
  "Составь для студента короткое пояснение к отчёту по учебному обследованию рисового поля.",
  "Напиши по-русски, 3–5 коротких предложений без заголовков и Markdown.",
  "Объясни сравнение NDVI с порогом и указанное программой решение. Отделяй измерения от прогноза.",
  "Используй готовое основание решения для этого сектора. Не обобщай сведения на другие секторы. Прогноз не участвует в решении. Укажи его отдельно последним предложением.",
  "Описывай изменения индекса. Физиологическое состояние и дальнейшее ухудшение растений остаются неизвестными.",
  "Используй только предоставленные данные. Не устанавливай причину низкого индекса и не приписывай данные реальному полёту.",
  "В числах используй десятичную запятую. Не придумывай результатов и действий."
].join(" ");

const sceneKinds = ["cloud","dry","dropout","clear"];
const stageNames = ["Датчики", "Маршрут", "Полёт", "Поиск признаков стресса", "Карта", "Координаты", "Решение"];
const scenarioInstructions = [
  "Ты генерируешь следующее событие симулятора обследования учебного рисового поля.",
  "Выбери одно наблюдаемое событие для указанного сектора с учётом этапа и предыдущего события.",
  "Варьируй события. cloud — на сектор упала тень облака, dry — на листьях видна подсохшая зона,",
  "dropout — пропущен кадр камеры, clear — видимость хорошая и кадр поступил без помех.",
  "Верни JSON с четырьмя полями: kind (cloud, dry, dropout или clear), intensity (целое от 1 до 3),",
  "cell (переданный код сектора без изменений), note (одно короткое предложение на русском о событии, до 180 символов).",
  "Опиши только то, что соответствует kind. Никаких численных показаний, команд или диагноза."
].join(" ");

function json(value, status = 200) {
  return Response.json(value, {status, headers: {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
}

export function reportFacts(field, sector, threshold) {
  const current = field.last(sector);
  const series = field.series(sector);
  const forecast = field.forecast(sector);
  const decision = field.decision(sector, threshold);
  const round = (n, digits) => Number(n.toFixed(digits));
  return {
    участок: "КЗ-04, синтетические измерения", сектор: sector, дата: "18 июня 2026",
    Red: current.red, NIR: current.nir, NDVI: round(current.ndvi, 3), порог: threshold,
    NDVI_15_июня: round(series.at(-2).ndvi, 3), ниже_порога: decision.low,
    индекс_снизился: decision.falling, секторов_в_связной_зоне: decision.area,
    решение: decision.repeat ? "назначить повторную съёмку" : "продолжить плановое наблюдение",
    прогноз_NDVI_на_21_июня: round(forecast.next, 3)
  };
}

function reportEvidence(facts) {
  const evidence = {сектор:facts.сектор, дата:facts.дата, источник:"учебные измерения",
    NDVI:facts.NDVI, порог:facts.порог, NDVI_15_июня:facts.NDVI_15_июня,
    решение:facts.решение, основание:facts.ниже_порога
      ? (facts.индекс_снизился ? "Индекс ниже порога и снизился с прошлой съёмки." :
         facts.секторов_в_связной_зоне > 1 ? "Индекс ниже порога и рядом есть сектор с низким индексом." :
         "Индекс ниже порога, но снижения с прошлой даты и соседнего сектора ниже порога нет.")
      : "Текущий индекс достиг порога или превышает его.",
    прогноз_NDVI_на_21_июня:facts.прогноз_NDVI_на_21_июня};
  return evidence;
}

async function askQwen(key, upstream, system, data, sampling) {
  let answer;
  try {
    answer = await upstream(endpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(25000),
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + key},
      body: JSON.stringify({model, enable_thinking: false, ...sampling,
        messages: [{role: "system", content: system}, {role: "user", content: JSON.stringify(data)}]})
    });
  } catch (error) {
    const timeout = error.name === "TimeoutError" || error.name === "AbortError";
    return {error: timeout ? "Qwen не успел ответить. Повторите запрос." : "Не удалось соединиться с Qwen. Повторите запрос позже.", status: timeout ? 504 : 502};
  }
  if (!answer.ok) {
    if (answer.status === 429) return {error: "Qwen ограничил частоту запросов или исчерпана квота. Попробуйте позже.", status: 429};
    if ([401,403].includes(answer.status)) return {error: "Qwen отклонил доступ. Проверьте серверный ключ и права на модель.", status: 502};
    if (answer.status === 402) return {error: "Qwen отклонил запрос по условиям оплаты аккаунта.", status: 502};
    return {error: "Qwen временно не может обработать запрос.", status: 502};
  }
  let result;
  try { result = await answer.json(); }
  catch { return {error: "Qwen вернул нечитаемый ответ. Повторите запрос.", status: 502}; }
  const choice = result?.choices?.[0], report = choice?.message?.content;
  if (choice?.finish_reason !== "stop" || typeof report !== "string" || !report.trim()) {
    return {error: "Qwen не вернул законченный текст. Повторите запрос.", status: 502};
  }
  return {content: report.trim()};
}

function hasFields(object, names) {
  return object !== null && typeof object === "object" && !Array.isArray(object) &&
    Object.keys(object).length === names.length && names.every(name=>Object.hasOwn(object,name));
}

async function scenarioInput(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return {error:"Передайте параметры события в формате JSON.",status:415};
  if (!request.body) return {error:"Укажите этап, сектор и предыдущее событие.",status:400};
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8",{fatal:true});
  let count = 0, text = "";
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > 256) {
        await reader.cancel();
        return {error:"Превышен размер параметров события.",status:413};
      }
      text += decoder.decode(value,{stream:true});
    }
    const input = JSON.parse(text + decoder.decode());
    if (hasFields(input,["stage","cell","previous"]) && Number.isInteger(input.stage) &&
        input.stage >= 1 && input.stage <= 7 && typeof input.cell === "string" &&
        /^[A-D][1-6]$/.test(input.cell) && sceneKinds.includes(input.previous)) return {input};
  } catch {
    return {error:"Не удалось прочитать параметры события.",status:400};
  } finally { reader.releaseLock(); }
  return {error:"Проверьте номер этапа, сектор и тип предыдущего события.",status:400};
}

async function generateScenario(input, key, upstream) {
  const context = {этап:stageNames[input.stage - 1], сектор:input.cell, предыдущее_событие:input.previous};
  const reply = await askQwen(key,upstream,scenarioInstructions,context,{
    temperature:0.9,max_tokens:220,response_format:{type:"json_object"}
  });
  if (reply.error) return reply;
  let scene;
  try { scene = JSON.parse(reply.content); } catch { /* handled with invalid fields below */ }
  if (!hasFields(scene,["kind","intensity","cell","note"]) || !sceneKinds.includes(scene.kind) ||
      !Number.isInteger(scene.intensity) || scene.intensity < 1 || scene.intensity > 3 ||
      scene.cell !== input.cell || typeof scene.note !== "string" || scene.note.length > 180 ||
      !/[а-яё]/i.test(scene.note) || /[<>\x00-\x1f\x7f`*_\[\]{}]|https?:\/\//i.test(scene.note)) {
    return {error:"Qwen вернул событие, которое симулятор не может применить. Повторите запрос.",status:502};
  }
  return {...scene,note:scene.note.trim()};
}

export function createSite(field, readAsset, upstream = fetch, fieldLab) {
  const reports = new Map();
  let pending = null;
  let scenarioPending = false;
  return {async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/api/scenario") {
      if (request.method !== "POST") return json({error:"Требуется POST."},405);
      const origin = request.headers.get("Origin");
      if ((origin && origin !== url.origin) || request.headers.get("X-Mezha-Scenario") !== "1")
        return json({error:"Запросите событие из симулятора."},403);
      if (url.search) return json({error:"Параметры события передаются в теле запроса."},400);
      const parsed = await scenarioInput(request);
      if (parsed.error) return json({error:parsed.error},parsed.status);
      if (!env.QWEN_API_KEY) return json({error:"Для генерации событий требуется серверный ключ Qwen."},503);
      if (scenarioPending) return json({error:"Qwen уже готовит событие. Дождитесь ответа."},429);
      scenarioPending = true;
      try {
        const result = await generateScenario(parsed.input,env.QWEN_API_KEY,upstream);
        return result.error ? json({error:result.error},result.status) : json(result);
      } finally { scenarioPending = false; }
    }
    if (url.pathname.startsWith("/api/report/")) {
      if (request.method !== "POST") return json({error:"Требуется POST."},405);
      const origin = request.headers.get("Origin");
      if ((origin && origin !== url.origin) || request.headers.get("X-Mezha-Report") !== "1") return json({error:"Запросите отчёт со страницы участка."},403);
      const match = /^\/api\/report\/([A-D][1-6])\/(\d{2})(?:\/(cloud|dry|dropout|clear)\/([1-3])\/([A-D][1-6])\/([0-2]))?$/.exec(url.pathname);
      if (!match || Number(match[2]) < 20 || Number(match[2]) > 80 || url.search) return json({error:"Некорректные параметры отчёта."},400);
      if (request.body) {
        const reader = request.body.getReader();
        try {
          while (true) {
            const {value,done} = await reader.read();
            if (done) break;
            if (value.byteLength) {
              await reader.cancel();
              return json({error:"Тело запроса должно быть пустым."},400);
            }
          }
        } finally { reader.releaseLock(); }
      }
      if (!env.QWEN_API_KEY) return json({error:"Для отчётов требуется серверный ключ Qwen."},503);
      const id = url.pathname;
      if (reports.has(id)) return json(reports.get(id));
      if (pending && pending.id !== id) return json({error:"Сервер составляет другой отчёт. Повторите запрос через несколько секунд."},429);
      if (!pending) {
        const threshold = Number(match[2])/100;
        let facts, evidence, system;
        if (match[3]) {
          if (!fieldLab) return json({error:"Модуль учебной камеры не загружен."},503);
          const scene = {kind:match[3],intensity:Number(match[4]),cell:match[5]};
          const observation = fieldLab.observe(match[1],scene,Number(match[6]),threshold);
          if (!observation.available) return json({error:"Кадр пропущен. Получите повторный кадр перед созданием отчёта."},409);
          const round = n => Number(n.toFixed(3));
          facts = {сектор:match[1], событие:scene.kind, сектор_события:scene.cell, интенсивность:scene.intensity,
            номер_попытки:observation.attempt + 1, Red:round(observation.red), NIR:round(observation.nir),
            NDVI:round(observation.ndvi), NDVI_до_события:round(observation.baseline),
            NDVI_после_фильтра:round(observation.filtered), прогноз_следующей_даты:round(observation.forecast),
            порог:threshold, решение:observation.repeat ? "назначить повторную съёмку" : "продолжить плановое наблюдение",
            основание:observation.reason};
          evidence = facts;
          system = [
            "Напиши связный текст о кадре учебной камеры рисового поля. Три-четыре коротких предложения на русском без заголовков.",
            "Назови сектор, измеренный NDVI и порог. Объясни предоставленное решение его основанием. Отдельно назови прогноз.",
            "Переведи тип события: clear — ясно, cloud — тень, dry — подсохший участок, dropout — первый кадр пропущен, повторный получен.",
            "Не выводи английский код события. Событие действует только в секторе события. Используй только переданные факты."
          ].join(" ");
        } else {
          facts = reportFacts(field,match[1],threshold);
          evidence = reportEvidence(facts);
          system = instructions;
        }
        const work = askQwen(env.QWEN_API_KEY,upstream,system,evidence,{temperature:0.2,max_tokens:400}).then(reply=>{
          const value = reply.error ? reply : {model,facts,report:reply.content.replace(/\b0\.(\d+)\b/g,"0,$1")};
          if (!value.error) {
            if (reports.size >= 96) reports.delete(reports.keys().next().value);
            reports.set(id,value);
          }
          return value;
        }).finally(()=>{ pending=null; });
        pending = {id,work};
      }
      const result = await pending.work;
      return result.error ? json({error:result.error},result.status) : json(result);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null,{status:405,headers:{Allow:"GET, HEAD"}});
    const asset = readAsset(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!asset) return new Response("Страница не найдена",{status:404});
    return new Response(request.method === "HEAD" ? null : asset.body,{
      headers:{"Content-Type":asset.type,"Cache-Control":"no-cache","X-Content-Type-Options":"nosniff"}
    });
  }};
}
