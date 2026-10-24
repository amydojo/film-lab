# Full-resolution compositing quality checklist

Synthetic tests exercise code paths but do not prove real-world edge quality. Review actual output at 100% on mobile and desktop, first at native clip resolution and then at final social export resolution.

## Shot acceptance targets

1. Alpha and depth file count match the source frame count *exactly*, including frame 0 and last frame.
2. Masks have no translation, stretch, or upside-down orientation relative to source RGB.
3. Hair, necklines, fingers, shoulders, and moving hands have no high-contrast halos.
4. Text is completely hidden where person opacity and depth test indicate a fully foreground subject.
5. Skin coloration is unchanged wherever typography does not appear (source-original preservation).
6. No smearing/trailing silhouette during fast motion; tune alpha_temporal down when needed.
7. No flicker where text disappears behind shoulders and returns; tune depth_temporal and depth_feather.
8. No moving glyph wobble from falsely tracked person features; try tracking = none.
9. Cut boundaries reset optical flow and tracking (do not blend two camera shots).
10. Source audio remains in sync and H.264 does not introduce unreadable letter edges.
11. Titles are within the 9:16/4:5 platform safe areas; avoid UI overlays on Reels.
12. Client fonts and source footage are properly licensed; no unauthorized pretrained mattes.

## Troubleshooting

- Text appears on top of an entire foreground person: decrease layer.depth, use occlusion = person, or inspect depth polarity.
- Text disappears behind background: inspect alpha; the depth gate is only applied where alpha > 0.
- Jagged/fuzzy edge: ensure soft grayscale alpha input, not hard binary masks. Avoid resaving through H.264 before final composite.
- Ghost at a moving hand: reduce alpha_temporal or use better temporally coherent input mattes.
- Text judders with the camera: tracking = background, or leave none for editorial fixed-screen typography.
- Bad cut transition: manually split shot into individual workdirs.
- Black PNG frames: check video decode and alpha files; nothing should be inferred from the absence of assets.
- Render missing MP4: install FFmpeg; the complete PNG image sequence is still the master.

## Deliverables to archive with a finished shot

- Original clip or a privacy-safe input reference
- project.json
- model/provider names and license evidence
- exact input matte/depth versions and generation configuration
- render_report.json plus visual QA passes
- signed-off frame sequence and export metadata

No numerical leakage report by itself substitutes for visual inspection.
