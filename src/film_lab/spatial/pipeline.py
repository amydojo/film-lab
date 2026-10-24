"""Streaming compositor. Rendering never makes network calls or loads model weights."""
from __future__ import annotations
from pathlib import Path

import cv2
import numpy as np

from .composite import blend, occluder
from .graphics import pose_at, rasterize
from .io import encode, frame_files, grayscale_map, manifest, map_file, rgb_image, save_mask, save_rgb
from .project import Project
from .temporal import BackgroundTracker, luma, scene_cut, temporal_blend


def render(project_path: str | Path, save_debug: bool = False,
           video: bool = True) -> dict:
    project_path = Path(project_path).resolve()
    project = Project.load(project_path)
    frames = frame_files(project.directory(project_path, "frames_dir"))
    if not frames:
        raise FileNotFoundError("No source frames. Run extract or demo first.")
    root = project_path.parent
    output = project.directory(project_path, "output_dir")
    output.mkdir(parents=True, exist_ok=True)
    dest = output / "composite"
    dest.mkdir(parents=True, exist_ok=True)
    debug = output / "debug"
    if save_debug:
        debug.mkdir(parents=True, exist_ok=True)
    alpha_dir = project.directory(project_path, "alpha_dir")
    depth_dir = project.directory(project_path, "depth_dir")
    needs_alpha = any(layer.occlusion != "none" for layer in project.layers)
    needs_depth = any(layer.occlusion == "depth" for layer in project.layers)
    if needs_alpha and len(list(alpha_dir.glob("*.png"))) != len(frames):
        raise ValueError("Missing alpha sequence: expected one 000000.png per input frame")
    if needs_depth and sum(map_file(depth_dir, i) is not None for i in range(len(frames))) != len(frames):
        raise ValueError("Missing depth sequence: expected one normalized depth map per frame")
    tracker = BackgroundTracker()
    prior_gray = None
    prior_alpha = None
    prior_depth = None
    cut_count = 0
    max_leakage = 0.0
    prior_shape = None
    for i, f in enumerate(frames):
        source = rgb_image(f)
        h, w = source.shape[:2]
        if prior_shape and (h, w) != prior_shape:
            raise ValueError("Mixed source frame dimensions are not supported")
        prior_shape = (h, w)
        gray = luma(source)
        cut = prior_gray is not None and scene_cut(prior_gray, gray, project.scene_cut_threshold)
        if cut:
            cut_count += 1
            prior_alpha, prior_depth = None, None
        a_path = map_file(alpha_dir, i)
        d_path = map_file(depth_dir, i)
        alpha = grayscale_map(a_path, h, w) if a_path else None
        depth = grayscale_map(d_path, h, w) if d_path else None
        motion = tracker.update(gray, alpha, cut=cut)
        if alpha is not None:
            alpha = temporal_blend(alpha, prior_alpha, prior_gray if not cut else None,
                                   gray, project.alpha_temporal, preserve_motion=True)
        if depth is not None:
            depth = temporal_blend(depth, prior_depth, prior_gray if not cut else None,
                                   gray, project.depth_temporal)
        result = source.copy()
        for index, layer in enumerate(project.layers):
            pose = pose_at(layer.keyframes, i)
            offset = motion if layer.tracking == "background" else (0, 0)
            glyph = rasterize(layer, pose, h, w, offset)
            if layer.occlusion == "none":
                covering = np.zeros((h, w), np.float32)
            else:
                covering = occluder(alpha, depth, layer.depth,
                                    layer.occlusion, project.depth_feather)
            if save_debug and index == 0:
                save_mask(debug / f"{i:06d}_occluder.png", covering)
                save_mask(debug / f"{i:06d}_typography.png", glyph[..., 3])
            # No foreground extraction is pasted back: the RGB original remains intact.
            visible = glyph[..., 3] * (1 - covering)
            leak = float(np.max(visible[covering > .98], initial=0))
            max_leakage = max(max_leakage, leak)
            result = blend(result, glyph, covering)
        save_rgb(dest / f"{i:06d}.png", result)
        prior_gray, prior_alpha, prior_depth = gray, alpha, depth

    path = output / "spatial_type.mp4"
    encoded = False
    if video:
        source = project.source_video
        source_path = ((root / source).resolve() if source and not Path(source).is_absolute()
                       else Path(source) if source else None)
        encoded = encode(dest, path, project.fps, source_path)
    report = {"frames": len(frames), "resolution": list(prior_shape[::-1]),
              "fps": project.fps, "scene_cuts": cut_count,
              "max_occluded_text_leakage": max_leakage,
              "encoded": encoded, "video_path": str(path) if encoded else None,
              "frames_path": str(dest),
              "validation": "Synthetic and unit tests only; inspect actual footage at full resolution"}
    manifest(output / "render_report.json", report)
    return report
