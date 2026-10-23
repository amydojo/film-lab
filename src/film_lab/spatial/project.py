"""Serializable, reproducible per-shot project contract.

Coordinates and depth are normalized: x/y in [0,1] from image top left;
depth is closeness, 0=far and 1=near. Text depth is artist-directed, not metric.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path


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
        if k.frame < 0 or not 0 <= k.x <= 1 or not 0 <= k.y <= 1 or k.scale <= 0:
            raise ValueError("Invalid keyframe: frame>=0, x/y in [0,1], scale>0")
        return k


@dataclass(frozen=True)
class Layer:
    text: str
    font: str | None = None
    font_size: int = 110
    color: str = "#E6BFA4"
    opacity: float = 1.0
    depth: float = 0.45
    occlusion: str = "depth"  # depth, person, or none
    tracking: str = "background"  # background or none
    keyframes: tuple[Keyframe, ...] = ()

    @classmethod
    def from_dict(cls, data: dict) -> "Layer":
        kwargs = {**data, "keyframes": tuple(Keyframe.from_dict(k) for k in data["keyframes"])}
        layer = cls(**kwargs)
        if not layer.text or not layer.keyframes:
            raise ValueError("Every text layer needs text and at least one keyframe")
        if not 0 <= layer.depth <= 1 or not 0 <= layer.opacity <= 1 or layer.font_size < 1:
            raise ValueError("Depth/opacity must be in [0,1] and font_size > 0")
        if layer.occlusion not in {"depth", "person", "none"}:
            raise ValueError("occlusion must be depth, person, or none")
        if layer.tracking not in {"background", "none"}:
            raise ValueError("tracking must be background or none")
        if sorted(k.frame for k in layer.keyframes) != [k.frame for k in layer.keyframes]:
            raise ValueError("Keyframes must be sorted by frame")
        if len({k.frame for k in layer.keyframes}) != len(layer.keyframes):
            raise ValueError("Duplicate keyframe numbers are not permitted")
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
    def load(cls, path: str | Path) -> "Project":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        data["layers"] = tuple(Layer.from_dict(k) for k in data.get("layers", []))
        project = cls(**data)
        if project.fps <= 0 or not project.layers:
            raise ValueError("fps must be positive and project must contain layers")
        for name in ("alpha_temporal", "depth_temporal", "scene_cut_threshold", "depth_feather"):
            value = getattr(project, name)
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be in [0,1]")
        for name in ("frames_dir", "alpha_dir", "depth_dir", "output_dir"):
            p = Path(getattr(project, name))
            if p.is_absolute() or ".." in p.parts:
                raise ValueError(f"{name} must be a safe relative workdir path")
        return project

    def directory(self, project_path: str | Path, attribute: str) -> Path:
        return Path(project_path).resolve().parent / getattr(self, attribute)


def write_project(path: str | Path, payload: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    Project.load(target)
