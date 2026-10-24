"""Original synthetic footage for an end-to-end, weight-free smoke test."""
from __future__ import annotations
from pathlib import Path
import cv2
import numpy as np

from .io import save_mask, save_rgb, manifest
from .project import write_project


def generate(workdir: Path, frames: int = 36, fps: int = 24) -> Path:
    """Illustrative mannequin + moving arm; no actual person or medical imagery."""
    if frames < 2:
        raise ValueError("Need at least 2 frames")
    workdir.mkdir(parents=True, exist_ok=True)
    for sub in ("frames", "alpha", "depth"):
        target = workdir / sub
        target.mkdir(exist_ok=True)
        if any(target.iterdir()):
            raise FileExistsError(f"Demo will not overwrite existing files in {target}")
    h, w = 360, 640
    yy, xx = np.mgrid[0:h, 0:w]
    rng = np.random.default_rng(2026)
    noise = rng.normal(0, 1.0, (h, w, 1)).astype(np.float32)
    for i in range(frames):
        t = i / (frames - 1)
        cx = round(w * (.55 + .075 * np.sin(t * np.pi * 2)))
        # Retained film grain across frames so the demo tests camera-free temporal stability.
        rgb = np.empty((h, w, 3), np.float32)
        rgb[..., 0] = 24 + yy * .15
        rgb[..., 1] = 21 + yy * .092
        rgb[..., 2] = 19 + yy * .064
        rgb += noise
        image = np.uint8(np.clip(rgb, 0, 255))
        a = np.zeros((h, w), np.uint8)
        # Neck, upper body, shoulder, face and a foreground arm sweeping across letters.
        cv2.ellipse(a, (cx, 325), (125, 138), 0, 180, 360, 255, -1)
        cv2.ellipse(a, (cx, 273), (105, 105), 0, 0, 360, 255, -1)
        cv2.rectangle(a, (cx-27, 128), (cx+28, 212), 255, -1)
        cv2.ellipse(a, (cx, 104), (61, 76), 0, 0, 360, 255, -1)
        hand_end = (round(w * (.30 + .32*t)), round(h * (.49 + .16*np.sin(np.pi*t))))
        cv2.line(a, (cx+92, 263), hand_end, 255, 32, cv2.LINE_AA)
        matte = cv2.GaussianBlur(a.astype(np.float32) / 255, (3, 3), .75)
        # An isolated near layer emphasizes the arm passing in front of mid-depth text.
        depth = np.full((h, w), .08, np.float32)
        depth[a > 10] = .76
        arm = np.zeros((h, w), np.uint8)
        cv2.line(arm, (cx+92, 263), hand_end, 255, 32, cv2.LINE_AA)
        depth[arm > 10] = .94
        # Preserve motion-blur transparency and make the subject legible.
        warm = np.array([151, 98, 76], np.float32)
        image = np.uint8(np.clip(image.astype(np.float32) * (1 - matte[..., None])
                                      + warm * matte[..., None], 0, 255))
        name = f"{i:06d}"
        save_rgb(workdir / "frames" / f"{name}.png", image)
        save_mask(workdir / "alpha" / f"{name}.png", matte)
        np.save(workdir / "depth" / f"{name}.npy", depth)
    project_path = workdir / "project.json"
    write_project(project_path, {
        "fps": fps,
        "alpha_temporal": .12, "depth_temporal": .25,
        "layers": [{
            "text": "SPACE\nBETWEEN",
            "font_size": 77, "color": "#F1D3BA",
            "depth": .43, "occlusion": "depth", "tracking": "none",
            "keyframes": [{"frame": 0, "x": .49, "y": .50, "scale": 1.0},
                          {"frame": frames - 1, "x": .52, "y": .47,
                           "scale": 1.12, "rotation": 0}]
        }]
    })
    manifest(workdir / "alpha" / "provenance.json", {
        "provider": "synthetic-demo", "note": "MatAnyone 2 was NOT run"})
    manifest(workdir / "depth" / "provenance.json", {
        "provider": "synthetic-demo", "note": "Depth Anything 3 was NOT run"})
    return project_path
