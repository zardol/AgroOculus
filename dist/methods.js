"use strict";
const SurveyMethods = (() => {
  const field = typeof Field !== "undefined" ? Field : require("./model.js");
  // Trained with tools/train-methods.py. Linear terms use last NDVI, then its three-day change.
  // BEGIN LEARNED PARAMETERS
  const trained = {"linear":[-0.05484169268165251,1.0943894871351898,-0.019581575443581488],"polynomial":[-0.0905544116163427,1.2429443851420086,0.24744209892228225,-0.13718482195417298,-0.6080606505052277,-2.9003863114081616],"svm":[10.000446306590415,-20.252079191199883,-14.70694352888648],"tree":[[0,0.46771544218063354,1,4],[0,0.4493080973625183,2,3],[1.0],[0.848],[0.0]],"forest":[[[1,0.006477848393842578,1,4],[0,0.48507751524448395,2,3],[1.0],[0.0],[1,0.008314414881169796,5,6],[0.0],[0.0]],[[0,0.46771544218063354,1,2],[1.0],[0.0]],[[0,0.49494241178035736,1,4],[0,0.4493080973625183,2,3],[1.0],[0.9122807017543859],[0.0]],[[0,0.46771544218063354,1,2],[1.0],[0.0]],[[0,0.48261047899723053,1,2],[1.0],[0.0]],[[0,0.49494241178035736,1,4],[0,0.4493080973625183,2,3],[1.0],[0.9009009009009009],[0.0]],[[1,0.010335036553442478,1,6],[1,-0.03746636025607586,2,3],[1.0],[0,0.48507751524448395,4,5],[1.0],[0.0],[0.0]],[[1,-0.01835315115749836,1,6],[1,-0.0295042023062706,2,3],[1.0],[1,-0.02543767262250185,4,5],[0.6805555555555556],[1.0],[1,0.012476992327719927,7,10],[0,0.49643079936504364,8,9],[1.0],[0.0],[0,0.5321551859378815,11,12],[0.0],[0.0]],[[1,-0.004209177102893591,1,6],[1,-0.03502670116722584,2,3],[1.0],[0,0.4851893037557602,4,5],[1.0],[0.0],[1,0.00669717532582581,7,10],[0,0.5190446376800537,8,9],[0.8194444444444444],[0.0],[0.0]],[[1,-0.000910760456463322,1,4],[0,0.4851893037557602,2,3],[1.0],[0.0],[0,0.49721749126911163,5,6],[0.6941176470588235],[0.0]],[[0,0.46771544218063354,1,2],[1.0],[0.0]],[[0,0.46771544218063354,1,2],[1.0],[0.0]],[[1,0.010253718588501215,1,8],[1,-0.01607753150165081,2,5],[0,0.4827222675085068,3,4],[1.0],[0.0],[1,-0.011171999387443066,6,7],[0.0],[0.5795698924731183],[1,0.013279525097459555,9,10],[0.0],[0.0]],[[0,0.46771544218063354,1,6],[1,-0.01881857868283987,2,3],[1.0],[0,0.44804538786411285,4,5],[1.0],[0.6805555555555556],[1,-0.01895239669829607,7,8],[0.0],[0.0]],[[0,0.48261047899723053,1,6],[1,-0.01881857868283987,2,3],[1.0],[1,-0.005602178280241787,4,5],[0.7222222222222222],[1.0],[0.0]],[[0,0.4652484059333801,1,2],[1.0],[0,0.525064617395401,3,4],[0.0],[0.0]],[[0,0.48507751524448395,1,2],[1.0],[0.0]]],"booster":[[[0,0.469990522,1,2],[0.322758645],[-0.334285706]],[[0,0.469990522,1,2],[0.275704116],[-0.286215454]],[[0,0.469990522,1,2],[0.24458608],[-0.25519976]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.233364403],[0.234012231],[0.0739624053]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.217002362],[0.217144981],[0.0675304756]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.204117],[0.203879207],[0.0617078356]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.193529323],[0.192987278],[0.0564220175]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.184495866],[0.183699787],[0.0516135134]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.176525369],[0.175511345],[0.0472323559]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.169283643],[0.168080166],[0.0432357527]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.162540168],[0.161172181],[0.0395866819]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.156136721],[0.154627785],[0.0362525359]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.149967715],[0.148341209],[0.0332044847]],[[0,0.469990522,1,2],[0,0.450065881,3,4],[-0.14396666],[0.142246276],[0.0304169226]]]};
  // END LEARNED PARAMETERS

  const bounded = x => Math.max(0, Math.min(1, x));
  function memberships(x, width) {
    return [bounded(-x / width), bounded(1 - Math.abs(x) / width), bounded(x / width)];
  }

  function risk(ndvi, prior, threshold = 0.45) {
    if (![ndvi, prior, threshold].every(Number.isFinite)) throw new Error("Для расчёта риска нужны три числа.");
    const levels = memberships(ndvi - threshold, 0.12);
    const trend = memberships(ndvi - prior, 0.045);
    // Rows: below/near/above threshold; columns: falling/steady/rising.
    const rules = [[2, 2, 1], [2, 1, 0], [1, 0, 0]], activation = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const output = rules[i][j];
      activation[output] = Math.max(activation[output], Math.min(levels[i], trend[j]));
    }
    let moment = 0, area = 0;
    for (let value = 0; value <= 100; value++) {
      const sets = memberships(value - 50, 40);
      const weight = Math.max(...sets.map((value, i) => Math.min(value, activation[i])));
      moment += value * weight;
      area += weight;
    }
    return moment / area;
  }

  function treeValue(tree, features) {
    let node = tree[0];
    while (node.length !== 1) {
      const [feature, limit, left, right] = node;
      node = tree[features[feature] <= limit ? left : right];
    }
    return node[0];
  }

  function boosterValue(tree, features) {
    let node = tree[0];
    while (node.length !== 1) {
      const [feature, limit, left, right] = node;
      node = tree[features[feature] < Math.fround(limit) ? left : right];
    }
    return node[0];
  }

  function predict(ndvi, prior) {
    const delta = ndvi - prior;
    const linear = c => c[0] + c[1] * ndvi + c[2] * delta;
    const polynomial = trained.polynomial;
    const squared = linear(polynomial) + polynomial[3] * ndvi * ndvi + polynomial[4] * ndvi * delta + polynomial[5] * delta * delta;
    const features = [Math.fround(ndvi), Math.fround(delta)];
    const forestMean = trained.forest.reduce((sum, tree) => sum + treeValue(tree, features), 0) / trained.forest.length;
    const margin = trained.booster.reduce((sum, tree) => sum + boosterValue(tree, features), 0);
    return [linear(trained.linear), squared, linear(trained.svm) > 0, treeValue(trained.tree, features) > .5,
      forestMean > .5, margin > 0, risk(ndvi, prior) >= 50];
  }

  const names = ["Линейная регрессия", "Полиномиальная регрессия", "SVM", "Дерево решений", "Случайный лес", "XGBoost", "Система Мамдани"];
  const fmt = n => n.toLocaleString("ru-RU", {minimumFractionDigits: 3, maximumFractionDigits: 3});
  let scores;
  function controlScores() {
    if (scores) return scores;
    const errors = [0, 0], confusion = Array.from({length: 5}, () => ({tp:0,fp:0,fn:0}));
    for (const cell of field.cells) {
      const history = field.series(cell.id), actual = history.at(-1).ndvi;
      const predicted = predict(history.at(-2).ndvi, history.at(-3).ndvi);
      for (let i = 0; i < 2; i++) errors[i] += Math.abs(predicted[i] - actual);
      const stressed = actual < .45;
      for (let i = 0; i < confusion.length; i++) {
        if (predicted[i + 2] && stressed) confusion[i].tp++;
        else if (predicted[i + 2]) confusion[i].fp++;
        else if (stressed) confusion[i].fn++;
      }
    }
    scores = errors.map(error => "MAE " + fmt(error / field.cells.length));
    for (const {tp,fp,fn} of confusion) scores.push("F1 " + fmt(2 * tp / (2 * tp + fp + fn || 1)));
    return scores;
  }

  function results(cellId) {
    const history = field.series(cellId);
    if (history.length < 2) throw new Error("У сектора недостаточно измерений.");
    const ndvi = history.at(-1).ndvi, prior = history.at(-2).ndvi;
    const out = predict(ndvi, prior), metrics = controlScores();
    return names.map((name, i) => {
      let value;
      if (i < 2) value = "NDVI " + fmt(out[i]);
      else if (i === 6) value = Math.round(risk(ndvi, prior)) + " / 100";
      else value = out[i] ? "Ниже 0,45" : "От 0,45";
      return [name, value, metrics[i]];
    });
  }

  return {results, risk, predict};
})();
if (typeof window !== "undefined") window.SurveyMethods = SurveyMethods;
if (typeof module !== "undefined" && module.exports) module.exports = SurveyMethods;
