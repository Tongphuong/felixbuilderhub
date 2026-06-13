#!/usr/bin/env python3
"""Measure horn alpha pivots and generate the 90-combination contact audit."""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets" / "monsters" / "raw" / "PNG" / "Default"
PIVOT_FILE = ROOT / "public" / "assets" / "monsters" / "horn-pivots.json"
AUDIT_FILE = ROOT / "docs" / "HORN_AUDIT_RESULTS.md"

CANVAS = 165
HORN_COLORS = ("blue", "dark", "green", "red", "white")
HORN_SIZES = ("large", "small")
BODY_SHAPES = tuple("ABCDEF")
MAX_SCALE = 0.85
WIDTH_MARGIN = 1.05
CONTACT_INSET_PX = 4.0
CONTACT_TOLERANCE_PX = 5.0


def alpha_pixels(image: Image.Image) -> list[tuple[int, int]]:
    alpha = image.getchannel("A")
    return [
        (x, y)
        for y in range(image.height)
        for x in range(image.width)
        if alpha.getpixel((x, y)) > 0
    ]


def measure_horn(path: Path) -> dict[str, float | str]:
    image = Image.open(path).convert("RGBA")
    pixels = alpha_pixels(image)
    if not pixels:
        raise ValueError(f"{path.name} has no non-transparent pixels")
    min_x = min(x for x, _ in pixels)
    max_x = max(x for x, _ in pixels)
    max_y = max(y for _, y in pixels)
    centroid_x = sum(x for x, _ in pixels) / len(pixels)
    return {
        "file": f"PNG/Default/{path.name}",
        "pivot_x_frac": centroid_x / CANVAS,
        "pivot_y_frac": max_y / CANVAS,
        "width_frac": (max_x - min_x) / CANVAS,
    }


def body_box(image: Image.Image) -> tuple[float, float, float, float, float]:
    scale = min(CANVAS / image.width, CANVAS / image.height)
    width = image.width * scale
    height = image.height * scale
    return ((CANVAS - width) / 2, (CANVAS - height) / 2, width, height, scale)


def body_top_at_x(image: Image.Image, box: tuple[float, float, float, float, float], x: float) -> float:
    box_x, box_y, _, _, scale = box
    source_x = max(0, min(image.width - 1, round((x - box_x) / scale)))
    alpha = image.getchannel("A")
    opaque_y = [y for y in range(image.height) if alpha.getpixel((source_x, y)) > 0]
    if not opaque_y:
        raise ValueError(f"body has no alpha at source x={source_x}")
    return box_y + min(opaque_y) * scale


def placement(
    horn: Image.Image,
    pivot: dict[str, float | str],
    box: tuple[float, float, float, float, float],
) -> tuple[float, float, float, float, float]:
    box_x, box_y, box_width, _, _ = box
    max_width = float(pivot["width_frac"]) * WIDTH_MARGIN * box_width
    scale = min(MAX_SCALE, max_width / horn.width)
    source_x = float(pivot["pivot_x_frac"]) * CANVAS
    source_y = float(pivot["pivot_y_frac"]) * CANVAS
    target_x = box_x + box_width / 2
    target_y = box_y + CONTACT_INSET_PX
    return (
        target_x - source_x * scale,
        target_y - source_y * scale,
        horn.width * scale,
        horn.height * scale,
        scale,
    )


