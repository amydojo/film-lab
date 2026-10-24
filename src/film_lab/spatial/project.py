"""Validated, versioned per-shot editing contract and atomic project writes."""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import tempfile


def _finite(value: float) -> bool:
    return isinstance(value, (float, int)) and math.isfinite(value)


@dataclass(frozen=True)
class Keyframe:
    frame: int
    x: float
    y: float
    scale: float = 1.0
    rotation: float = 0.0

    @classmethod
    def from_dict(cls, data: dict) -> "Keyframe":
        k = cls(**data)
        if not isinstance(k.frame, int) or k.frame < 0:
            raise ValueError("Keyframe frame must be a non-negative integer")
        if not all(_finite(n) for n in (k.x, k.y, k.scale, k.rotation)):
            raise ValueError("Keyframe parameters must be finite numbers")
        if not 0 <= k.x <= 1 or not 0 <= k.y <= 1 or k.scale <= 0:
            raise ValueError("Invalid keyframe: x/y in [0,1], scale>0")
        return k


@dataclass(frozen=True)
class Layer:
    text: str
    font: str | None = None
    font_size: int = 110
    color: str = "#E6BFA4"
    opacity: float = 1.0
    depth: float = 0.45
    occlusion: str = "depth"
    tracking: str = "background"
    keyframes: tuple[Keyframe, ...] = ()

    @classmethod
    def from_dict(cls, data: dict) -> "Layer":
        layer = cls(**{**data, "keyframes": tuple(
            Keyframe.from_dict(k) for k in data["keyframes"])})
        if not isinstance(layer.text, str) or not layer.text or not layer.keyframes:
            raise ValueError("Every text layer needs text and at least one keyframe")
        if not isinstance(layer.font_size, int) or not 1 <= layer.font_size <= 1000:
            raise ValueError("font_size must be an integer in [1,1000]")
        if not all(_finite(n) and 0 <= n <= 1 for n in (layer.depth, layer.opacity)):
            raise ValueError("Depth and opacity must be finite values in [0,1]")
        if layer.occlusion not in {"depth", "person", "none"}:
            raise ValueError("occlusion must be depth, person, or none")
        if layer.tracking not in {"background", "none"}:
            raise ValueError("tracking must be background or none")
        if not isinstance(layer.color, str) or not (
            len(layer.color) == 7 and layer.color.startswith("#")
            and all(c in "0123456789abcdefABCDEF" for c in layer.color[1:])):
            raise ValueError("color must be #RRGGBB")
        frames = [k.frame for k in layer.keyframes]
        if frames != sorted(set(frames)):
            raise ValueError("Keyframes must be sorted and unique")
        return layer


@dataclass(frozen=True)
class Project:
    fps: float
    frames_dir: str = "frames"
    alpha_dir: str = "alpha"
    depth_dir: str = "depth"
    output_dir: str = "renders"
    source_video: str | None = None
    alpha_temporal: float = 0.16
    depth_temporal: float = 0.40
    scene_cut_threshold: float = 0.24
    depth_feather: float = 0.045
    layers: tuple[Layer, ...] = field(default_factory=tuple)

    @classmethod
    def from_dict(cls, data: dict) -> "Project":
        if not isinstance(data, dict):
            raise ValueError("Project must be a JSON object")
        values = {**data, "layers": tuple(Layer.from_dict(k)
                                          for k in data.get("layers", []))}
        project = cls(**values)
        if not _finite(project.fps) or project.fps <= 0:
            raise ValueError("fps must be positive and finite")
        if not project.layers:
            raise ValueError("Project must contain at least one text layer")
        for name in ("alpha_temporal", "depth_temporal",
                     "scene_cut_threshold", "depth_feather"):
            value = getattr(project, name)
            if not _finite(value) or not 0 <= value <= 1:
                raise ValueError(f"{name} must be finite and in [0,1]")
        for name in ("frames_dir", "alpha_dir", "depth_dir", "output_dir"):
            value = getattr(project, name)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{name} must be a safe relative path")
            path = Path(value)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"{name} must be a safe relative path")
        return project

    @classmethod
    def load(cls, path: str | Path) -> "Project":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def directory(self, project_path: str | Path, attribute: str) -> Path:
        return Path(project_path).resolve().parent / getattr(self, attribute)


def write_project(path: str | Path, payload: dict) -> None:
    """Reject invalid edits *before* writing and atomically replace an existing JSON."""
    Project.from_dict(payload)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", prefix=".film-lab-",
                                         dir=target.parent, encoding="utf-8",
                                         delete=False) as f:
            temporary = Path(f.name)
            json.dump(payload, f, indent=2, allow_nan=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
