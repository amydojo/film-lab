# Model setup, practical constraints, and licensing

This is an optional adapter guide. Running the example with provided alpha/depth does not require torch, Hugging Face downloads, CUDA, or a GPU.

## Depth Anything 3

Upstream: https://github.com/ByteDance-Seed/Depth-Anything-3

Follow its current installation instructions in a **separate virtual environment**. It provides:

    from depth_anything_3.api import DepthAnything3
    model = DepthAnything3.from_pretrained("depth-anything/DA3-BASE")
    result = model.inference(list_of_frame_paths)
    depth = result.depth

Film Lab's adapter batches consecutive frames for multi-view consistency, aligns output to the source resolution, uses shared distance percentiles for temporal calibration, and writes normalized nearness maps as float32 .npy.

    film-lab depth-da3 --workdir workspaces/shot01 --model depth-anything/DA3-BASE --device cuda --window 12

Model choice must be reviewed individually: upstream DA3-BASE / DA3-SMALL are Apache 2.0; larger variants may have CC BY-NC restrictions. Hugging Face hosting and checkpoints may require download access and substantial disk/GPU memory. The adapter does NOT install the upstream model or its weights.

## MatAnyone 2

Upstream: https://github.com/pq-yang/MatAnyone2
License: https://github.com/pq-yang/MatAnyone2/blob/main/LICENSE.txt

The official repo exposes inference_matanyone2.py with flags -i (video or frame folder), -m (first-frame binary person mask), -o (output), and --save_image. It writes one PNG alpha frame under <output>/<input-folder>/pha/ for each input frame. Film Lab uses that published CLI and reindexes images to 000000.png onward.

    git clone https://github.com/pq-yang/MatAnyone2 /path/to/MatAnyone2
    # install upstream as directed in its README and download/check its weights
    film-lab matte-ma2 --workdir workspaces/shot01 --upstream /path/to/MatAnyone2 --first-mask first-mask.png

Important: **S-Lab License 1.0 allows non-commercial redistribution and use only by default.** Obtain explicit commercial rights before use on client projects, advertisements, clinic production, or paid work. This repo's inclusion of an adapter does not grant those rights.

## Commercial-safe alternative

Obtain alpha PNGs from your licensed editing tool or matting pipeline.
Use lossless 8-/16-bit gray alpha and keep one frame per original image.

    film-lab import-maps --workdir workspaces/shot01 --kind alpha --source /licensed/alpha
    film-lab import-maps --workdir workspaces/shot01 --kind depth --source /normalized/near-white-depth

For depth images encoded as **near=black / far=white**, add --near-black for import; otherwise the contract is near=white. For normalized depth float32 .npy, keep 0..1 and manually verify polarity.

Use workspaces/demo to verify the renderer independent of AI model behavior before investing in GPU setup.
