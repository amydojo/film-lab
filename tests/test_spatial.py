"""Functional, deterministic tests that do not download AI model weights."""
import json

import cv2
import numpy as np
import pytest

from film_lab.spatial.composite import blend, occluder
from film_lab.spatial.demo import generate
from film_lab.spatial.graphics import pose_at, rasterize
from film_lab.spatial.pipeline import render
from film_lab.spatial.project import Keyframe, Layer, Project
from film_lab.spatial.temporal import scene_cut, temporal_blend


def test_depth_gate_and_unmodified_pixels():
    alpha = np.array([[1.0, .5], [1.0, 0.0]], np.float32)
    depth = np.array([[.9, .9], [.1, .9]], np.float32)
    cover = occluder(alpha, depth, text_depth=.5, mode="depth", feather=.01)
    np.testing.assert_allclose(cover, [[1, .5], [0, 0]])
    original = np.full((2, 2, 3), 60, np.uint8)
    rgba = np.ones((2, 2, 4), np.float32)
    result = blend(original, rgba, cover)
    np.testing.assert_array_equal(result[0, 0], original[0, 0])
    np.testing.assert_array_equal(result[1, 0], [255, 255, 255])
    np.testing.assert_array_equal(result[1, 1], [255, 255, 255])


def test_antialiased_alpha_not_squared():
    layer = Layer.from_dict({"text": "I", "font_size": 94, "opacity": .45,
                             "keyframes": [{"frame": 0, "x": .5, "y": .5}]})
    glyph = rasterize(layer, layer.keyframes[0], 160, 220)
    assert glyph.shape == (160, 220, 4)
    assert 0.40 < glyph[..., 3].max() < 0.48


def test_keyframes_and_validation(tmp_path):
    keys = (Keyframe(0, .1, .5), Keyframe(10, .9, .5))
    assert pose_at(keys, 5).x == pytest.approx(.5)
    doc = tmp_path / "project.json"
    doc.write_text(json.dumps({"fps": 24, "frames_dir": "../escape",
                                "layers": [{"text": "X",
                                            "keyframes": [{"frame": 0, "x": .5, "y": .5}]}]}))
    with pytest.raises(ValueError):
        Project.load(doc)


def test_temporal_respects_unoccluded_motion():
    prior = np.zeros((24, 24), np.float32)
    curr = np.zeros_like(prior)
    curr[9:15, 9:15] = 1
    gray = np.zeros((24, 24), np.uint8)
    value = temporal_blend(curr, prior, gray, gray, .8, preserve_motion=True)
    assert np.all(value[10:14, 10:14] == 1)


def test_scene_cut():
    black = np.zeros((40, 40), np.uint8)
    white = np.full_like(black, 255)
    assert scene_cut(black, white, .24)
    assert not scene_cut(black, black, .24)


def test_synthetic_end_to_end(tmp_path):
    shot = generate(tmp_path / "shot", frames=4)
    result = render(shot, save_debug=True, video=False)
    assert result["frames"] == 4
    assert result["resolution"] == [640, 360]
    assert (tmp_path / "shot/renders/composite/000003.png").exists()
    assert (tmp_path / "shot/renders/debug/000003_occluder.png").exists()
    assert not result["encoded"]
    assert result["max_occluded_text_leakage"] < .03


def test_missing_model_assets_fail_closed(tmp_path):
    shot = generate(tmp_path / "shot", frames=2)
    (tmp_path / "shot/depth/000001.npy").unlink()
    with pytest.raises(ValueError, match="Missing depth"):
        render(shot, video=False)
