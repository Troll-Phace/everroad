"""
Exporter smoke test. Run it whenever the kit or the exporter changes:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/blender/smoke_test.py

It builds one scenery proto and one car rig out of kit primitives, exports both
to a scratch directory, and asserts the intermediate is well formed and in the
right coordinate frame. Nothing is written into `assets/models/`.

CI does not run this — it has no Blender. CI validates the committed
intermediates instead, via `npm run models:check`.
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import everroad_kit as evr  # noqa: E402

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        failures.append(message)


def near(a: float, b: float, tol: float = 1e-4) -> bool:
    return abs(a - b) < tol


def test_scenery(out: Path) -> None:
    print("scenery proto")
    evr.reset()
    evr.scenery("rock", radius=0.9, height=1.0)
    trunk = evr.box("base", size=(0.8, 0.5, 0.8), at=(0, 0.25, 0), slot="#7a5238")
    crown = evr.icosphere("crown", radius=0.5, at=(0, 0.8, 0), slot="tint")
    evr.shade_gradient(crown, lo=0.72, hi=1.10)
    evr.export(out_dir=out)

    doc = json.loads((out / "scenery.rock.evr.json").read_text())
    check(doc["profile"] == "scenery", "profile is scenery")
    check(doc["name"] == "scenery.rock", "name is namespaced")
    check(doc["meta"] == {"radius": 0.9, "height": 1.0}, "meta round-trips")
    check(len(doc["parts"]) == 2, f"two parts (got {len(doc['parts'])})")

    parts = {p["name"]: p for p in doc["parts"]}
    check(parts["base"]["slot"] == "#7a5238", "literal colour survives as a slot")
    check(parts["crown"]["slot"] == "tint", "tint slot survives")
    check("shade" not in parts["base"], "un-shaded part omits shade")
    check("shade" in parts["crown"], "shaded part carries shade")

    ys = [p[1] for p in parts["base"]["positions"]]
    check(near(min(ys), 0.0), f"base sits on y=0 (min y {min(ys):.4f})")
    check(near(max(ys), 0.5), f"base is 0.5 m tall (max y {max(ys):.4f})")
    xs = [p[0] for p in parts["base"]["positions"]]
    zs = [p[2] for p in parts["base"]["positions"]]
    check(near(max(xs), 0.4) and near(max(zs), 0.4), "box size maps to game X/Z")
    check(all(len(t) == 3 for t in parts["base"]["triangles"]), "everything is triangulated")
    check(len(parts["base"]["triangles"]) == 12, "an un-bevelled box is 12 tris")

    shade = parts["crown"]["shade"]
    check(near(min(shade), 0.72, 0.02) and near(max(shade), 1.10, 0.02), "shade gradient range")


def test_car(out: Path) -> None:
    print("car rig")
    evr.reset()
    evr.car("compact", wheel_radius=0.34, scale_hint=0.9)
    evr.box("chassis", size=(1.75, 0.62, 3.3), at=(0, 0.61, 0), slot="body", bevel=0.08)
    evr.box("glass", size=(1.5, 0.3, 1.6), at=(0, 1.05, -0.1), slot="glass")
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
    evr.export(out_dir=out)

    doc = json.loads((out / "car.compact.evr.json").read_text())
    check(doc["profile"] == "car", "profile is car")
    check(doc["meta"]["bodyType"] == "compact", "bodyType recorded")
    check(near(doc["meta"]["wheelRadius"], 0.34), "wheelRadius recorded")

    parts = {p["name"]: p for p in doc["parts"]}
    wheels = [p for p in doc["parts"] if p["role"] == "wheel"]
    check(len(wheels) == 4, f"four wheels (got {len(wheels)})")
    check(all("pivot" in w for w in wheels), "wheels carry a pivot")

    fl = parts["wheel_fl"]
    check(
        near(fl["pivot"][0], -0.8) and near(fl["pivot"][1], 0.34) and near(fl["pivot"][2], 0.93),
        f"front-left pivot in game space (got {fl['pivot']})",
    )
    # Pivot-relative geometry straddles the origin, and the axle runs along X.
    xs = [p[0] for p in fl["positions"]]
    ys = [p[1] for p in fl["positions"]]
    check(near(max(xs), 0.13) and near(min(xs), -0.13), "tyre is 0.26 m wide along X")
    check(near(max(ys), 0.34) and near(min(ys), -0.34), "tyre radius 0.34 about its pivot")

    check(parts["chassis"]["slot"] == "body", "body slot survives")
    check(len(parts["chassis"]["triangles"]) > 12, "the bevel modifier was applied")
    # Nose is +Z in game space: a chassis 3.3 m long reaches z = +1.65.
    zs = [p[2] for p in parts["chassis"]["positions"]]
    check(near(max(zs), 1.65, 0.01), f"chassis front at +Z (max z {max(zs):.3f})")


def test_guards() -> None:
    print("guards")
    evr.reset()
    evr.scenery("rock", radius=1, height=1)
    try:
        evr.box("a", size=(1, 1, 1), slot="tire")
        check(False, "a car slot is rejected on a scenery model")
    except ValueError:
        check(True, "a car slot is rejected on a scenery model")
    try:
        evr.box("b", size=(1, 1, 1), slot="tint", role="wheel")
        check(False, "a non-static scenery role is rejected")
    except ValueError:
        check(True, "a non-static scenery role is rejected")
    evr.box("c", size=(1, 1, 1), slot="tint")
    try:
        evr.box("c", size=(1, 1, 1), slot="tint")
        check(False, "duplicate part names are rejected")
    except ValueError:
        check(True, "duplicate part names are rejected")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        test_scenery(out)
        test_car(out)
        test_guards()
    if failures:
        print(f"\n{len(failures)} check(s) FAILED")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    code = main()
    # --background still exits 0 on a plain return, so be explicit.
    sys.exit(code)
