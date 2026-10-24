# FILM LAB
### Experiment A / Spatial Typography Engine

A shot-based, Python compositor for **text that passes behind a person, arm, or shoulder**, without removing or re-generating the actual footage. Depth Anything 3 supplies spatial guidance; MatAnyone 2 or other licensed tools supply a soft person alpha matte. The render engine is lightweight and runs offline.

**Status:** V0.1 working engineering foundation, synthetic integration demo + automated tests. No pretrained model weights, commercial rights, GPU infrastructure, or verified real-footage QC are bundled. This is not a claim of finished VFX on your source footage.

## Fastest first render (no GPU, no AI install)

Requirements: Python 3.10+, pip; optional FFmpeg for MP4 export.

    python -m venv .venv
    source .venv/bin/activate
    pip install -e ".[test]"
    film-lab demo --workdir workspaces/demo
    # outputs workspaces/demo/renders/spatial_type.mp4 (if FFmpeg installed)
    # and workspaces/demo/renders/composite/*.png regardless

The demo generates its own test clip, depth maps, alpha mattes and editable project. It is **synthetic**, not a DA3/MatAnyone2 benchmark. Inspect the diagnostic occluder and typography frames in workspaces/demo/renders/debug/.

## Studio 02 — direct shot editing

After preparing your footage, alpha and depth maps, run:

    film-lab studio --project workspaces/shot01/project.json

Open http://127.0.0.1:8765. The studio runs on localhost only and doesn't upload footage.
Scrub any frame, inspect source/matte/depth/occlusion/composite, drag the selected
typography anchor to place a keyframe, adjust editorial depth, font, size, color,
position, animation timing, and layer order. Save the actual project JSON or click
**Render** for the existing offline pipeline.

The live preview uses the *same Python glyph rasterizer and compositor* as a full
render for that frame. It does not pretend to preview temporal smoothing or background
feature tracking: export the full render for exact motion validation.

Automated temporal continuity check:

    film-lab qa --project workspaces/shot01/project.json --every 2

This writes `renders/qa_report.json` and `renders/qa_contact_sheet.jpg`,
flagging motion-compensated discontinuities and missing maps. Those are heuristic
signals, **not** a substitute for frame-by-frame manual QC. To validate live footage,
look for real hand/finger crossings and depth edge shimmer at 100% resolution.

## Real footage workflow

    film-lab extract input.mov --workdir workspaces/shot01
    # Creates numbered source frames and an editable project.json.
    # Provide a first-frame person mask for MatAnyone2, or import licensed alpha maps.
    film-lab import-maps --workdir workspaces/shot01 --kind alpha --source /path/to/matte-pngs
    film-lab import-maps --workdir workspaces/shot01 --kind depth --source /path/to/normalized-depth
    film-lab render --project workspaces/shot01/project.json --debug

Raw input should be a **constant frame-rate** video. The extractor writes every decoded frame; VFR source clips should first be conformed using a dedicated video editor or FFmpeg. Font paths may be absolute or relative to the process's working directory.

### Automated model stages (optional; separate ML environment)

1. Follow docs/model-setup.md to install the upstream tools, review weights and licenses.
2. Depth Anything 3 inference (default uses Apache-licensed DA3-BASE checkpoint):

       film-lab depth-da3 --workdir workspaces/shot01 --model depth-anything/DA3-BASE --device cuda

3. MatAnyone 2 inference (NON-COMMERCIAL upstream license; not for paid productions without a license):

       film-lab matte-ma2 --workdir workspaces/shot01 --upstream /path/to/MatAnyone2 --first-mask first-frame-person.png

4. Edit workspaces/shot01/project.json and run:

       film-lab render --project workspaces/shot01/project.json --debug

For commercial work, replace MatAnyone2 with an appropriately licensed alpha generator and use import-maps. The Film Lab compositor itself is independent of either model.

## The edit contract

The shot directory structure:

    workspaces/shot01/
      project.json
      frames/000000.png        Original RGB frames (unaltered)
      alpha/000000.png         Subject opacity, black=transparent, white=opaque
      depth/000000.npy         Nearness in [0, 1], where 1=nearest
      alpha/provenance.json    Source inference or imported-art provenance
      depth/provenance.json
      renders/
        composite/000000.png  High-quality source-preserving RGB compositing
        debug/*_occluder.png   Frame-by-frame QA views (if --debug)
        debug/*_typography.png
        render_report.json
        spatial_type.mp4       Optional H.264 video + original audio

The project JSON controls text, font, size, color, opacity, normalized position keyframes (x and y in [0,1]), scale, rotation in degrees, text depth, occlusion mode, and tracking.

Three occlusion modes:
- depth: subject alpha multiplied by depth test against text z-plane, with smooth transitions around boundary. Requires both maps.
- person: full subject alpha blocks typography. Safest for text intentionally behind the person; does not need depth.
- none: typography always in front.

Background tracking uses feature tracks excluding the person and RANSAC for estimated translation. Smooth motion keyframes remain artist-directed; the tracker applies only a background offset. Rapid subject motion is handled separately by optical-flow-warped temporal smoothing with hard-edge motion rejection. Shot cuts reset temporal memory.

Important: normalized depth is **not metric distance**, and a 2D depth plane isn't an actual 3D object track. Use debug output for every hand crossing and fast movement. Compositing never edits or invents body anatomy: it places partially occluded text over the original RGB frames.

## Quality gate

    python -m compileall -q src
    pytest -q
    film-lab demo --workdir workspaces/smoke --frames 8 --no-video

GitHub Actions runs unit tests, a synthetic end-to-end compositing test, and uploads the diagnostic render as an artifact. Release requires manual review on actual footage at export resolution; see docs/architecture.md and docs/quality.md.

## Decisions / roadmap

- V0.1 ships an **offline CPU-capable render core**, not a heavyweight model server.
- Model inference is decoupled from rendering; precomputed assets can be inspected, versioned externally, cached, and swapped without rerendering the upstream model.
- Experiment B: better per-limb geometry and shot-aware object ordering, multi-plane 3D text, Blender geometry export.
- Experiment C: compositing GUI, rotoscope corrections, multi-person mattes, per-shot QC dashboard, confidence-aware depth gating and frame-range orchestration.

No clinical before/after imagery or models are committed. Do not publish or show synthesized transitions as authentic surgical outcomes.
