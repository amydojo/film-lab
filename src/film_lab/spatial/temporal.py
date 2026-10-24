"""Motion-compensated matte smoothing and cut-safe camera tracking."""
from __future__ import annotations
import cv2
import numpy as np


def luma(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)


def scene_cut(prev: np.ndarray, curr: np.ndarray, threshold: float) -> bool:
    # Downsample to reduce sensitivity to codec grain and individual pixels.
    a = cv2.resize(prev, (96, 54), interpolation=cv2.INTER_AREA)
    b = cv2.resize(curr, (96, 54), interpolation=cv2.INTER_AREA)
    return float(np.mean(np.abs(a.astype(np.float32) - b.astype(np.float32))) / 255) > threshold


def warp_prior(prior: np.ndarray, previous: np.ndarray, current: np.ndarray) -> np.ndarray:
    """Backward optical flow: current pixel -> previous pixel for cv2.remap."""
    scale = .5 if max(previous.shape) > 1200 else 1.0
    if scale < 1:
        sh, sw = previous.shape
        small_prev = cv2.resize(previous, (round(sw * scale), round(sh * scale)))
        small_curr = cv2.resize(current, (round(sw * scale), round(sh * scale)))
    else:
        small_prev, small_curr = previous, current
    back = cv2.calcOpticalFlowFarneback(small_curr, small_prev, None, .5, 3, 21, 3, 5, 1.2, 0)
    if scale < 1:
        back = cv2.resize(back, (previous.shape[1], previous.shape[0])) / scale
    yy, xx = np.indices(previous.shape, dtype=np.float32)
    return cv2.remap(prior.astype(np.float32), xx + back[..., 0], yy + back[..., 1],
                     interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def temporal_blend(current: np.ndarray, previous: np.ndarray | None,
                   prior_gray: np.ndarray | None, gray: np.ndarray,
                   strength: float, preserve_motion: bool = False) -> np.ndarray:
    if previous is None or prior_gray is None or strength <= 0:
        return current
    aligned = warp_prior(previous, prior_gray, gray)
    blended = current * (1 - strength) + aligned * strength
    if preserve_motion:
        # Never smear a fast hand over a prior position.
        mask = np.abs(current - aligned) > .22
        blended[mask] = current[mask]
    return np.clip(blended, 0, 1)


class BackgroundTracker:
    """Track stationary scene features to stabilize typography in a moving camera shot."""

    def __init__(self):
        self.previous_gray: np.ndarray | None = None
        self.translation = np.zeros(2, np.float32)

    def update(self, gray: np.ndarray, subject_alpha: np.ndarray | None,
               cut: bool = False) -> tuple[float, float]:
        if cut:
            self.translation[:] = 0
            self.previous_gray = gray.copy()
            return (0.0, 0.0)
        if self.previous_gray is None:
            self.previous_gray = gray.copy()
            return (0.0, 0.0)
        valid = np.ones_like(self.previous_gray, np.uint8) * 255
        if subject_alpha is not None:
            valid[subject_alpha > .3] = 0
        points = cv2.goodFeaturesToTrack(self.previous_gray, maxCorners=180,
                                        qualityLevel=.015, minDistance=12, mask=valid)
        if points is not None and len(points) >= 8:
            nxt, status, _ = cv2.calcOpticalFlowPyrLK(self.previous_gray, gray, points, None)
            if nxt is not None and status is not None:
                good = status.ravel() == 1
                if good.sum() >= 6:
                    matrix, inliers = cv2.estimateAffinePartial2D(
                        points[good], nxt[good], method=cv2.RANSAC, ransacReprojThreshold=2.5)
                    if matrix is not None and (inliers is None or inliers.sum() >= 5):
                        dx, dy = matrix[0, 2], matrix[1, 2]
                        if np.hypot(dx, dy) < min(gray.shape) * .12:
                            # Low-pass camera movement to remove micro-jitter.
                            self.translation += .8 * np.array([dx, dy], np.float32)
        self.previous_gray = gray.copy()
        return float(self.translation[0]), float(self.translation[1])
