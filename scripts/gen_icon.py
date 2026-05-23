"""Generate the Apex Engineer source icon (1024x1024 PNG).

Concept: a bold teal apex chevron on a dark navy rounded square with a
subtle orange racing-line accent. Matches the in-app theme
(--bg/--accent/--accent2 in styles/index.css) and remains legible at
32x32 because the central mark is a single high-contrast shape.

Run:  python scripts/gen_icon.py
Output: src-tauri/icons/icon.png  (1024x1024)

Then run:  npm run tauri icon src-tauri/icons/icon.png
to regenerate every platform-specific size + .ico/.icns.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "icon.png"

# Palette — pulled from styles/index.css :root vars
BG_TOP    = (13, 13, 26, 255)     # --bg1
BG_BOTTOM = (26, 26, 46, 255)     # --bg3
ACCENT    = (0, 210, 190, 255)    # --accent  (teal)
ACCENT_HI = (0, 245, 220, 255)    # brighter teal for gradient highlight
ACCENT2   = (255, 135, 0, 255)    # --accent2 (orange racing line)
RIM       = (40, 60, 80, 255)     # subtle bezel rim


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return m


def vertical_gradient(size: int, top, bottom) -> Image.Image:
    img = Image.new("RGBA", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        for x in range(size):
            px[x, y] = (r, g, b, 255)
    return img


def linear_gradient_polygon(size, poly, c1, c2):
    """Fill polygon with a vertical gradient between c1 (top) and c2 (bottom)."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = vertical_gradient(size, c1, c2)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    layer.paste(grad, (0, 0), mask)
    return layer


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # 1) Background: dark navy gradient inside a rounded square
    radius = int(SIZE * 0.22)
    bg = vertical_gradient(SIZE, BG_TOP, BG_BOTTOM)
    mask = rounded_mask(SIZE, radius)

    # Subtle inner vignette toward the centre (gives depth)
    vignette = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    for i in range(0, 80, 4):
        alpha = int(40 * (1 - i / 80))
        vd.ellipse(
            (i, i, SIZE - i, SIZE - i),
            outline=(0, 210, 190, alpha),
        )
    vignette = vignette.filter(ImageFilter.GaussianBlur(20))

    canvas.paste(bg, (0, 0), mask)
    canvas = Image.alpha_composite(canvas, Image.composite(vignette, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))

    # 2) Orange racing line — thin horizontal stripe near the lower third
    line_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line_layer)
    line_y = int(SIZE * 0.78)
    line_h = max(6, SIZE // 128)
    ld.rectangle(
        (int(SIZE * 0.18), line_y, int(SIZE * 0.82), line_y + line_h),
        fill=ACCENT2,
    )
    # Glow beneath the line
    glow = line_layer.copy().filter(ImageFilter.GaussianBlur(18))
    canvas = Image.alpha_composite(canvas, Image.composite(glow, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))
    canvas = Image.alpha_composite(canvas, Image.composite(line_layer, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))

    # 3) Apex chevron — bold ^ shape, the focal element
    # Two stacked chevrons gives a "speed" feel; outer thicker, inner brighter.
    cx = SIZE // 2
    apex_top   = int(SIZE * 0.22)
    apex_base  = int(SIZE * 0.66)
    half_w     = int(SIZE * 0.34)
    thickness  = int(SIZE * 0.12)

    def chevron(top_y, base_y, half, thick):
        # Outer ^ polygon with a thick stroke (filled chevron).
        return [
            (cx - half, base_y),
            (cx, top_y),
            (cx + half, base_y),
            (cx + half - thick * 0.7, base_y),
            (cx, top_y + thick * 1.05),
            (cx - half + thick * 0.7, base_y),
        ]

    # Outer/main chevron — teal gradient
    main_poly = chevron(apex_top, apex_base, half_w, thickness)
    main_layer = linear_gradient_polygon(SIZE, main_poly, ACCENT_HI, ACCENT)

    # Glow behind the chevron
    glow_layer = main_layer.copy().filter(ImageFilter.GaussianBlur(28))
    # Tone down the glow alpha
    r, g, b, a = glow_layer.split()
    a = a.point(lambda v: int(v * 0.55))
    glow_layer = Image.merge("RGBA", (r, g, b, a))

    canvas = Image.alpha_composite(canvas, Image.composite(glow_layer, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))
    canvas = Image.alpha_composite(canvas, Image.composite(main_layer, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))

    # Inner highlight chevron — smaller, brighter, gives a layered "engineered" feel
    inner_top   = int(SIZE * 0.34)
    inner_base  = int(SIZE * 0.58)
    inner_half  = int(SIZE * 0.20)
    inner_thick = int(SIZE * 0.055)
    inner_poly  = chevron(inner_top, inner_base, inner_half, inner_thick)
    inner_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(inner_layer).polygon(inner_poly, fill=(220, 255, 250, 235))
    canvas = Image.alpha_composite(canvas, Image.composite(inner_layer, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))

    # 4) Subtle rim — 1-2px lighter edge for definition on dark wallpapers
    rim_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim_layer)
    rd.rounded_rectangle((2, 2, SIZE - 2, SIZE - 2), radius=radius - 2, outline=RIM, width=3)
    canvas = Image.alpha_composite(canvas, Image.composite(rim_layer, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))

    canvas.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
