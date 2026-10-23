"""Depth-aware, straight-alpha compositing without modifying the source pixels."""
from __future__ import annotations
import numpy as np


def smoothstep(low: float, high: float, values: np.ndarray) -> np.ndarray:
    if low == high:
        return (values >= high).astype(np.float32)
    t = np.clip((values - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def occluder(alpha: np.ndarray | None, depth: np.ndarray | None,
             text_depth: float, mode: str, feather: float) -> np.ndarray:
    """Opacity of subject in front of text. Matte gates depth to avoid background occlusion."""
    if mode == "none":
        if alpha is not None:
            return np.zeros_like(alpha, np.float32)
        if depth is not None:
            return np.zeros_like(depth, np.float32)
        raise ValueError("No canvas size provided for unoccluded text")
    if alpha is None:
        raise ValueError(f"'{mode}' occlusion requires a person alpha matte")
    if mode == "person":
        return np.clip(alpha, 0, 1)
    if mode != "depth":
        raise ValueError(f"Unknown occlusion mode {mode}")
    if depth is None:
        raise ValueError("Depth occlusion needs normalized depth maps; run depth-da3 or import depth")
    proximity = smoothstep(text_depth - feather, text_depth + feather, depth)
    return np.clip(alpha * proximity, 0, 1)


def blend(base_rgb: np.ndarray, text_rgba: np.ndarray, occlusion: np.ndarray) -> np.ndarray:
    """Unmodified source image stays visible where typography is occluded."""
    base = base_rgb.astype(np.float32) / 255.0
    text_alpha = np.clip(text_rgba[..., 3] * (1 - occlusion), 0, 1)[..., None]
    out = base * (1 - text_alpha) + text_rgba[..., :3] * text_alpha
    return np.uint8(np.clip(np.rint(out * 255), 0, 255))


def composite_layers(source: np.ndarray,
                     layers: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
    result = source
    for glyphs, subject_occlusion in layers:
        result = blend(result, glyphs, subject_occlusion)
    return result
