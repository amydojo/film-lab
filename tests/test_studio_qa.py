"""Studio/editor and QC regression tests. No model weights or production footage needed."""
from __future__ import annotations

from io import BytesIO
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
import pytest
from PIL import Image

from film_lab.spatial.demo import generate
from film_lab.spatial.pipeline import render
from film_lab.spatial.project import Project, write_project
from film_lab.spatial.qa import audit
from film_lab.spatial.studio import create_handler, preview


def test_project_write_is_atomic_on_validation_failure(tmp_path):
    project_path = generate(tmp_path / "shot", frames=3)
    original = project_path.read_bytes()
    data = json.loads(original)
    data["layers"][0]["keyframes"][0]["x"] = float("nan")
    with pytest.raises(ValueError):
        write_project(project_path, data)
    assert project_path.read_bytes() == original
    assert Project.load(project_path)


def test_preview_equals_first_render_frame(tmp_path):
    path = generate(tmp_path / "shot", frames=3)
    doc = json.loads(path.read_text())
    actual = np.asarray(Image.open(BytesIO(preview(path, doc, 0))))
    report = render(path, video=False)
    expected = np.asarray(Image.open(Path(report["frames_path"]) / "000000.png"))
    np.testing.assert_array_equal(actual, expected)
    assert preview(path, doc, 1, "depth")[:8] == b"\x89PNG\r\n\x1a\n"


def test_qc_detects_unstable_alpha_and_writes_contact_sheet(tmp_path):
    path = generate(tmp_path / "shot", frames=5)
    alpha = path.parent / "alpha/000002.png"
    Image.fromarray(np.zeros((360, 640), np.uint8)).save(alpha)
    result = audit(path)
    assert result["frames_sampled"] == 5
    assert result["flagged_sampled_frames"] >= 1
    assert (path.parent / "renders/qa_report.json").exists()
    assert (path.parent / "renders/qa_contact_sheet.jpg").exists()


def test_local_editor_state_preview_and_revision_conflict(tmp_path):
    path = generate(tmp_path / "shot", frames=3)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(path, threading.Lock()))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    root = "http://127.0.0.1:" + str(httpd.server_port)

    def post(endpoint, doc, origin=None):
        return Request(root + endpoint, data=json.dumps(doc).encode(),
                       method="POST", headers={
                           "Content-Type": "application/json",
                           "X-Film-Lab-Studio": "1",
                           "Origin": origin or root})

    try:
        state = json.load(urlopen(root + "/api/state"))
        assert state["frames"] == 3
        assert state["alpha_frames"] == 3
        assert state["depth_frames"] == 3
        with urlopen(root + "/") as res:
            assert b"FILM" in res.read()
        with urlopen(post("/api/preview", {"project": state["project"], "frame": 1})) as res:
            assert res.headers["Content-Type"] == "image/png"
            assert res.read(8) == b"\x89PNG\r\n\x1a\n"
        with pytest.raises(HTTPError) as exc:
            urlopen(post("/api/save", {"project": state["project"],
                                       "revision": "outdated"}))
        assert exc.value.code == 409
        with pytest.raises(HTTPError) as exc:
            urlopen(post("/api/save", {"project": state["project"],
                                      "revision": state["revision"]},
                         origin="https://example.org"))
        assert exc.value.code == 403
        with urlopen(post("/api/save", {"project": state["project"],
                                       "revision": state["revision"]})) as res:
            assert json.load(res)["saved"]
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


def test_unmasked_editor_draft_does_not_bypass_strict_render(tmp_path):
    path = generate(tmp_path / "shot", frames=2)
    (path.parent / "alpha/000000.png").unlink()
    doc = json.loads(path.read_text())
    assert preview(path, doc, 0).startswith(b"\\x89PNG")
    with pytest.raises(ValueError, match="Missing alpha"):
        render(path, video=False)
