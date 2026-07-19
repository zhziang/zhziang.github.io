#!/usr/bin/env python3
"""Convert 2D scalar snapshots in an HDF5 file to a browser-ready ASCII MP4."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import h5py
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont


DEFAULT_RAMP = " .:-=+*#%@"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a time series of 2D HDF5 snapshots as an ASCII MP4."
    )
    parser.add_argument("input", type=Path, help="Input .h5 or .hdf5 file")
    parser.add_argument(
        "--dataset",
        help="HDF5 dataset path. By default, the largest dataset with at least 3 dimensions is used.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/turbulence-ascii.mp4"),
        help="Output MP4 path (default: assets/turbulence-ascii.mp4)",
    )
    parser.add_argument("--time-axis", type=int, default=0, help="Time dimension (default: 0)")
    parser.add_argument(
        "--component-axis",
        type=int,
        help="Optional component dimension to index before rendering",
    )
    parser.add_argument("--component", type=int, default=0, help="Component index (default: 0)")
    parser.add_argument("--start", type=int, default=0, help="First snapshot index")
    parser.add_argument("--stop", type=int, help="Exclusive final snapshot index")
    parser.add_argument("--stride", type=int, default=1, help="Snapshot stride (default: 1)")
    parser.add_argument("--fps", type=float, default=20.0, help="Output frames per second")
    parser.add_argument(
        "--fade-in",
        type=float,
        default=0.0,
        metavar="SECONDS",
        help="Fade in by scaling initial vorticity magnitudes over this duration",
    )
    parser.add_argument(
        "--fade-out",
        type=float,
        default=0.0,
        metavar="SECONDS",
        help="Fade the final frames to black over this duration",
    )
    parser.add_argument("--width", type=int, default=1280, help="Video width in pixels")
    parser.add_argument("--height", type=int, default=720, help="Video height in pixels")
    parser.add_argument("--columns", type=int, default=132, help="ASCII columns per frame")
    parser.add_argument("--low-percentile", type=float, default=1.0)
    parser.add_argument("--high-percentile", type=float, default=99.0)
    parser.add_argument(
        "--gamma",
        type=float,
        default=0.7,
        help="Magnitude display gamma; values below 1 brighten weaker structures (default: 0.7)",
    )
    parser.add_argument("--ramp", default=DEFAULT_RAMP, help="Characters from low to high values")
    parser.add_argument("--invert", action="store_true", help="Reverse the character ramp")
    parser.add_argument(
        "--color-mode",
        choices=("signed", "cyan"),
        default="signed",
        help="Color by vorticity sign or use one cyan color (default: signed)",
    )
    parser.add_argument("--crf", type=int, default=24, help="H.264 CRF; lower is higher quality")
    parser.add_argument("--font", type=Path, help="Optional monospaced TrueType font")
    parser.add_argument("--list", action="store_true", help="List HDF5 datasets and exit")
    return parser.parse_args()


def dataset_inventory(handle: h5py.File) -> list[tuple[str, tuple[int, ...], str]]:
    inventory: list[tuple[str, tuple[int, ...], str]] = []

    def collect(name: str, value: object) -> None:
        if isinstance(value, h5py.Dataset):
            inventory.append((name, tuple(value.shape), str(value.dtype)))

    handle.visititems(collect)
    return inventory


def select_dataset(handle: h5py.File, requested: str | None) -> h5py.Dataset:
    if requested:
        value = handle[requested]
        if not isinstance(value, h5py.Dataset):
            raise ValueError(f"{requested!r} is not a dataset")
        return value
    candidates = [item for item in dataset_inventory(handle) if len(item[1]) >= 3]
    if not candidates:
        raise ValueError("No dataset with at least three dimensions was found; pass --dataset explicitly")
    name, _, _ = max(candidates, key=lambda item: int(np.prod(item[1])))
    print(f"Auto-selected dataset: {name}")
    return handle[name]


def normalize_axis(axis: int, ndim: int) -> int:
    axis = axis if axis >= 0 else ndim + axis
    if not 0 <= axis < ndim:
        raise ValueError(f"Axis {axis} is invalid for a {ndim}D dataset")
    return axis


def snapshot(dataset: h5py.Dataset, frame: int, args: argparse.Namespace) -> np.ndarray:
    time_axis = normalize_axis(args.time_axis, dataset.ndim)
    selection: list[object] = [slice(None)] * dataset.ndim
    selection[time_axis] = frame
    field = np.asarray(dataset[tuple(selection)])

    if args.component_axis is not None:
        component_axis = normalize_axis(args.component_axis, dataset.ndim)
        if component_axis == time_axis:
            raise ValueError("--component-axis cannot equal --time-axis")
        component_axis_after_time = component_axis - (1 if component_axis > time_axis else 0)
        field = np.take(field, args.component, axis=component_axis_after_time)

    field = np.squeeze(field)
    if field.ndim != 2:
        raise ValueError(
            f"A selected snapshot has shape {field.shape}, not 2D. "
            "Use --component-axis and --component if the dataset stores vector components."
        )
    return field.astype(np.float32, copy=False)


def frame_indices(dataset: h5py.Dataset, args: argparse.Namespace) -> range:
    time_axis = normalize_axis(args.time_axis, dataset.ndim)
    total = dataset.shape[time_axis]
    stop = total if args.stop is None else min(args.stop, total)
    if args.stride <= 0 or not 0 <= args.start < stop:
        raise ValueError("Invalid --start, --stop, or --stride values")
    return range(args.start, stop, args.stride)


def estimate_limits(
    dataset: h5py.Dataset, indices: Iterable[int], args: argparse.Namespace
) -> tuple[float, float]:
    indices = list(indices)
    probe_indices = indices[:: max(1, len(indices) // 24)]
    samples: list[np.ndarray] = []
    for index in probe_indices[:25]:
        field = snapshot(dataset, index, args)
        step = max(1, int(np.sqrt(field.size / 80000)))
        finite = field[::step, ::step]
        if args.color_mode == "signed":
            finite = np.abs(finite)
        samples.append(finite[np.isfinite(finite)].ravel())
    values = np.concatenate(samples)
    low, high = np.percentile(values, [args.low_percentile, args.high_percentile])
    if not np.isfinite(low + high) or high <= low:
        raise ValueError("Could not determine a finite, nonzero normalization range")
    return float(low), float(high)


def load_font(path: Path | None, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if path:
        return ImageFont.truetype(str(path), size=size)
    for name in ("DejaVuSansMono.ttf", "Consolas.ttf", "cour.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def video_size(args: argparse.Namespace) -> tuple[int, int]:
    """Return H.264-friendly dimensions without implicit encoder resizing."""
    return max(16, args.width // 16 * 16), max(16, args.height // 16 * 16)


def render_frame(
    field: np.ndarray,
    low: float,
    high: float,
    args: argparse.Namespace,
    font: ImageFont.ImageFont,
) -> np.ndarray:
    width, height = video_size(args)
    ramp = args.ramp[::-1] if args.invert else args.ramp
    rows = max(8, round(args.columns * (height / width) * 0.52))
    y_indices = np.linspace(0, field.shape[0] - 1, rows).astype(int)
    x_indices = np.linspace(0, field.shape[1] - 1, args.columns).astype(int)
    sampled = field[np.ix_(y_indices, x_indices)]
    magnitude = np.abs(sampled) if args.color_mode == "signed" else sampled
    normalized = np.nan_to_num((magnitude - low) / (high - low), nan=0.0, posinf=1.0, neginf=0.0)
    normalized = np.clip(normalized, 0.0, 1.0) ** args.gamma
    character_indices = np.clip((normalized * (len(ramp) - 1)).astype(int), 0, len(ramp) - 1)

    image = Image.new("RGB", (width, height), (3, 8, 13))
    draw = ImageDraw.Draw(image)
    cell_height = height / rows
    for row, indices in enumerate(character_indices):
        line = [ramp[index] for index in indices]
        position = (width / 2, (row + 0.5) * cell_height)
        if args.color_mode == "signed":
            levels = np.minimum(3, (normalized[row] * 4).astype(int))
            for sign, base_color in ((1, (238, 76, 88)), (-1, (67, 218, 111))):
                sign_mask = sampled[row] >= 0 if sign > 0 else sampled[row] < 0
                for level, intensity in enumerate((0.34, 0.52, 0.74, 1.0)):
                    layer = "".join(
                        character if matches_sign and value_level == level else " "
                        for character, matches_sign, value_level in zip(line, sign_mask, levels)
                    )
                    if layer.strip():
                        color = tuple(round(channel * intensity) for channel in base_color)
                        draw.text(position, layer, font=font, fill=color, anchor="mm")
        else:
            draw.text(position, "".join(line), font=font, fill=(53, 189, 245), anchor="mm")
    return np.asarray(image)


def encode(dataset: h5py.Dataset, indices: range, args: argparse.Namespace) -> None:
    low, high = estimate_limits(dataset, indices, args)
    print(f"Normalization range: {low:.6g} to {high:.6g}")
    width, height = video_size(args)
    if width != args.width or height != args.height:
        print(f"Adjusted video size to {width}x{height} for H.264 compatibility")
    font_size = max(6, round(width / args.columns * 1.55))
    font = load_font(args.font, font_size)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    writer = imageio_ffmpeg.write_frames(
        str(args.output),
        (width, height),
        fps=args.fps,
        codec="libx264",
        pix_fmt_in="rgb24",
        pix_fmt_out="yuv420p",
        output_params=["-crf", str(args.crf), "-movflags", "+faststart"],
    )
    writer.send(None)
    fade_in_frames = min(len(indices), max(0, round(args.fade_in * args.fps)))
    fade_frames = min(len(indices), max(0, round(args.fade_out * args.fps)))
    if fade_in_frames:
        print(f"Applying a {fade_in_frames / args.fps:.2f}-second fade-in ({fade_in_frames} frames)")
    if fade_frames:
        print(f"Applying a {fade_frames / args.fps:.2f}-second fade-out ({fade_frames} frames)")
    try:
        for position, index in enumerate(indices, start=1):
            field = snapshot(dataset, index, args)
            magnitude_scale = 1.0
            if fade_in_frames and position <= fade_in_frames:
                magnitude_scale = min(
                    magnitude_scale,
                    (position - 1) / max(1, fade_in_frames - 1),
                )
            fade_position = position - (len(indices) - fade_frames)
            if fade_frames and fade_position > 0:
                denominator = max(1, fade_frames - 1)
                magnitude_scale = min(
                    magnitude_scale,
                    max(0.0, (fade_frames - fade_position) / denominator),
                )
            if magnitude_scale < 1.0:
                field = field * magnitude_scale
            frame = render_frame(field, low, high, args, font)
            writer.send(frame.tobytes())
            if position == 1 or position % 25 == 0 or position == len(indices):
                print(f"Rendered {position}/{len(indices)} frames")
    finally:
        writer.close()
    print(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")


def main() -> None:
    args = parse_args()
    if len(args.ramp) < 2:
        raise ValueError("--ramp must contain at least two characters")
    if args.fps <= 0 or args.fade_in < 0 or args.fade_out < 0 or args.gamma <= 0:
        raise ValueError("--fps and --gamma must be positive; fade durations cannot be negative")
    with h5py.File(args.input, "r") as handle:
        inventory = dataset_inventory(handle)
        if args.list:
            for name, shape, dtype in inventory:
                print(f"{name}: shape={shape}, dtype={dtype}")
            return
        dataset = select_dataset(handle, args.dataset)
        indices = frame_indices(dataset, args)
        print(f"Dataset shape: {dataset.shape}; rendering {len(indices)} frames")
        encode(dataset, indices, args)


if __name__ == "__main__":
    main()
