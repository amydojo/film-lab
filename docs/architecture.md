# Experiment A — Architecture / engineering record

## The intent

An actual compositing tool—not a single prompt-to-video effect. Every step has a named, inspectable artifact and can be repeated without an internet connection.

    source video
        |
        v
    RGB frame extraction --------> frames/*.png -- immutable inputs
        |                                   |
        +-- MatAnyone2 / licensed matte --> alpha/*.png
        +-- Depth Anything 3 ------------> depth/*.npy
                                            |
                         project.json + keyframed editorial typography
                                            |
                              background motion tracking
                                            |
                            alpha + depth optical-flow warp
                                            |
                           depth-gated foreground occlusion
                                            |
                     straight-alpha typography over original RGB
                                            |
                              PNG sequence + QC + optional MP4

## Boundaries

- io.py: frame extraction, format contracts, image/map validation, encoding
- project.py: versionable author-facing shot metadata and parameter constraints
- models.py: independently provisioned DA3 and MatAnyone2 adapters / sequence import
- graphics.py: deterministic text layout and keyframe easing
- temporal.py: cut detection, backward-flow remapping, stabilization, background RANSAC tracks
- composite.py: non-destructive visibility math and straight-alpha blend
- pipeline.py: bounded-memory per-frame orchestration / render report
- demo.py: synthetic moving-arm footage to exercise the compositor
- cli.py: operator interface; no inferred data magically substituted

## Occlusion math

Let M be the soft subject matte, D be normalized nearness (near=1),
Z be the editorial text depth, and f the transition band.

    O = M * smoothstep(Z - f, Z + f, D)    [depth mode]
    O = M                                    [person mode]
    T_visible = T_alpha * (1 - O)
    RGB_out = RGB_source*(1-T_visible) + RGB_text*T_visible

The source image is the actual base frame. No bad foreground RGB cutout is pasted back over it.
Soft mattes preserve antialiased hair and motion blur; hard thresholds would destroy these details.

## Tracking and temporality

- Background features are filtered by person alpha, tracked with pyramidal Lucas–Kanade, and fitted with RANSAC.
- A conservative translation offset avoids dragging text with the moving person.
- Backward dense optical flow maps the previous depth/matte into the current frame.
- Optical-flow-compensated blending suppresses unstable single-frame estimates.
- Alpha changes above 0.22 bypass the smoothing to prevent ghosts on rapidly moving hands.
- A downsampled interframe luminance difference triggers a cut reset.

Known limitations:
- Background tracking is 2D translation only, not true 6DoF camera estimation.
- DA3 windows are independent; normalization is global but not 3D registration across window boundaries.
- Sudden cuts, textureless backgrounds, motion blur, hair and intersecting limbs can break tracking.
- Depth/mattes must already align spatially; renderer never guesses frame correspondence.
- Strong highlight/color spill and foreground-edge defringing need a dedicated future stage.
- CPU renders are possible, but GPU model stages can be slow or infeasible on laptops.
- MP4 H.264 is 8-bit 4:2:0; use the original PNG sequence as the editable source of truth.
- For full production, add scene segmentation, color management, per-shot calibration and 16-bit/EXR support.

## Upstream dependencies and legal isolation

- DA3-BASE and DA3-SMALL checkpoints are Apache 2.0 in current upstream model cards.
- Other DA3 checkpoints may be CC BY-NC 4.0; never infer all variants share one license.
- MatAnyone 2 S-Lab License 1.0 permits non-commercial use only by default.
- We do not vendor/check in weights, upstream source code, or source footage.
- Internal commercial users should use a licensed alternative alpha provider via import-maps.

## Error behavior and provenance

Invalid FPS, missing files, dimension mismatch, bad value range, and insufficient inference count fail closed. Imported and generated maps receive sidecar provenance manifests. Outputs are generated into an isolated workdir (gitignored) to avoid committing private footage or clinical materials.

We intentionally don't delete prior renders. New edits may overwrite same-numbered output frames; for experiment comparison, use separate shot workdirs or snapshot the results before re-rendering.

## Infrastructure progression

V0.1 works as a local batch renderer. When demand justifies a hosted service, keep this project schema and stage contracts; use a job queue, object storage with checksums and short-lived URLs, dedicated GPU inference workers, CPU compositing workers, and tracked model/license provenance. No user footage should be uploaded to third-party inference providers implicitly.
