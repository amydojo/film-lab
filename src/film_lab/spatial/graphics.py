"""Anti-aliased text rasterization and deterministic keyframe interpolation."""
from __future__ import annotations
from functools import lru_cache

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFont

from .project import Keyframe, Layer


def pose_at(keys: tuple[Keyframe, ...], frame: int) -> Keyframe:
    if frame <= keys[0].frame:
        return keys[0]
    if frame >= keys[-1].frame:
        return keys[-1]
    for a, b in zip(keys[:-1], keys[1:]):
        if a.frame <= frame <= b.frame:
            t = (frame - a.frame) / (b.frame - a.frame)
            t = t * t * (3.0 - 2.0 * t)
            return Keyframe(frame, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t,
                            a.scale + (b.scale - a.scale) * t,
                            a.rotation + (b.rotation - a.rotation) * t)
    raise AssertionError("Unreachable keyframe interval")


@lru_cache(maxsize=64)
def _font(path: str | None, size: int) -> ImageFont.FreeTypeFont:
    if path:
        return ImageFont.truetype(path, size)
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def rasterize(layer: Layer, pose: Keyframe, height: int, width: int,
              offset: tuple[float, float] = (0, 0)) -> np.ndarray:
    """Produce straight-alpha RGBA in 0..1, no entire-frame supersampling."""
    size = max(1, round(layer.font_size * pose.scale))
    font = _font(layer.font, size)
    lines = layer.text.split("\n")
    padding = max(8, round(size * 0.35))
    spacing = max(1, round(size * .12))
    boxes = [font.getbbox(line or " ") for line in lines]
    text_width = max(b[2] - b[0] for b in boxes)
    ascender, descender = font.getmetrics()
    line_height = ascender + descender
    tile = Image.new("RGBA", (max(1, text_width + padding * 2),
                             max(1, line_height * len(lines) + spacing * (len(lines)-1) + padding * 2)),
                     (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    rgb = ImageColor.getrgb(layer.color)
    for i, line in enumerate(lines):
        box = boxes[i]
        left = (tile.width - (box[2] - box[0])) / 2 - box[0]
        top = padding + i * (line_height + spacing) - box[1]
        draw.text((round(left), round(top)), line, font=font,
                  fill=(*rgb, round(255 * layer.opacity)))
    if abs(pose.rotation) > 1e-4:
        tile = tile.rotate(pose.rotation, resample=Image.Resampling.BICUBIC, expand=True)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x = round(pose.x * width + offset[0] - tile.width / 2)
    y = round(pose.y * height + offset[1] - tile.height / 2)
    # Raw RGBA paste preserves the glyph's alpha; using tile as mask squares it.
    canvas.paste(tile, (x, y))
    return np.asarray(canvas, dtype=np.float32) / 255.0
