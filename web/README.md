# Film Lab Pocket Studio — web companion

This directory produces a phone-sized interactive demo on Vercel without an AI service or uploading footage to a server.

## Run / deploy

    cd web
    npm run build
    # serve web/dist with a static HTTP server (for example: npx serve dist)

Vercel project: Git-connected to \`amydojo/film-lab\`, root directory \`web\`,
Framework \`Other\`, build command \`npm run build\`, output directory \`dist\`.

## Features

- Canvas2D cinematic synthetic demo, animated arm crossing over editorial typography.
- Drag-to-keyframe type position, timeline scrub/play/pause, depth/opacity/size/color/font toggles.
- Import a still or video **on the phone**: handled using browser File API and blob URLs.
- On-device MediaPipe selfie segmentation automatically makes a per-frame human matte for phone video or image uploads; inference runs periodically while video plays or is scrubbed.
- Optional imported alpha and depth images override live estimation only if automatic masking is toggled off; manual depth uses a single map and will not follow moving video.
- When a video has a person matte but no true depth, the depth slider becomes a clearly labeled 2.5D editorial front/behind blend. It is NOT geometric depth estimation.
- Record a short silent MP4/WebM directly from the canvas via MediaRecorder when supported by the mobile browser. This is a browser real-time capture, not frame-accurate video rendering.
- Inspect matte/depth; export selected composite as PNG and project config as JSON.
- Controls persist locally on device, but source footage is intentionally **not** persisted or uploaded.

## What it cannot do

This is a browser **previsualization** studio, not Depth Anything 3 or MatAnyone 2 inference.
Single imported alpha/depth maps are static and won't follow movement in video.
No offline-quality MP4 rendering or audio muxing, no geometric depth inference, no cloud storage. The web app performs per-frame on-device portrait segmentation but does not replace temporal matting or manual VFX cleanup.
The Python engine under src/ continues to own high-quality final renders, temporal stabilization,
and actual model inference. Editor font families are approximate Web fonts; export JSON uses
\`font: null\` because Python font files must be configured separately on the rendering machine.

## Privacy

Use of the file picker does not transmit footage to Film Lab servers. No API endpoints
accept uploads. The pinned MediaPipe Tasks Vision 0.10.21 JS/WASM runtime and model are downloaded from external
CDNs/Google model hosting when needed; MediaPipe may report usage/performance metrics,
but video and image pixels are processed locally. Imported files are used via local object URLs and drawn in Canvas; downloads
are initiated locally. Remote Google Fonts may be requested, but contain no image/video bytes.
As always, do not screen-share confidential patient data or create public previews of it.

Mobile Safari / Chrome: Web video decoding and File API behavior depend on browser support.
For clinical footage, use local editor + source imagery only under your organization's
permissions and security requirements. This web companion isn't a clinical media vault.


## V0.5 — Keyframe editing and deterministic fallback export

Mobile Studio adds clickable timeline keyframes, prev/next/delete and numeric X/Y,
scale and rotation controls, with a preserved editable project JSON export. Set
IN and OUT while scrubbing and change the source fitting mode between crop and
letterbox. The browser remains a local, on-device previsualization tool.

FRAME PACK (.ZIP) exports a bounded 6-second section as an already-composited
sequence at 12 FPS, accompanied by manifest.json and assembly instructions.
Each frame is sought and encoded separately so it does not depend on browser
captureStream or MediaRecorder support on iOS. Clips are silent.
On limited-memory phones the app caps accumulated image data at 80 MB. Film Lab's
MP4 recorder is still available where supported and remains browser-dependent.
PNG frame, project JSON and ZIP are all downloaded locally.

The exported frame pack is not alpha maps or a replacement for full-resolution
VFX exports; it is a practical way to view/reassemble a short edit reliably on
a desktop. MediaPipe subject masks can lag/produce artifacts, and no true
geometric depth is inferred on mobile.


## V0.6 — Real relative depth for phone footage

The browser now supports a real model-produced monocular depth map. Tap
GENERATE DEPTH after importing a photo/video. On first use, the browser
downloads a pretrained Depth Anything V2 Small ONNX checkpoint and the
Transformers.js runtime; expect significant download and memory demands.
WebGPU is attempted first, with WASM CPU fallback.

The model is Depth Anything V2 Small, not Depth Anything 3. The full
Depth Anything 3 multi-frame inference adapter remains in the Python
pipeline for GPU-equipped production. Neither model produces certified
metric distances for a single phone image.

With an Auto Mask alpha matte available:
- The depth map is normalized relative nearness (white closer) and tested
  pixel-by-pixel against the selected text depth plane.
- GENERATE DEPTH estimates one source frame on request.
- TRACK DEPTH periodically samples moving video frames (device dependent).
  It is not guaranteed continuous full-framerate inference.
- Predictions are softly blended with prior estimates when temporally close
  and preserve large motion discontinuities.
- When a video prediction is >0.45 seconds old, tracked depth is not used
  to occlude moving limbs: the renderer falls back to the whole person
  matte for safety. In non-tracked mode the legacy editorial 2.5D fallback
  remains visible and explicitly labeled.
- Importing a depth map still works and is treated as an author-supplied
  static map; it will not follow movement.

For privacy, source frames are processed locally in-browser. The model
and JavaScript/WASM assets are downloaded from Hugging Face/CDN/Google
as needed. No image frames are deliberately uploaded to model services.
Check your organization's controls before loading patient footage.

Frame Pack ZIP export performs per-frame depth inference for model-assisted shots and limits those packs to 2 seconds at 8 FPS. This can still be slow on phones; failed depth inference aborts the export rather than substituting fake depth.
Use a local GPU computer and Python DA3 for reliable final rendering.

Potential limitations: model download failure, Safari memory limits,
relative-depth polarity errors on challenging footage, inter-frame scale
drift, edge halos, motion blur and inaccurate overlapping limbs. This
release adds real image depth analysis, not cinematic-grade matte repair.


## V0.7 — Live mobile editing dock

The phone interface now behaves like an editor instead of a long webpage:
- A live 9:16 composition is always visible in a fixed monitor at the top.
- TUNE / TYPE / DEPTH / MOVE / OUTPUT tabs share the lower control dock.
- Sliders act on the same in-memory state as before; no duplicated control
  nodes or mirrored UI; moving the sliders previews instantly above.
- The active lower panel scrolls internally; the monitor never scrolls away.
- FOCUS enlarges the monitor for detailed inspection; tapping again restores it.
- The preview compacts while using a text/number keyboard, and adapts to
  mobile visual viewport resize (iOS Safari and Chrome Android).
- Desktop uses the existing multi-column full inspector and keeps all groups visible.
- Tab keyboard navigation supports left/right/Home/End.

No inference, rendering, or patient privacy behavior changed. The previous
spatial pipeline and exported file formats are unchanged.


## V0.8 — Motion Composer (touch release = one key)

This release corrects the old accidental keyframe flood: moving the pointer
only renders a transient preview, and releasing a sufficiently long gesture
commits exactly one position key at the current frame. Taps do not move text,
and canceled touches do not save edits. Previous over-dense motion paths can
be simplified intentionally using REFINE DENSE PATH (max 12 keys, original
positions preserved at important turning points). Every motion mutation is
undoable/redoable up to 50 steps; pressing Reset discards the undo stack.

MOVE offers four named **2D** trajectory presets:
- HOLD: stays fixed
- DRIFT: subtle horizontal movement with scale variation
- REVEAL: settles upward, then holds
- ORBIT 2D: elliptical graphic motion, not scene-tracked 3D motion

Global speed curves: GLIDE (cubic Bézier), SMOOTH, LINEAR, HOLD.
The same interpolation is used for playback and baked PNG/JPEG exports.
The editor exports the selected speed curve as optional editor metadata
in the project JSON; legacy Python rendering may need to interpret this
metadata separately and should not be assumed to match its own interpolation.

Default ten-second demo keyframes are time-scaled when a shorter video is
imported only if the editor still contains the untouched starter path.
Already edited motion is preserved unchanged.

This is motion composition, not camera tracking or a true 3D orbit.
