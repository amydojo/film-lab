# Studio 02 / Shot editing and continuity QA

Run \`film-lab studio --project workspaces/shot01/project.json\`, then open http://127.0.0.1:8765.

### The browser workspace

- **Left:** layers and asset-coverage indicators. Add/select layers without rewriting JSON.
- **Center:** Python-generated exact single-frame preview with source / matte / depth / composite / occlusion views, scrubbable film timeline and draggable anchor.
- **Right:** color, size, font path, opacity, depth plane, occlusion mode, tracking, keyframe parameters.
- **Top:** optimistic-concurrency save and full offline render.

The preview runs the actual Python glyph rasterizer and occlusion formula, including antialiased typography; *it doesn't simulate temporal blend or camera tracking*. When a required map has not been generated yet, a clearly labeled **draft preview** shows typography without that missing occlusion; the production render still rejects incomplete maps. The rendered sequence remains the source of truth for final motion.

Dragging an anchor writes a position keyframe on the active frame. A new keyframe interpolates smoothly between neighboring keys; add a keyframe without moving to lock position. The renderer still applies background-motion tracking when requested.

### Security and provenance

Local loopback interface only (127.0.0.1), with no third-party network uploads. Only enumerated endpoints can read images, and the save endpoint uses a project revision hash to reject conflicting writes. POST endpoints check same-origin requests and require a custom JSON header. Source images remain unchanged. Do not expose port 8765 publicly using reverse proxies or tunneled links.

### QC

\`film-lab qa --project workspaces/shot01/project.json --every 2\`

Generates a report and visual contact sheet. The audit uses backward optical flow to align previous matte/depth maps before calculating temporal residuals, skipping detected hard cuts. A high percentile residual triggers a **review flag**, not automatic correction. Manual full-resolution inspection remains mandatory for hand crossings, hair edges, and camera movement.

Missing maps are always reported. Quality scores are heuristic and should not be advertised as guarantees.

### Known limitations / next engineering tranche

- Single-frame preview doesn't calculate live 6DoF camera tracking.
- Type is a screen-space raster with artist-directed depth, not Blender 3D mesh extrusion.
- The editor is deliberately zero-cloud and single-shot. No remote GPU service, team permissions, proxy generation or external file picker.
- No real 9:16 talking-head source was provided in this repo; the synthetic sample cannot validate clinical-grade masking.
- Next: portable studio binary, 16-bit/EXR workflow, locked-shape layer handles, brush-based matte correction and calibration by contiguous scene.
