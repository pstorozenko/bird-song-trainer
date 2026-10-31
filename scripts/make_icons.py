# Render public/icons/icon.svg to the PNG sizes a PWA needs. Run: uv run --with playwright python scripts/make_icons.py
import pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent / "public" / "icons"
svg = (root / "icon.svg").read_text()
targets = [("icon-192.png", 192, 0), ("icon-512.png", 512, 0), ("apple-touch-icon.png", 180, 0.06), ("maskable-512.png", 512, 0.12)]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, pad in targets:
        pg = b.new_page(viewport={"width": size, "height": size})
        inner = int(size * (1 - 2 * pad))
        # maskable: full-bleed background, icon shrunk into the safe zone; others: transparent corners
        bg = "#2f6b3a" if pad else "transparent"
        pg.set_content(f'<html><body style="margin:0;background:{bg};display:grid;place-items:center;height:{size}px">'
                       f'<div style="width:{inner}px;height:{inner}px">{svg.replace("<svg ", "<svg width=100% height=100% ")}</div></body></html>')
        pg.screenshot(path=str(root / name), omit_background=not pad)
        print("wrote", name)
    b.close()
