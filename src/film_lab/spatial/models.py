"""Optional upstream inference adapters with explicit provenance and no bundled weights.

Depth Anything 3 predictions are distance (smaller=near). Export uses near=1.
MatAnyone2 uses its official CLI; the repo's license is NON-COMMERCIAL.
"""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import cv2
import numpy as np

from .io import frame_files, grayscale_map, manifest, map_file, rgb_image, save_mask


def import_sequence(source: Path, dest: Path, frames: list[Path],
                    kind: str, near_black: bool = False) -> int:
    """Import a numbered 1:1 image/map sequence. No implicit interpolation or guessing."""
    inputs = sorted(p for p in source.iterdir() if p.suffix.lower()
                    in (".png", ".npy", ".tif", ".tiff"))
    if len(inputs) != len(frames):
        raise ValueError(f"Expected {len(frames)} {kind} maps, found {len(inputs)}")
    dest.mkdir(parents=True, exist_ok=True)
    for i, (src, frame) in enumerate(zip(inputs, frames)):
        h, w = rgb_image(frame).shape[:2]
        arr = grayscale_map(src, h, w)
        if near_black:
            arr = 1 - arr
        if kind == "alpha":
            save_mask(dest / f"{i:06d}.png", arr)
        else:
            np.save(dest / f"{i:06d}.npy", arr.astype(np.float32))
    manifest(dest / "provenance.json", {"provider": "user-import", "kind": kind,
                                       "frames": len(frames), "near_black": near_black,
                                       "convention": "near=1" if kind == "depth" else "subject=1"})
    return len(frames)


def depth_da3(frames: list[Path], output: Path,
              model_id: str = "depth-anything/DA3-BASE",
              device: str = "cuda", window: int = 12) -> int:
    """Infer multi-view windows, then normalize one common depth range for the entire clip.

    Window boundaries may still need cross-window geometric alignment in difficult shots.
    """
    try:
        from depth_anything_3.api import DepthAnything3
    except ImportError as exc:
        raise RuntimeError("Install official Depth Anything 3 in a separate inference venv") from exc
    import torch

    if not frames:
        raise ValueError("No frames")
    if window < 1:
        raise ValueError("window must be >=1")
    model = DepthAnything3.from_pretrained(model_id).to(device=torch.device(device))
    model.eval()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="da3-raw-") as temporary:
        tmp = Path(temporary)
        samples = []
        for start in range(0, len(frames), window):
            batch = frames[start:start + window]
            with torch.inference_mode():
                prediction = model.inference([str(p) for p in batch])
            raw = np.asarray(prediction.depth, np.float32)
            if raw.ndim != 3 or len(raw) != len(batch):
                raise ValueError(f"Unexpected DA3 depth shape {raw.shape}")
            for j, f in enumerate(batch):
                hh, ww = rgb_image(f).shape[:2]
                depth = cv2.resize(raw[j], (ww, hh), interpolation=cv2.INTER_LINEAR)
                if not np.isfinite(depth).all():
                    raise ValueError(f"Non-finite DA3 output at frame {start+j}")
                np.save(tmp / f"{start+j:06d}.npy", depth)
                valid = depth[np.isfinite(depth) & (depth > 0)]
                if valid.size:
                    samples.append(valid[::max(1, valid.size // 6000)])
        if not samples:
            raise ValueError("No positive depth predictions")
        near, far = np.percentile(np.concatenate(samples), [3, 97])
        if far - near < 1e-6:
            raise ValueError("Depth range collapsed; geometry cannot be calibrated")
        for i in range(len(frames)):
            d = np.load(tmp / f"{i:06d}.npy", allow_pickle=False)
            close = np.clip((far - d) / (far - near), 0, 1)
            np.save(output / f"{i:06d}.npy", close.astype(np.float32))
    manifest(output / "provenance.json", {"provider": "Depth Anything 3",
             "model": model_id, "device": device, "window": window, "frames": len(frames),
             "normalization": "shared 3rd/97th percentiles of distance over clip; near=1",
             "warning": "Relative depth is not calibrated physical distance. Inspect window seams."})
    return len(frames)


def matanyone2(frames_dir: Path, first_mask: Path, output: Path,
               upstream: Path, max_size: int = -1) -> int:
    """Run the published MatAnyone2 inference script with --save_image.

    Check S-Lab License 1.0 first: non-commercial unless permission is granted.
    """
    script = upstream.resolve() / "inference_matanyone2.py"
    frames = frame_files(frames_dir)
    if not script.is_file():
        raise FileNotFoundError(f"Missing official upstream inference script: {script}")
    if not first_mask.is_file() or not frames:
        raise ValueError("Provide a first-frame subject mask and a nonempty frame sequence")
    with tempfile.TemporaryDirectory(prefix="matanyone-") as tmp:
        work = Path(tmp)
        cmd = [sys.executable, str(script), "-i", str(frames_dir.resolve()),
               "-m", str(first_mask.resolve()), "-o", str(work),
               "--save_image", "--max_size", str(max_size)]
        subprocess.run(cmd, cwd=upstream.resolve(), check=True)
        # The published script writes <output>/<input folder>/pha/0000.png ...
        alpha_dir = work / frames_dir.name / "pha"
        raw = sorted(alpha_dir.glob("*.png"))
        if len(raw) != len(frames):
            raise RuntimeError(f"MatAnyone2 yielded {len(raw)} maps, expected {len(frames)}")
        output.mkdir(parents=True, exist_ok=True)
        for i, (a, f) in enumerate(zip(raw, frames)):
            h, w = rgb_image(f).shape[:2]
            # If the inference was downsampled, upsample the alpha, not a mask threshold.
            matte = cv2.imread(str(a), cv2.IMREAD_GRAYSCALE)
            if matte is None:
                raise RuntimeError(f"Unreadable alpha {a}")
            if matte.shape != (h, w):
                matte = cv2.resize(matte, (w, h), interpolation=cv2.INTER_LINEAR)
            save_mask(output / f"{i:06d}.png", matte.astype(np.float32) / 255)
    manifest(output / "provenance.json", {
        "provider": "MatAnyone 2", "frames": len(frames), "max_size": max_size,
        "license": "S-Lab License 1.0, non-commercial; confirm rights before commercial use",
        "upstream": "https://github.com/pq-yang/MatAnyone2"})
    return len(frames)
