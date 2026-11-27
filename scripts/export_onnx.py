"""Export the served SOTA RoV Draft GNN-Transformer checkpoint to ONNX and verify numerical parity.

Usage:
    python scripts/export_onnx.py
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torch import nn

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import config  # noqa: E402
from src.search.draft_mcts import (  # noqa: E402
    MAX_HISTORY_LEN,
    ONNX_INPUT_NAMES,
    ONNX_OUTPUT_NAMES,
)
from src.train_sota_model import RoVDraftGNNTransformer  # noqa: E402

INPUT_NAMES = list(ONNX_INPUT_NAMES)
OUTPUT_NAMES = list(ONNX_OUTPUT_NAMES)


class OnnxDraftWrapper(nn.Module):
    """Wraps RoVDraftGNNTransformer with baked-in GNN embeddings for static-graph ONNX export."""

    def __init__(self, model: RoVDraftGNNTransformer):
        super().__init__()
        self.model = model
        with torch.no_grad():
            h_gnn = model.precompute_gnn_embeddings().clone().detach()
        self.register_buffer("baked_h_gnn", h_gnn)

    def forward(
        self,
        ally_picks_vec: torch.Tensor,
        enemy_picks_vec: torch.Tensor,
        ally_bans_vec: torch.Tensor,
        enemy_bans_vec: torch.Tensor,
        unavailable_mask: torch.Tensor,
        tok_heroes: torch.Tensor,
        tok_types: torch.Tensor,
        tok_steps: torch.Tensor,
        tok_pad_mask: torch.Tensor,
        meta_ctx: torch.Tensor,
        action_type: torch.Tensor,
        phase: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        self.model._cached_h_gnn = self.baked_h_gnn
        return self.model(
            ally_picks_vec,
            enemy_picks_vec,
            ally_bans_vec,
            enemy_bans_vec,
            unavailable_mask,
            tok_heroes,
            tok_types,
            tok_steps,
            tok_pad_mask,
            meta_ctx,
            action_type,
            phase,
        )


def _sample_arrays(batch_size: int, num_heroes: int, meta_dim: int, seed: int = 42) -> tuple[np.ndarray, ...]:
    rng = np.random.default_rng(seed)
    ap = np.zeros((batch_size, num_heroes), dtype=np.float32)
    ep = np.zeros((batch_size, num_heroes), dtype=np.float32)
    ab = np.zeros((batch_size, num_heroes), dtype=np.float32)
    eb = np.zeros((batch_size, num_heroes), dtype=np.float32)
    unavail = np.zeros((batch_size, num_heroes), dtype=np.bool_)
    tok_heroes = np.zeros((batch_size, MAX_HISTORY_LEN), dtype=np.int64)
    tok_types = np.zeros((batch_size, MAX_HISTORY_LEN), dtype=np.int64)
    tok_steps = np.zeros((batch_size, MAX_HISTORY_LEN), dtype=np.int64)
    tok_pad = np.ones((batch_size, MAX_HISTORY_LEN), dtype=np.bool_)
    meta = np.zeros((batch_size, meta_dim), dtype=np.float32)
    act_types = np.zeros(batch_size, dtype=np.int64)
    phases = np.ones(batch_size, dtype=np.int64)

    for b in range(batch_size):
        chosen = rng.choice(num_heroes, size=10, replace=False)
        b_bans = chosen[:2].tolist()
        r_bans = chosen[2:4].tolist()
        b_picks = chosen[4:7].tolist()
        r_picks = chosen[7:10].tolist()
        ap[b, b_picks] = 1.0
        ep[b, r_picks] = 1.0
        ab[b, b_bans] = 1.0
        eb[b, r_bans] = 1.0
        unavail[b, chosen] = True
        seq = [
            (b_bans[0], 3, 0),
            (r_bans[0], 4, 1),
            (b_bans[1], 3, 2),
            (r_bans[1], 4, 3),
            (b_picks[0], 1, 4),
            (r_picks[0], 2, 5),
            (r_picks[1], 2, 6),
            (b_picks[1], 1, 7),
            (b_picks[2], 1, 8),
            (r_picks[2], 2, 9),
        ]
        k = len(seq)
        tok_heroes[b, :k], tok_types[b, :k], tok_steps[b, :k] = zip(*seq, strict=True)
        tok_pad[b, :k] = False
        meta[b, 0] = 3.0 / 5.0
        meta[b, 1] = 3.0 / 5.0
        meta[b, 2] = 0.0
        meta[b, 3] = 0.0
        meta[b, 4] = 1.0
        meta[b, 7] = 1.0
        act_types[b] = 1 if b % 2 == 0 else 0
        phases[b] = 2 if b % 3 == 0 else 1

    return ap, ep, ab, eb, unavail, tok_heroes, tok_types, tok_steps, tok_pad, meta, act_types, phases


def export_model(pt_path: Path, onnx_path: Path, max_diff: float = 1e-3) -> None:
    ckpt = torch.load(pt_path, map_location="cpu", weights_only=False)
    hero_names = ckpt["hero_names"]
    model_cfg = ckpt.get(
        "model_config",
        {"d_model": config.model.d_model, "nhead": config.model.nhead, "num_layers": config.model.num_layers},
    )
    model = RoVDraftGNNTransformer(
        num_heroes=len(hero_names),
        hero_features=ckpt["hero_features"],
        lane_probs=ckpt["lane_probs"],
        graphs=ckpt["graphs"],
        priors=ckpt["priors"],
        **model_cfg,
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    model.precompute_gnn_embeddings()

    wrapper = OnnxDraftWrapper(model)
    wrapper.eval()

    sample = _sample_arrays(2, len(hero_names), int(model.meta_dim), seed=7)
    sample_tensors = tuple(torch.from_numpy(a) for a in sample)
    dynamic_axes = {name: {0: "batch"} for name in [*INPUT_NAMES, *OUTPUT_NAMES]}

    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        sample_tensors,
        str(onnx_path),
        input_names=INPUT_NAMES,
        output_names=OUTPUT_NAMES,
        dynamic_axes=dynamic_axes,
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    sess_opts = ort.SessionOptions()
    sess_opts.intra_op_num_threads = 1
    sess_opts.inter_op_num_threads = 1
    sess = ort.InferenceSession(str(onnx_path), sess_options=sess_opts, providers=["CPUExecutionProvider"])

    for bs in (1, 8):
        arrays = _sample_arrays(bs, len(hero_names), int(model.meta_dim), seed=100 + bs)
        with torch.inference_mode():
            pt_logits, pt_win = model(*(torch.from_numpy(a) for a in arrays))
        ort_inputs = dict(zip(INPUT_NAMES, arrays, strict=True))
        ort_logits, ort_win = sess.run(OUTPUT_NAMES, ort_inputs)

        diff_logits = float(np.max(np.abs(pt_logits.numpy() - ort_logits)))
        diff_win = float(np.max(np.abs(pt_win.numpy() - ort_win)))
        print(f"[bs={bs}] max_abs_diff logits={diff_logits:.2e}, win={diff_win:.2e}")
        if diff_logits > max_diff or diff_win > max_diff:
            raise AssertionError(
                f"ONNX parity check failed at bs={bs}: logits={diff_logits:.6f}, win={diff_win:.6f} > {max_diff}"
            )

    bench_arrays = _sample_arrays(1, len(hero_names), int(model.meta_dim), seed=999)
    bench_tensors = tuple(torch.from_numpy(a) for a in bench_arrays)
    ort_bench = dict(zip(INPUT_NAMES, bench_arrays, strict=True))
    for _ in range(10):
        with torch.inference_mode():
            model(*bench_tensors)
        sess.run(OUTPUT_NAMES, ort_bench)

    t0 = time.perf_counter()
    with torch.inference_mode():
        for _ in range(100):
            model(*bench_tensors)
    pt_ms = (time.perf_counter() - t0) * 1000.0 / 100.0

    t0 = time.perf_counter()
    for _ in range(100):
        sess.run(OUTPUT_NAMES, ort_bench)
    ort_ms = (time.perf_counter() - t0) * 1000.0 / 100.0

    pt_mb = pt_path.stat().st_size / (1024 * 1024)
    onnx_mb = onnx_path.stat().st_size / (1024 * 1024)
    print(f"Exported {onnx_path} ({onnx_mb:.2f} MB vs PyTorch {pt_mb:.2f} MB)")
    print(f"CPU bs=1 latency: PyTorch={pt_ms:.2f} ms, ONNX={ort_ms:.2f} ms")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export RoV SOTA draft model to ONNX and verify numerical parity.")
    parser.add_argument("--pt", type=Path, default=config.paths.sota_model_path)
    parser.add_argument(
        "--out",
        type=Path,
        default=config.paths.sota_model_path.with_suffix(".onnx"),
    )
    parser.add_argument("--max-diff", type=float, default=1e-3)
    args = parser.parse_args()
    export_model(args.pt, args.out, max_diff=args.max_diff)


if __name__ == "__main__":
    main()
