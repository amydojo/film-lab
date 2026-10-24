"""Model-agnostic alpha/depth continuity audit, flags and inspectable contact sheet.

Numbers are diagnostic heuristics, NOT a claim of artifact-free output.
"""
from __future__ import annotations

from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

from .io import frame_files, grayscale_map, manifest, map_file, rgb_image
from .project import Project
from .temporal import luma, scene_cut, warp_prior


def resized(arr: np.ndarray, max_side: int = 480) -> np.ndarray:
    h, w = arr.shape[:2]
    if max(h, w) <= max_side:
        return arr
    factor = max_side / max(h, w)
    return cv2.resize(arr, (max(1, round(w * factor)), max(1, round(h * factor))),
                      interpolation=cv2.INTER_AREA)


def audit(project_path: str | Path, every: int = 1,
          max_flags: int = 24) -> dict:
    if every < 1:
        raise ValueError("every must be positive")
    project_path = Path(project_path).resolve()
    project = Project.load(project_path)
    frames = frame_files(project.directory(project_path, "frames_dir"))
    if not frames:
        raise FileNotFoundError("No source frames")
    root = project_path.parent
    alpha_dir = root / project.alpha_dir
    depth_dir = root / project.depth_dir
    missing_alpha = [i for i in range(len(frames)) if map_file(alpha_dir, i) is None]
    missing_depth = [i for i in range(len(frames)) if map_file(depth_dir, i) is None]
    observations = []
    previous = None
    for i in range(0, len(frames), every):
        frame = rgb_image(frames[i])
        h, w = frame.shape[:2]
        gray = resized(luma(frame))
        a_file, d_file = map_file(alpha_dir, i), map_file(depth_dir, i)
        alpha = resized(grayscale_map(a_file, h, w)) if a_file else None
        depth = resized(grayscale_map(d_file, h, w)) if d_file else None
        row = {"frame": i, "time_seconds": round(i / project.fps, 3),
               "alpha_present": alpha is not None, "depth_present": depth is not None,
               "alpha_motion_p95": None, "depth_motion_p95": None,
               "cut": False, "flags": []}
        if previous is not None:
            prev_gray, prev_a, prev_d = previous
            cut = scene_cut(prev_gray, gray, project.scene_cut_threshold)
            row["cut"] = bool(cut)
            if not cut:
                if alpha is not None and prev_a is not None:
                    aligned = warp_prior(prev_a, prev_gray, gray)
                    # Evaluate near and within subject edges; exclude meaningless empty field.
                    active = (alpha > .02) | (aligned > .02)
                    if np.any(active):
                        residual = np.abs(alpha[active] - aligned[active])
                        row["alpha_motion_p95"] = round(float(np.percentile(residual, 95)), 4)
                        if row["alpha_motion_p95"] > .16:
                            row["flags"].append("matte instability")
                if depth is not None and prev_d is not None:
                    aligned = warp_prior(prev_d, prev_gray, gray)
                    active = ((alpha > .2) if alpha is not None else np.ones_like(depth, bool))
                    if np.any(active):
                        residual = np.abs(depth[active] - aligned[active])
                        row["depth_motion_p95"] = round(float(np.percentile(residual, 95)), 4)
                        if row["depth_motion_p95"] > .22:
                            row["flags"].append("depth discontinuity")
        if alpha is None:
            row["flags"].append("missing matte")
        if depth is None:
            row["flags"].append("missing depth")
        observations.append(row)
        previous = gray, alpha, depth

    flagged = [r for r in observations if r["flags"]]
    output = project.directory(project_path, "output_dir")
    output.mkdir(exist_ok=True, parents=True)
    report = {
        "kind": "heuristic temporal QC, not real-world visual approval",
        "frames_total": len(frames), "frames_sampled": len(observations),
        "sample_every": every, "fps": project.fps,
        "alpha_missing_total": len(missing_alpha),
        "depth_missing_total": len(missing_depth),
        "flagged_sampled_frames": len(flagged),
        "flagged": flagged[:max_flags],
        "flagged_truncated": len(flagged) > max_flags,
        "observations": observations,
        "thresholds": {"alpha_motion_p95": .16, "depth_motion_p95": .22},
        "note": "Motion-compensated differences are heuristics; true motion, bad optical flow, "
                "and illumination changes can trigger false positives. Inspect real frames.",
    }
    path = output / "qa_report.json"
    manifest(path, report)
    picked = flagged[:max_flags] if flagged else observations[::max(1, len(observations)//8)][:8]
    if picked:
        tile_w, tile_h, bar = 240, 136, 35
        columns = 4
        rows = (len(picked) + columns - 1) // columns
        sheet = Image.new("RGB", (tile_w * columns, (tile_h + bar) * rows),
                          (28, 24, 22))
        draw = ImageDraw.Draw(sheet)
        for j, obs in enumerate(picked):
            frame = Image.fromarray(rgb_image(frames[obs["frame"]])).convert("RGB")
            frame.thumbnail((tile_w, tile_h), Image.Resampling.LANCZOS)
            xx, yy = j % columns * tile_w, j // columns * (tile_h + bar)
            sheet.paste(frame, (xx + (tile_w - frame.width)//2,
                                yy + (tile_h - frame.height)//2))
            msg = f'#{obs["frame"]}  ' + ", ".join(obs["flags"])
            draw.text((xx + 7, yy + tile_h + 5), msg[:39], fill=(238, 190, 155))
        sheet.save(output / "qa_contact_sheet.jpg", quality=87)
    return report
