"""
Recipe template — copy this to `<profile>.<key>.py` and edit.

The file name has no bearing on the model name; `evr.scenery()` / `evr.car()`
decides that. Files starting with `_` are skipped by the headless builder.

Build it:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/blender/build_models.py -- <recipe-stem>
    npm run models

Or, with Blender open and the MCP connected, run the snippet in
docs/MODELS.md so you can eyeball the viewport between edits.

You author in GAME SPACE: X right, Y up, +Z toward the front of the car /
the direction of travel, metres, base of the model at y = 0.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "blender"))

import everroad_kit as evr

evr.reset()

# --- Pick one -------------------------------------------------------------
#
# evr.scenery('rock', radius=0.9, height=1.0)
#   radius feeds near-miss/obstacle checks in chunks.ts; height feeds the
#   0.12 m sink into the terrain. Slots are 'tint' (per-instance palette
#   colour) or a literal '#rrggbb'.
#
# evr.car('compact', wheel_radius=0.34, scale_hint=0.9)
#   wheel_radius must match the modelled tyre — the runtime divides ground
#   speed by it to get spin. Slots: body, accent, glass, tire, hub, head,
#   tail, pad, glow, or a literal '#rrggbb'.

evr.car("compact", wheel_radius=0.34, scale_hint=0.9)

# --- Body -----------------------------------------------------------------

evr.box("chassis", size=(1.75, 0.62, 3.3), at=(0, 0.61, 0), slot="body", bevel=0.12)
evr.box("cabin", size=(1.5, 0.6, 1.7), at=(0, 1.22, -0.1), slot="accent", bevel=0.14)
evr.box("glassband", size=(1.54, 0.28, 1.56), at=(0, 1.3, -0.1), slot="glass")

# --- Wheels ---------------------------------------------------------------
#
# Four wheels named *_fl, *_fr, *_rl, *_rr, each with its own origin at the
# axle — the exporter stores wheel geometry relative to that pivot so the
# runtime can spin it. A matching hub_<suffix> rides along with each wheel.

for suffix, sx, sz in (("fl", -1, 1), ("fr", 1, 1), ("rl", -1, -1), ("rr", 1, -1)):
    evr.cylinder(
        f"wheel_{suffix}",
        radius=0.34,
        height=0.26,
        axis="x",
        at=(sx * 0.8, 0.34, sz * 0.93),
        slot="tire",
        role="wheel",
        segments=12,
    )
    evr.cylinder(
        f"hub_{suffix}",
        radius=0.17,
        height=0.28,
        axis="x",
        at=(sx * 0.8, 0.34, sz * 0.93),
        slot="hub",
        role="hub",
        segments=8,
    )

# --- Write ----------------------------------------------------------------

evr.export()
