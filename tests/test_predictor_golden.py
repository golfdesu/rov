"""Pins RoVDraftPredictor.predict output so performance refactors cannot change recommendations.

Regenerate tests/fixtures/predict_golden.json only for an intended behaviour change
(new checkpoint, data or scoring rules), never to make a refactor pass:

    python -c "from tests.test_predictor_golden import regenerate; regenerate()"
"""

import json
from pathlib import Path

import pytest

from src.config import config
from tests.golden_scenarios import golden_requests

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "predict_golden.json"
FLOAT_TOL = 0.05  # Cross-platform CPU BLAS tolerance (Linux glibc/OneDNN vs Windows CRT float32 rounding)


def _predictor():
    from src.predictor import RoVDraftPredictor

    return RoVDraftPredictor()


def regenerate() -> None:
    p = _predictor()
    gold = {name: p.predict(req).model_dump() for name, req in golden_requests()}
    GOLDEN_PATH.write_text(json.dumps(gold, ensure_ascii=False, indent=1), encoding="utf-8")


def _assert_same(expected, actual, path: str) -> None:
    if isinstance(expected, dict):
        assert expected.keys() == actual.keys(), path
        for k in expected:
            _assert_same(expected[k], actual[k], f"{path}.{k}")
    elif isinstance(expected, list):
        assert len(expected) == len(actual), f"{path}: length {len(expected)} != {len(actual)}"
        for i, (e, a) in enumerate(zip(expected, actual, strict=True)):
            _assert_same(e, a, f"{path}[{i}]")
    elif isinstance(expected, float):
        assert actual == pytest.approx(expected, abs=FLOAT_TOL), path
    else:
        assert expected == actual, path


@pytest.fixture(scope="module")
def predictor():
    if not config.paths.sota_model_path.exists():
        pytest.skip("No model checkpoint present")
    return _predictor()


def test_predict_matches_golden(predictor):
    gold = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    scenarios = golden_requests()
    assert set(gold) == {name for name, _ in scenarios}
    for name, req in scenarios:
        _assert_same(gold[name], predictor.predict(req).model_dump(), name)
