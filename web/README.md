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
- Optionally import one aligned alpha and one depth image to test frame-level occlusion.
- Inspect matte/depth; export selected composite as PNG and project config as JSON.
- Controls persist locally on device, but source footage is intentionally **not** persisted or uploaded.

## What it cannot do

This is a browser **previsualization** studio, not Depth Anything 3 or MatAnyone 2 inference.
Single imported alpha/depth maps are static and won't follow movement in video.
No MP4 render, no multi-frame mask tracking, no depth geometry inference, no cloud storage.
The Python engine under src/ continues to own high-quality final renders, temporal stabilization,
and actual model inference. Editor font families are approximate Web fonts; export JSON uses
\`font: null\` because Python font files must be configured separately on the rendering machine.

## Privacy

Use of the file picker does not transmit footage to Film Lab servers. No API endpoints
accept uploads. Imported files are used via local object URLs and drawn in Canvas; downloads
are initiated locally. Remote Google Fonts may be requested, but contain no image/video bytes.
As always, do not screen-share confidential patient data or create public previews of it.

Mobile Safari / Chrome: Web video decoding and File API behavior depend on browser support.
For clinical footage, use local editor + source imagery only under your organization's
permissions and security requirements. This web companion isn't a clinical media vault.
