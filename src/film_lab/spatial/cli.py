"""Film Lab CLI. Model inference is an opt-in, independently provisioned stage."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from .demo import generate
from .io import extract, frame_files
from .models import depth_da3, import_sequence, matanyone2
from .pipeline import render
from .qa import audit
from .studio import serve
from .project import write_project


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="film-lab", description="Spatial typography lab")
    sub = p.add_subparsers(dest="command", required=True)

    demo = sub.add_parser("demo", help="Generate synthetic footage and composite it without AI weights")
    demo.add_argument("--workdir", type=Path, default=Path("workspaces/demo"))
    demo.add_argument("--frames", type=int, default=36)
    demo.add_argument("--no-video", action="store_true")

    init = sub.add_parser("init", help="Write a new editable project.json for existing frames")
    init.add_argument("--workdir", type=Path, required=True)
    init.add_argument("--fps", type=float, default=24)
    init.add_argument("--text", default="FORM\nFOLLOWS\nMOTION")
    init.add_argument("--font", default=None)
    init.add_argument("--font-size", type=int, default=100)

    ext = sub.add_parser("extract", help="Decode an input video to sequential PNG frames")
    ext.add_argument("video", type=Path)
    ext.add_argument("--workdir", type=Path, required=True)

    imp = sub.add_parser("import-maps", help="Import one normalized map per frame")
    imp.add_argument("--workdir", type=Path, required=True)
    imp.add_argument("--source", type=Path, required=True)
    imp.add_argument("--kind", choices=("alpha", "depth"), required=True)
    imp.add_argument("--near-black", action="store_true",
                     help="Invert depth polarity when source indicates close=0; not for alpha")

    depth = sub.add_parser("depth-da3", help="Depth Anything 3 (model not included)")
    depth.add_argument("--workdir", type=Path, required=True)
    depth.add_argument("--model", default="depth-anything/DA3-BASE")
    depth.add_argument("--device", default="cuda")
    depth.add_argument("--window", type=int, default=12)

    matte = sub.add_parser("matte-ma2", help="MatAnyone 2 (NON-COMMERCIAL upstream license)")
    matte.add_argument("--workdir", type=Path, required=True)
    matte.add_argument("--upstream", type=Path, required=True,
                       help="Path to clone of official MatAnyone2 repo")
    matte.add_argument("--first-mask", type=Path, required=True)
    matte.add_argument("--max-size", type=int, default=-1)

    rend = sub.add_parser("render", help="Offline composition from prepared frames, alpha, depth")
    rend.add_argument("--project", type=Path, required=True)
    rend.add_argument("--debug", action="store_true")
    rend.add_argument("--no-video", action="store_true")
    studio = sub.add_parser("studio", help="Local visual typography editor, no cloud upload")
    studio.add_argument("--project", type=Path, required=True)
    studio.add_argument("--port", type=int, default=8765)

    qc = sub.add_parser("qa", help="Motion-compensated matte and depth continuity audit")
    qc.add_argument("--project", type=Path, required=True)
    qc.add_argument("--every", type=int, default=1)
    return p


def main() -> None:
    args = parser().parse_args()
    if args.command == "demo":
        path = generate(args.workdir, frames=args.frames)
        print(json.dumps(render(path, save_debug=True, video=not args.no_video), indent=2))
    elif args.command == "init":
        payload = {
            "fps": args.fps,
            "layers": [{
                "text": args.text, "font": args.font, "font_size": args.font_size,
                "color": "#E6BFA4", "depth": .43, "occlusion": "depth",
                "tracking": "background",
                "keyframes": [{"frame": 0, "x": .5, "y": .5},
                              {"frame": max(0, len(frame_files(args.workdir / "frames"))-1),
                               "x": .5, "y": .5}],
            }]
        }
        # Single-image projects need just one keyframe; avoid duplicate frame 0.
        if payload["layers"][0]["keyframes"][1]["frame"] == 0:
            payload["layers"][0]["keyframes"].pop()
        path = args.workdir / "project.json"
        write_project(path, payload)
        print(path.resolve())
    elif args.command == "extract":
        count, fps = extract(args.video.resolve(), args.workdir / "frames")
        project = args.workdir / "project.json"
        if not project.exists():
            payload = {
                "fps": fps, "source_video": str(args.video.resolve()),
                "layers": [{
                    "text": "SPACE\nIS MATERIAL", "font_size": 110, "color": "#E6BFA4",
                    "occlusion": "depth", "depth": .43,
                    "keyframes": [{"frame": 0, "x": .5, "y": .5},
                                  {"frame": count-1, "x": .5, "y": .5}]
                }]
            }
            if count == 1:
                payload["layers"][0]["keyframes"].pop()
            write_project(project, payload)
        print(json.dumps({"frames": count, "fps": fps, "project": str(project)}))
    elif args.command == "import-maps":
        if args.kind == "alpha" and args.near_black:
            raise ValueError("--near-black is only meaningful for depth maps")
        frames = frame_files(args.workdir / "frames")
        count = import_sequence(args.source, args.workdir / args.kind, frames,
                                args.kind, args.near_black)
        print(f"Imported {count} {args.kind} maps")
    elif args.command == "depth-da3":
        frames = frame_files(args.workdir / "frames")
        count = depth_da3(frames, args.workdir / "depth",
                          model_id=args.model, device=args.device, window=args.window)
        print(f"Estimated normalized depth for {count} frames")
    elif args.command == "matte-ma2":
        print("LICENSE WARNING: MatAnyone 2 is non-commercial without permission.")
        count = matanyone2(args.workdir.resolve() / "frames", args.first_mask,
                           args.workdir / "alpha", args.upstream, max_size=args.max_size)
        print(f"Generated alpha for {count} frames")
    elif args.command == "studio":
        serve(args.project, port=args.port)
    elif args.command == "qa":
        report = audit(args.project, every=args.every)
        print(json.dumps({k: v for k, v in report.items() if k != "observations"}, indent=2))
    elif args.command == "render":
        print(json.dumps(render(args.project, save_debug=args.debug,
                                video=not args.no_video), indent=2))


if __name__ == "__main__":
    main()
