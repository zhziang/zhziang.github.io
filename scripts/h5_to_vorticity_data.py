#!/usr/bin/env python3
"""Compress periodic 2D vorticity snapshots for the browser ASCII renderer."""

from __future__ import annotations

import argparse
import gzip
import json
import struct
from pathlib import Path
from typing import Iterable

import h5py
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--dataset", default="vorticity")
    parser.add_argument("--output", type=Path, default=Path("assets/vorticity.vt2d.gz"))
    parser.add_argument("--time-axis", type=int, default=0)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--stop", type=int)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--grid", type=int, default=96, help="Periodic square grid size")
    parser.add_argument("--fps", type=float, default=20.0)
    parser.add_argument("--fade-in", type=float, default=2.0)
    parser.add_argument("--fade-out", type=float, default=2.0)
    parser.add_argument("--gamma", type=float, default=0.55)
    parser.add_argument(
        "--view-scale",
        type=float,
        default=1.0,
        help="Fraction of one periodic domain shown vertically (default: 1.0)",
    )
    parser.add_argument("--percentile", type=float, default=97.0)
    parser.add_argument("--list", action="store_true")
    return parser.parse_args()


def inventory(handle: h5py.File) -> list[tuple[str, tuple[int, ...], str]]:
    result: list[tuple[str, tuple[int, ...], str]] = []

    def collect(name: str, value: object) -> None:
        if isinstance(value, h5py.Dataset):
            result.append((name, tuple(value.shape), str(value.dtype)))

    handle.visititems(collect)
    return result


def axis_index(axis: int, ndim: int) -> int:
    normalized = axis if axis >= 0 else ndim + axis
    if not 0 <= normalized < ndim:
        raise ValueError(f"Invalid time axis {axis} for {ndim} dimensions")
    return normalized


def get_snapshot(dataset: h5py.Dataset, index: int, time_axis: int) -> np.ndarray:
    selection: list[object] = [slice(None)] * dataset.ndim
    selection[time_axis] = index
    field = np.squeeze(np.asarray(dataset[tuple(selection)], dtype=np.float32))
    if field.ndim != 2:
        raise ValueError(f"Selected snapshot has shape {field.shape}; expected a scalar 2D field")
    return field


def indices_for(dataset: h5py.Dataset, args: argparse.Namespace, time_axis: int) -> range:
    total = dataset.shape[time_axis]
    stop = total if args.stop is None else min(args.stop, total)
    if args.stride <= 0 or not 0 <= args.start < stop:
        raise ValueError("Invalid start, stop, or stride")
    return range(args.start, stop, args.stride)


def periodic_downsample(field: np.ndarray, size: int) -> np.ndarray:
    """Sample [0,L) without duplicating the periodic endpoint."""
    y = np.floor(np.arange(size) * field.shape[0] / size).astype(int)
    x = np.floor(np.arange(size) * field.shape[1] / size).astype(int)
    return field[np.ix_(y, x)]


def estimate_scale(
    dataset: h5py.Dataset, indices: Iterable[int], time_axis: int, percentile: float
) -> float:
    indices = list(indices)
    probes = indices[:: max(1, len(indices) // 31)][:32]
    samples = []
    for index in probes:
        field = get_snapshot(dataset, index, time_axis)
        step = max(1, int(np.sqrt(field.size / 100000)))
        values = np.abs(field[::step, ::step])
        samples.append(values[np.isfinite(values)].ravel())
    scale = float(np.percentile(np.concatenate(samples), percentile))
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError("Could not determine a positive finite quantization scale")
    return scale


def write_data(dataset: h5py.Dataset, args: argparse.Namespace) -> None:
    time_axis = axis_index(args.time_axis, dataset.ndim)
    indices = indices_for(dataset, args, time_axis)
    scale = estimate_scale(dataset, indices, time_axis, args.percentile)
    metadata = {
        "version": 1,
        "frames": len(indices),
        "height": args.grid,
        "width": args.grid,
        "fps": args.fps,
        "scale": scale,
        "gamma": args.gamma,
        "viewScale": args.view_scale,
        "fadeIn": args.fade_in,
        "fadeOut": args.fade_out,
        "periodic": True,
        "ramp": " .:-=+*#%@",
        "dtype": "int8",
    }
    header = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(args.output, "wb", compresslevel=9) as output:
        output.write(b"VT2D")
        output.write(struct.pack("<I", len(header)))
        output.write(header)
        for position, index in enumerate(indices, start=1):
            field = periodic_downsample(get_snapshot(dataset, index, time_axis), args.grid)
            quantized = np.rint(np.clip(field / scale, -1.0, 1.0) * 127).astype(np.int8)
            output.write(quantized.tobytes(order="C"))
            if position == 1 or position % 100 == 0 or position == len(indices):
                print(f"Compressed {position}/{len(indices)} snapshots")
    print(json.dumps(metadata, indent=2))
    print(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")


def main() -> None:
    args = parse_args()
    if args.grid < 16 or args.fps <= 0 or args.gamma <= 0 or not 0 < args.view_scale <= 1:
        raise ValueError("Grid must be at least 16; fps and gamma must be positive")
    if not 0 < args.percentile <= 100 or args.fade_in < 0 or args.fade_out < 0:
        raise ValueError("Invalid percentile or fade duration")
    with h5py.File(args.input, "r") as handle:
        if args.list:
            for name, shape, dtype in inventory(handle):
                print(f"{name}: shape={shape}, dtype={dtype}")
            return
        dataset = handle[args.dataset]
        if not isinstance(dataset, h5py.Dataset):
            raise ValueError(f"{args.dataset!r} is not a dataset")
        write_data(dataset, args)


if __name__ == "__main__":
    main()
