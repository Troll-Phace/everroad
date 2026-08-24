"""
car.compact — the rusty-hatch starter car.

Reference: 1988-95 Honda Civic sedan, the ordinary beige one, pushed toward
EverRoad's toy proportions: wheels shoved into the corners and a touch too
big, chunky dark bumpers, a tall glassy greenhouse, short overhangs.

The one deliberate note of shabbiness is the rear bumper, which hangs a few
centimetres crooked (rolled about Z) — the car the player is trying to escape.

Authored in GAME SPACE: X right, Y up, +Z toward the nose, metres, base at
y = 0. Footprint 3.50 m x 1.85 m (over the bumpers), wheel radius 0.34 to
match the procedural compact exactly, rendered at scale 0.9 by the rig.

Key vertical lines (before the 0.9 scale):
    0.28  bottom of the body (ground clearance)
    0.78  beltline — top of the lower body, base of the glass
    0.87  cowl — rear edge of the hood, where the windscreen lands
    1.32  top of the glass
    1.42  top of the roof
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "blender"))

import everroad_kit as evr

evr.reset()
evr.car("compact", wheel_radius=0.34, scale_hint=0.9)

# --- Lower body -------------------------------------------------------------
# One slab from rocker to beltline. Everything else stacks on or hangs off it.
evr.box("body_lower", size=(1.76, 0.50, 3.24), at=(0, 0.53, 0), slot="body", bevel=0.09)

# Long, flat hood, tilted ~4 deg so the nose droops softly — the hood is meant
# to read as one near-continuous plane with the raked windscreen behind it.
evr.box(
    "hood",
    size=(1.64, 0.12, 1.10),
    at=(0, 0.77, 1.05),
    rot=(0.072, 0, 0),  # +X rotation drops the front edge
    slot="body",
    bevel=0.05,
)

# --- Greenhouse -------------------------------------------------------------
# Tall and glassy: a glass core box gives the wrap-around side glass, with a
# heavily raked windscreen slab in front, a gentler rear-glass slab behind,
# a thin body-colour roof cap, and slim C-pillars so it still reads as a
# sedan when the whole car is beige-on-beige.

# Side glass / cabin core (beltline 0.78 up to 1.32).
evr.box("glass_core", size=(1.50, 0.54, 1.24), at=(0, 1.05, -0.31), slot="glass", bevel=0.04)

# Windscreen: raked ~39 deg from vertical, from the cowl to the roof's front
# edge. THE Civic feature — hood and glass as almost one plane.
evr.box(
    "windscreen",
    size=(1.46, 0.66, 0.08),
    at=(0, 1.07, 0.32),
    rot=(-0.675, 0, 0),  # -X rotation leans the top backwards
    slot="glass",
)

# Rear glass: raked ~23 deg, much steeper than the front — short boot behind.
evr.box(
    "glass_rear",
    size=(1.40, 0.60, 0.08),
    at=(0, 1.06, -0.85),
    rot=(0.40, 0, 0),
    slot="glass",
)

# Flat roof cap.
evr.box("roof", size=(1.42, 0.10, 1.14), at=(0, 1.37, -0.30), slot="body", bevel=0.04)

# C-pillars, tilted with the rear glass, so the greenhouse has body-colour
# breaks at the back corners. Their outer faces sit 10 mm proud of the glass
# core rather than flush with it — coplanar faces sharing an outward normal
# z-fight, and toon materials are FrontSide so neither one gets culled.
for suffix, sx in (("l", -1), ("r", 1)):
    evr.box(
        f"cpillar_{suffix}",
        size=(0.15, 0.58, 0.18),
        at=(sx * 0.685, 1.05, -0.86),
        rot=(0.40, 0, 0),
        slot="body",
    )

# --- Boot -------------------------------------------------------------------
# Short deck with a crisp lip a few cm above the beltline.
evr.box("boot", size=(1.68, 0.16, 0.66), at=(0, 0.82, -1.30), slot="body", bevel=0.05)

# --- Dark plastic trim (accent) ----------------------------------------------
# The accent slot does the legibility work under the 3-step ramp: bumpers at
# both ends and a full-length side moulding strip.

# Front bumper — chunkier than real.
evr.box("bumper_f", size=(1.84, 0.26, 0.30), at=(0, 0.40, 1.60), slot="accent", bevel=0.05)

# Rear bumper — the ONE shabby detail: rolled ~2.5 deg about Z so one end
# sags visibly lower than the other.
evr.box(
    "bumper_r",
    size=(1.84, 0.26, 0.30),
    at=(0, 0.40, -1.60),
    rot=(0, 0, 0.045),
    slot="accent",
    bevel=0.05,
)

# Thin side moulding along each door line. It stops short of both axles: a
# strip that ended inside a tyre would have its seam sweep around the rotating
# sidewall, which reads as a defect rather than as wear.
for suffix, sx in (("l", -1), ("r", 1)):
    evr.box(
        f"moulding_{suffix}",
        size=(0.07, 0.13, 1.24),
        at=(sx * 0.885, 0.53, 0.03),
        slot="accent",
    )

# Grille slot between the headlights (badge-width, dark).
evr.box("grille", size=(0.56, 0.09, 0.08), at=(0, 0.68, 1.60), slot="accent")

# Full-width dark tail panel with the lamps inset into it.
evr.box("tail_panel", size=(1.56, 0.20, 0.08), at=(0, 0.66, -1.62), slot="accent")

# --- Lights -----------------------------------------------------------------
# Flush rectangular headlights spanning most of the nose width.
for suffix, sx in (("l", -1), ("r", 1)):
    evr.box(f"headlight_{suffix}", size=(0.50, 0.13, 0.08), at=(sx * 0.56, 0.68, 1.60), slot="head")
    evr.box(f"taillight_{suffix}", size=(0.40, 0.12, 0.06), at=(sx * 0.50, 0.66, -1.64), slot="tail")

# --- Wheels -----------------------------------------------------------------
# Plain steels with cheap hubcaps, pushed hard into the corners and slightly
# proud of the body. Radius 0.34 MUST match evr.car(wheel_radius=...) — the
# runtime divides ground speed by it to get spin. Origins sit on the axle.
for suffix, sx, sz in (("fl", -1, 1), ("fr", 1, 1), ("rl", -1, -1), ("rr", 1, -1)):
    evr.cylinder(
        f"wheel_{suffix}",
        radius=0.34,
        height=0.24,
        axis="x",
        at=(sx * 0.78, 0.34, sz * 1.02),
        slot="tire",
        role="wheel",
        segments=12,
    )
    evr.cylinder(
        f"hub_{suffix}",
        radius=0.16,
        height=0.26,
        axis="x",
        at=(sx * 0.78, 0.34, sz * 1.02),
        slot="hub",
        role="hub",
        segments=8,
    )

# --- Write ------------------------------------------------------------------

evr.export()