def render_thumbnail(body_path: Path, horn_path: Path, pivot: dict[str, float | str]) -> str:
    body = Image.open(body_path).convert("RGBA")
    horn = Image.open(horn_path).convert("RGBA")
    box = body_box(body)
    top_margin = 48
    canvas = Image.new("RGBA", (CANVAS, CANVAS + top_margin), (20, 28, 48, 255))

    box_x, box_y, box_width, box_height, _ = box
    body_resized = body.resize(
        (max(1, round(box_width)), max(1, round(box_height))),
        Image.Resampling.NEAREST,
    )
    canvas.alpha_composite(body_resized, (round(box_x), round(box_y + top_margin)))

    horn_x, horn_y, horn_width, horn_height, _ = placement(horn, pivot, box)
    horn_resized = horn.resize(
        (max(1, round(horn_width)), max(1, round(horn_height))),
        Image.Resampling.NEAREST,
    )
    canvas.alpha_composite(horn_resized, (round(horn_x), round(horn_y + top_margin)))

    output = io.BytesIO()
    canvas.resize((99, 128), Image.Resampling.NEAREST).save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def build_audit(pivots: dict[str, dict[str, float | str]]) -> str:
    rows: list[dict[str, str | float]] = []
    for shape in BODY_SHAPES:
        for color in HORN_COLORS:
            body_path = ASSET_DIR / f"body_{color}{shape}.png"
            body = Image.open(body_path).convert("RGBA")
            box = body_box(body)
            target_x = box[0] + box[2] / 2
            top_y = body_top_at_x(body, box, target_x)
            rows.append(
                {
                    "shape": shape,
                    "color": color,
                    "variant": "none",
                    "pivot_y": "n/a",
                    "body_top_y": "n/a",
                    "delta": "n/a",
                    "result": "PASS",
                }
            )
            for size in HORN_SIZES:
                filename = f"detail_{color}_horn_{size}.png"
                pivot = pivots[filename]
                horn = Image.open(ASSET_DIR / filename).convert("RGBA")
                horn_x, horn_y, _, _, scale = placement(horn, pivot, box)
                transformed_pivot_y = horn_y + float(pivot["pivot_y_frac"]) * CANVAS * scale
                delta = abs(transformed_pivot_y - top_y)
                rows.append(
                    {
                        "shape": shape,
                        "color": color,
                        "variant": size,
                        "pivot_y": transformed_pivot_y,
                        "body_top_y": top_y,
                        "delta": delta,
                        "result": "PASS" if delta < CONTACT_TOLERANCE_PX else "FAIL",
                    }
                )

    failures = [row for row in rows if row["result"] != "PASS"]
    thumbnails = []
    for shape in ("A", "C", "F"):
        filename = "detail_blue_horn_large.png"
        data = render_thumbnail(
            ASSET_DIR / f"body_blue{shape}.png",
            ASSET_DIR / filename,
            pivots[filename],
        )
        thumbnails.append(f'<img alt="Body {shape} + blue large horn" width="99" src="data:image/png;base64,{data}">')

    lines = [
        "# Horn Position Audit Results",
        "",
        "Generated by `python scripts/measure_horn_pivots.py`.",
        "",
        "## Measurement",
        "",
        "- Horn base pivot: alpha centroid X plus maximum opaque Y.",
        "- Fractions use the canonical 165px monster canvas.",
        f"- Render scale: `min({MAX_SCALE}, measured_width * {WIDTH_MARGIN} * body_width / horn_width)`.",
        f"- Contact target: body-box top + {CONTACT_INSET_PX:.0f}px; pass when pivot-to-body-top delta is under {CONTACT_TOLERANCE_PX:.0f}px.",
        "",
        "| File | Pivot X | Pivot Y | Width |",
        "|---|---:|---:|---:|",
    ]
    for filename, pivot in pivots.items():
        lines.append(
            f"| `{filename}` | {float(pivot['pivot_x_frac']):.6f} | "
            f"{float(pivot['pivot_y_frac']):.6f} | {float(pivot['width_frac']):.6f} |"
        )

    lines.extend(
        [
            "",
            "## Sample Thumbnails",
            "",
            " ".join(thumbnails),
            "",
            "## Contact Matrix",
            "",
            f"Result: **{len(rows) - len(failures)}/{len(rows)} PASS**.",
            "",
            "| Body | Horn color | Variant | Pivot Y | Body top Y | Delta | Result |",
            "|---|---|---|---:|---:|---:|---|",
        ]
    )
    for row in rows:
        if row["variant"] == "none":
            lines.append(
                f"| {row['shape']} | {row['color']} | none | n/a | n/a | n/a | {row['result']} |"
            )
        else:
            lines.append(
                f"| {row['shape']} | {row['color']} | {row['variant']} | "
                f"{float(row['pivot_y']):.2f} | {float(row['body_top_y']):.2f} | "
                f"{float(row['delta']):.2f} | {row['result']} |"
            )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    pivots = {}
    for color in HORN_COLORS:
        for size in HORN_SIZES:
            path = ASSET_DIR / f"detail_{color}_horn_{size}.png"
            pivots[path.name] = measure_horn(path)

    PIVOT_FILE.write_text(json.dumps(pivots, indent=2) + "\n", encoding="utf-8")
    audit = build_audit(pivots)
    AUDIT_FILE.write_text(audit, encoding="utf-8")
    print(f"Wrote {len(pivots)} horn pivots to {PIVOT_FILE}")
    print(f"Wrote 90-combination contact audit to {AUDIT_FILE}")


if __name__ == "__main__":
    main()
