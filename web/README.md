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
accept uploads. The MediaPipe JS/WASM runtime and model are downloaded from external
CDNs/Google model hosting when needed; MediaPipe may report usage/performance metrics,
but video and image pixels are processed locally. Imported files are used via local object URLs and drawn in Canvas; downloads
are initiated locally. Remote Google Fonts may be requested, but contain no image/video bytes.
As always, do not screen-share confidential patient data or create public previews of it.

Mobile Safari / Chrome: Web video decoding and File API behavior depend on browser support.
For clinical footage, use local editor + source imagery only under your organization's
permissions and security requirements. This web companion isn't a clinical media vault.
