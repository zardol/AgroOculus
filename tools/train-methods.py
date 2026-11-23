"""Refit the browser comparison on the field simulator. Needs Node.js, NumPy, scikit-learn and XGBoost."""
import json
from pathlib import Path
import subprocess

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures, StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

def node(script, data=None):
    completed = subprocess.run(
        ["node", "-e", script], cwd=ROOT, input=data, text=True,
        encoding="utf8", capture_output=True, check=True,
    )
    return json.loads(completed.stdout)

def export_tree(tree):
    model = tree.tree_
    nodes = []
    for i in range(model.node_count):
        if model.children_left[i] == model.children_right[i]:
            counts = model.value[i, 0]
            nodes.append([float(counts[1] / counts.sum())])
        else:
            nodes.append([int(model.feature[i]), float(model.threshold[i]),
                          int(model.children_left[i]), int(model.children_right[i])])
    return nodes

def export_booster(raw):
    nodes = {}
    def visit(node):
        if "leaf" in node:
            nodes[node["nodeid"]] = [node["leaf"]]
        else:
            nodes[node["nodeid"]] = [int(node["split"][1:]), node["split_condition"], node["yes"], node["no"]]
            for child in node["children"]:
                visit(child)
    visit(json.loads(raw))
    return [nodes[i] for i in range(len(nodes))]

def train():
    histories = node("const f=require('./dist/model.js');console.log(JSON.stringify(f.cells.map(c=>f.series(c.id))))")
    # Each sample sees its two most recent observations, three days apart.
    X, y, remaining = [], [], []
    for history in histories:
        for i in range(1, len(history)):
            current, prior = history[i]["ndvi"], history[i - 1]["ndvi"]
            features = [current, current - prior]
            if i + 1 < len(history) and history[i + 1]["day"] <= 15:
                X.append(features)
                y.append(history[i + 1]["ndvi"])
            else:
                remaining.append(features)
    assert len(X) == 72 and len(remaining) == 48
    X, y = np.array(X), np.array(y)
    target = np.asarray(y < .45, dtype=int)
    linear = LinearRegression().fit(X, y)
    poly = PolynomialFeatures(degree=2, include_bias=False)
    quadratic = LinearRegression().fit(poly.fit_transform(X), y)
    scaler = StandardScaler().fit(X)
    svm = SVC(C=1, kernel="linear", class_weight="balanced").fit(scaler.transform(X), target)
    svm_coef = svm.coef_[0] / scaler.scale_
    svm_bias = float(svm.intercept_[0] - svm_coef @ scaler.mean_)
    tree = DecisionTreeClassifier(max_depth=3, min_samples_leaf=2, class_weight="balanced", random_state=31).fit(X, target)
    forest = RandomForestClassifier(n_estimators=17, max_depth=3, min_samples_leaf=2,
                                    class_weight="balanced_subsample", random_state=31, n_jobs=1).fit(X, target)
    boost = XGBClassifier(
        n_estimators=14, max_depth=2, learning_rate=.18, base_score=.5,
        scale_pos_weight=float((target == 0).sum() / target.sum()), objective="binary:logistic",
        random_state=31, n_jobs=1,
    ).fit(X, target)
    packed = {
        "linear": [float(linear.intercept_), *linear.coef_.tolist()],
        "polynomial": [float(quadratic.intercept_), *quadratic.coef_.tolist()],
        "svm": [svm_bias, *svm_coef.tolist()],
        "tree": export_tree(tree),
        "forest": [export_tree(t) for t in forest.estimators_],
        "booster": [export_booster(t) for t in boost.get_booster().get_dump(dump_format="json")],
    }
    file = DIST / "methods.js"
    source = file.read_text(encoding="utf8")
    begin, end = "// BEGIN LEARNED PARAMETERS", "// END LEARNED PARAMETERS"
    before, _, tail = source.partition(begin)
    _, marker, after = tail.partition(end)
    if not marker:
        raise ValueError("Cannot locate parameter block in methods.js")
    parameter_json = json.dumps(packed, separators=(",", ":"), allow_nan=False)
    updated = before + begin + "\n  const trained = " + parameter_json + ";\n  " + end + after
    file.write_text(updated, encoding="utf8", newline="\n")

    # Compare the deployed JS representation to every original estimator on all 120 windows.
    all_inputs = np.vstack((X, remaining))
    native = np.column_stack((
        linear.predict(all_inputs), quadratic.predict(poly.transform(all_inputs)),
        svm.predict(scaler.transform(all_inputs)), tree.predict(all_inputs),
        forest.predict(all_inputs), boost.predict(all_inputs),
    ))
    script = ("const m=require('./dist/methods.js');const rows=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "console.log(JSON.stringify(rows.map(([v,d])=>m.predict(v,v-d).slice(0,6))))")
    portable = np.asarray(node(script, json.dumps(all_inputs.tolist())), dtype=float)
    try:
        np.testing.assert_allclose(portable, native, rtol=1e-9, atol=1e-10)
    except Exception:
        file.write_text(source, encoding="utf8", newline="\n")
        raise
    print(f"Trained on {len(X)} earlier windows ({target.sum()} positive). Verified {len(native)} browser predictions.")

if __name__ == "__main__":
    train()
