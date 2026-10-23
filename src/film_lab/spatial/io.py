"""Input contracts, frame decoding, and audited output encoding."""
from __future__ import annotations
import json
from pathlib import Path
import shutil
import subprocess

import cv2
import numpy as np
from PIL import Image


def files_in(directory: Path, extensions: tuple[str, ...]) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir()
                  if p.is_file() and p.suffix.lower() in extensions)


def frame_files(directory: Path) -> list[Path]:
    return files_in(directory, (".png", ".jpg", ".jpeg"))


def rgb_image(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)


def grayscale_map(path: Path, height: int, width: int) -> np.ndarray:
    if path.suffix.lower() == ".npy":
        arr = np.load(path, allow_pickle=False)
    else:
        # Preserve 16-bit precision when available; don't silently process RGB images.
        arr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if arr is None or arr.ndim != 2:
            raise ValueError(f"Expected single-channel map: {path}")
        if np.issubdtype(arr.dtype, np.integer):
            arr = arr.astype(np.float32) / np.iinfo(arr.dtype).max
    arr = np.asarray(arr, dtype=np.float32)
    if arr.shape != (height, width) or not np.isfinite(arr).all():
        raise ValueError(f"Invalid map {path}: expected {(height, width)}, got {arr.shape}")
    if arr.min() < -1e-5 or arr.max() > 1 + 1e-5:
        raise ValueError(f"Map outside [0,1] {path}: received {arr.min()}..{arr.max()}")
    return np.clip(arr, 0, 1)


def map_file(directory: Path, index: int) -> Path | None:
    for suffix in (".npy", ".png", ".tif", ".tiff"):
        path = directory / f"{index:06d}{suffix}"
        if path.is_file():
            return path
    return None


def save_mask(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), np.uint8(np.clip(np.rint(arr * 255), 0, 255)))


def save_rgb(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr.astype(np.uint8), "RGB").save(path)


def extract(video: Path, dest: Path) -> tuple[int, float]:
    if not video.is_file():
        raise FileNotFoundError(video)
    dest.mkdir(parents=True, exist_ok=True)
    if frame_files(dest):
        raise FileExistsError(f"Refusing to overwrite frames already in {dest}")
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot decode video: {video}")
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    if fps <= 0 or not np.isfinite(fps):
        cap.release()
        raise RuntimeError("Unable to determine source FPS; transcode to constant FPS first")
    count = 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            save_rgb(dest / f"{count:06d}.png", cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            count += 1
    finally:
        cap.release()
    if not count:
        raise RuntimeError(f"No frames decoded from {video}")
    return count, fps


def encode(frames_dir: Path, output: Path, fps: float, source_video: Path | None) -> bool:
    """Frames remain the canonical output. Encode H.264 and copy source audio if present."""
    if not shutil.which("ffmpeg"):
        return False
    argv = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", f"{fps:.8f}", "-i", str(frames_dir / "%06d.png")]
    if source_video and source_video.is_file():
        argv += ["-i", str(source_video), "-map", "0:v:0", "-map", "1:a?"]
    argv += ["-c:v", "libx264", "-preset", "medium", "-crf", "17",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    if source_video and source_video.is_file():
        argv += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    argv += [str(output)]
    subprocess.run(argv, check=True)
    return True


def manifest(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
