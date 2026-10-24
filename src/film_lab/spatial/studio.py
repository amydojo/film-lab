"""Local-only, zero-cloud shot editor and exact single-frame composite preview.

The server binds to loopback and serves only enumerated media; it cannot browse the filesystem.
Its preview uses the same Pillow text rasterizer and alpha/depth blend as the final renderer.
Temporal tracking/smoothing is intentionally full-render only.
"""
from __future__ import annotations

from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from io import BytesIO
import json
from pathlib import Path
import threading
from urllib.parse import urlparse

import numpy as np
from PIL import Image

from .composite import blend, occluder
from .graphics import pose_at, rasterize
from .io import frame_files, grayscale_map, map_file, rgb_image
from .pipeline import render
from .project import Project, write_project


def preview(project_file: Path, payload: dict, frame: int, view: str = "composite") -> bytes:
    project = Project.from_dict(payload)
    sources = frame_files(project.directory(project_file, "frames_dir"))
    if not sources or not 0 <= frame < len(sources):
        raise ValueError("Frame index outside source sequence")
    source = rgb_image(sources[frame])
    h, w = source.shape[:2]
    alpha_path = map_file(project.directory(project_file, "alpha_dir"), frame)
    depth_path = map_file(project.directory(project_file, "depth_dir"), frame)
    alpha = grayscale_map(alpha_path, h, w) if alpha_path else None
    depth = grayscale_map(depth_path, h, w) if depth_path else None
    if view == "source":
        output = source
    elif view == "alpha":
        if alpha is None:
            raise ValueError("No matte for this frame. Run inference or import alpha maps.")
        output = np.uint8(np.rint(np.clip(alpha, 0, 1) * 255))
    elif view == "depth":
        if depth is None:
            raise ValueError("No depth for this frame. Run inference or import depth maps.")
        output = np.uint8(np.rint(np.clip(depth, 0, 1) * 255))
    elif view in {"composite", "occlusion"}:
        output = source.copy()
        mask = np.zeros((h, w), np.float32)
        for layer in project.layers:
            pose = pose_at(layer.keyframes, frame)
            glyph = rasterize(layer, pose, h, w)
            # Preview only: allow editorial positioning before maps are available.
            # The full renderer still fails closed until required maps exist.
            missing = alpha is None or (layer.occlusion == "depth" and depth is None)
            cover = (np.zeros((h, w), np.float32)
                     if layer.occlusion == "none" or missing else occluder(
                         alpha, depth, layer.depth, layer.occlusion,
                         project.depth_feather))
            mask = np.maximum(mask, cover * glyph[..., 3])
            output = blend(output, glyph, cover)
        if view == "occlusion":
            output = np.uint8(np.rint(mask * 255))
    else:
        raise ValueError(f"Unknown preview mode: {view}")
    buffer = BytesIO()
    Image.fromarray(output).save(buffer, format="PNG")
    return buffer.getvalue()


def create_handler(project_file: Path, lock: threading.Lock):
    class StudioHandler(BaseHTTPRequestHandler):
        server_version = "FilmLabStudio/0.2"

        def _ok_host(self) -> bool:
            expected = {f"127.0.0.1:{self.server.server_port}",
                        f"localhost:{self.server.server_port}"}
            return self.headers.get("Host") in expected

        def _headers(self, status: int, mime: str, length: int):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' blob: data:; "
                             "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
                             "connect-src 'self'; object-src 'none'; base-uri 'none'")
            self.end_headers()

        def _send(self, status: int, data: bytes, mime: str):
            self._headers(status, mime, len(data))
            self.wfile.write(data)

        def _json(self, status: int, data: dict):
            self._send(status, json.dumps(data, allow_nan=False).encode(), "application/json")

        def _state(self) -> dict:
            contents = project_file.read_bytes()
            data = json.loads(contents)
            project = Project.from_dict(data)
            frame_paths = frame_files(project.directory(project_file, "frames_dir"))
            if not frame_paths:
                raise ValueError("No frames found for this shot")
            first = rgb_image(frame_paths[0])
            return {"project": data, "revision": sha256(contents).hexdigest(),
                    "frames": len(frame_paths), "width": int(first.shape[1]),
                    "height": int(first.shape[0]),
                    "alpha_frames": sum(map_file(project.directory(project_file, "alpha_dir"), i)
                                        is not None for i in range(len(frame_paths))),
                    "depth_frames": sum(map_file(project.directory(project_file, "depth_dir"), i)
                                        is not None for i in range(len(frame_paths)))}

        def do_GET(self):
            if not self._ok_host():
                return self._json(403, {"error": "Invalid host"})
            try:
                path = urlparse(self.path).path
                if path in ("/", "/studio"):
                    html = files("film_lab.spatial").joinpath("static/studio.html").read_bytes()
                    return self._send(200, html, "text/html; charset=utf-8")
                if path == "/api/state":
                    return self._json(200, self._state())
                if path == "/api/report":
                    report = Project.load(project_file).directory(project_file, "output_dir") / "render_report.json"
                    if not report.exists():
                        return self._json(404, {"error": "No render report yet"})
                    return self._send(200, report.read_bytes(), "application/json")
                return self._json(404, {"error": "Unknown endpoint"})
            except (OSError, ValueError, TypeError, KeyError) as e:
                return self._json(400, {"error": str(e)})

        def do_POST(self):
            if not self._ok_host():
                return self._json(403, {"error": "Invalid host"})
            origin = self.headers.get("Origin")
            if origin not in {f"http://127.0.0.1:{self.server.server_port}",
                              f"http://localhost:{self.server.server_port}"}:
                return self._json(403, {"error": "Invalid origin"})
            if (self.headers.get("X-Film-Lab-Studio") != "1" or
                    self.headers.get("Content-Type", "").split(";")[0] != "application/json"):
                return self._json(403, {"error": "Studio request header required"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 1 <= size <= 1024 * 1024:
                    return self._json(413, {"error": "Invalid request size"})
                content = json.loads(self.rfile.read(size))
                path = urlparse(self.path).path
                if path == "/api/preview":
                    img = preview(project_file, content["project"],
                                  int(content["frame"]), content.get("view", "composite"))
                    return self._send(200, img, "image/png")
                if path == "/api/save":
                    # Avoid clobbering another editor's changes; only one write at a time.
                    with lock:
                        original = project_file.read_bytes()
                        if content.get("revision") != sha256(original).hexdigest():
                            return self._json(409, {"error": "Project changed on disk. Reload before saving."})
                        write_project(project_file, content["project"])
                        return self._json(200, {"saved": True,
                                               "revision": sha256(project_file.read_bytes()).hexdigest()})
                if path == "/api/render":
                    if not lock.acquire(blocking=False):
                        return self._json(409, {"error": "A save/render operation is underway"})
                    try:
                        report = render(project_file, save_debug=True, video=True)
                    finally:
                        lock.release()
                    return self._json(200, report)
                return self._json(404, {"error": "Unknown endpoint"})
            except (OSError, ValueError, TypeError, KeyError, RuntimeError) as e:
                return self._json(400, {"error": str(e)})
    return StudioHandler


def serve(project: Path, port: int = 8765) -> None:
    """Start a local browser editor. Not exposed on LAN or internet."""
    project = project.resolve()
    Project.load(project)
    with ThreadingHTTPServer(("127.0.0.1", port),
                             create_handler(project, threading.Lock())) as server:
        print(f"Film Lab Studio: http://127.0.0.1:{server.server_port}/")
        print(f"Project: {project}")
        print("Loopback only. Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
