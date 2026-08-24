"""
Everroad Blender authoring kit.

Recipes import this module, build a model out of low-poly primitives, and call
`export()`. The recipe file is the source of truth for the model — the .blend
is a scratchpad. Everything here is deterministic so that re-running a recipe
produces a byte-identical `.evr.json`.

COORDINATES
-----------
You author in *game space*, not Blender space: X right, Y up, Z forward,
metres. That is the frame `src/world/car.ts` and `src/world/scenery.ts` use,
so a recipe reads like the procedural builder it replaces. The kit converts to
Blender's Z-up frame on the way in and back again on export.

    game (x, y, z)  ->  blender (x, -z, y)

MATERIAL SLOTS
--------------
A part's colour is not baked into the model — it is a *slot* the runtime fills.

  scenery:  'tint'          per-instance palette colour (Proto.mask = 1)
            '#8fb54a'       a literal baked colour     (Proto.mask = 0)

  car:      'body'          CarStyle.bodyColor
            'accent'        CarStyle.accentColor
            'glass'         fixed glass tone
            'tire' / 'hub'  fixed tyre + hub tones
            'head' / 'tail' emissive lights
            'pad' / 'glow'  hover-car additive discs
            '#c94f4f'       a literal colour

ROLES (car profile)
-------------------
  'static'    welded to the body
  'wheel'     spins with ground speed; needs a pivot at the axle
  'hub'       spins with its wheel (matched by name suffix)
  'hoverPad'  pulses; hover bodies only
  'glow'      additive underglow slab

Usage:

    import everroad_kit as evr

    evr.reset()
    evr.car('compact', wheel_radius=0.34, scale_hint=0.9)
    evr.box('chassis', size=(1.75, 0.62, 3.3), at=(0, 0.61, 0),
            slot='body', bevel=0.14)
    evr.cylinder('wheel_fl', radius=0.34, height=0.26, axis='x',
                 at=(-0.79, 0.34, 0.93), slot='tire', role='wheel')
    evr.export()
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import everroad_export  # noqa: E402  (path set up above)

PROJECT_ROOT = _HERE.parents[1]
OUT_DIR = PROJECT_ROOT / "assets" / "models"

SCENERY_SLOTS = {"tint"}
CAR_SLOTS = {"body", "accent", "glass", "tire", "hub", "head", "tail", "pad", "glow"}
ROLES = {"static", "wheel", "hub", "hoverPad", "glow"}

# game (x, y, z) -> blender (x, -z, y)
_G2B = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_4x4()
_B2G = _G2B.inverted()

_state: dict = {}


# ---------------------------------------------------------------------------
# Frame conversion
# ---------------------------------------------------------------------------


def to_blender(x: float, y: float, z: float) -> Vector:
    """Game-space point -> Blender-space point."""
    return Vector((x, -z, y))


def to_game(v) -> tuple:
    """Blender-space point -> game-space tuple."""
    return (v[0], v[2], -v[1])


def _game_matrix(at, rot, scale) -> Matrix:
    """Compose a game-space TRS and express it in Blender space."""
    t = Matrix.Translation(Vector(at))
    r = (
        Matrix.Rotation(rot[1], 4, "Y")
        @ Matrix.Rotation(rot[0], 4, "X")
        @ Matrix.Rotation(rot[2], 4, "Z")
    )
    s = Matrix.Diagonal(Vector(scale).to_4d())
    return _G2B @ (t @ r @ s) @ _B2G


# ---------------------------------------------------------------------------
# Scene lifecycle
# ---------------------------------------------------------------------------


def reset() -> None:
    """Wipe the scene. Every recipe starts here."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)
    _state.clear()
    _state.update(profile=None, name=None, meta={}, order=[])


def scenery(name: str, *, radius: float, height: float) -> None:
    """Declare this recipe as a scenery proto. `name` is a SceneryKind."""
    _require_reset()
    _state["profile"] = "scenery"
    _state["name"] = f"scenery.{name}"
    _state["meta"] = {"radius": round(float(radius), 5), "height": round(float(height), 5)}


def car(body_type: str, *, wheel_radius: float, scale_hint: float = 1.0) -> None:
    """Declare this recipe as a car rig. `body_type` is a CarBodyType.

    `wheel_radius` is the un-scaled radius the runtime divides ground speed by
    to get wheel spin; it must match the modelled tyre. `scale_hint` is only
    recorded for the viewer — the runtime scales by CarStyle.scale.
    """
    _require_reset()
    _state["profile"] = "car"
    _state["name"] = f"car.{body_type}"
    _state["meta"] = {
        "bodyType": body_type,
        "wheelRadius": round(float(wheel_radius), 5),
        "scaleHint": round(float(scale_hint), 5),
    }


def _require_reset() -> None:
    if "profile" not in _state:
        raise RuntimeError("call evr.reset() before declaring the model")


def _require_profile() -> str:
    profile = _state.get("profile")
    if not profile:
        raise RuntimeError("call evr.scenery(...) or evr.car(...) before adding parts")
    return profile


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


def _validate_slot(slot: str) -> str:
    profile = _require_profile()
    if slot.startswith("#"):
        if len(slot) != 7:
            raise ValueError(f"literal colour must be #rrggbb, got {slot!r}")
        int(slot[1:], 16)
        return slot.lower()
    allowed = SCENERY_SLOTS if profile == "scenery" else CAR_SLOTS
    if slot not in allowed:
        raise ValueError(f"slot {slot!r} is not valid for the {profile} profile: {sorted(allowed)}")
    return slot


_PREVIEW = {
    "tint": (0.56, 0.71, 0.29),
    "body": (0.85, 0.56, 0.45),
    "accent": (0.54, 0.35, 0.27),
    "glass": (0.75, 0.91, 0.94),
    "tire": (0.17, 0.17, 0.20),
    "hub": (0.85, 0.85, 0.85),
    "head": (1.00, 0.96, 0.79),
    "tail": (1.00, 0.35, 0.29),
    "pad": (0.48, 0.91, 1.00),
    "glow": (0.35, 0.85, 1.00),
}


def material(slot: str) -> bpy.types.Material:
    """Get or create the Blender material standing for a slot.

    The viewport colour is a preview only — the runtime supplies the real one.
    """
    slot = _validate_slot(slot)
    key = f"EVR.{slot}"
    mat = bpy.data.materials.get(key)
    if mat is None:
        mat = bpy.data.materials.new(key)
        mat.use_nodes = False
        if slot.startswith("#"):
            rgb = tuple(int(slot[i : i + 2], 16) / 255 for i in (1, 3, 5))
        else:
            rgb = _PREVIEW.get(slot, (0.8, 0.8, 0.8))
        mat.diffuse_color = (*rgb, 1.0)
    return mat


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def _finish(
    mesh: bpy.types.Mesh,
    name: str,
    slot: str,
    role: str,
    at,
    rot,
    scale,
    bevel: float,
    bevel_segments: int,
    smooth: bool,
) -> bpy.types.Object:
    profile = _require_profile()
    if role not in ROLES:
        raise ValueError(f"role {role!r} is not one of {sorted(ROLES)}")
    if profile == "scenery" and role != "static":
        raise ValueError("scenery parts are always role='static'")
    if name in _state["order"]:
        raise ValueError(f"duplicate part name {name!r}")

    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material(slot))
    obj.matrix_world = _game_matrix(at, rot, scale)
    obj["evr_slot"] = _validate_slot(slot)
    obj["evr_role"] = role
    obj["evr_smooth"] = bool(smooth)
    if bevel > 0:
        mod = obj.modifiers.new("EVR_bevel", "BEVEL")
        mod.width = bevel
        mod.segments = int(bevel_segments)
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(30)
        mod.harden_normals = False
    bpy.context.scene.collection.objects.link(obj)
    _state["order"].append(name)
    return obj


def _mesh_from_bmesh(bm: bmesh.types.BMesh, name: str) -> bpy.types.Mesh:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def box(
    name: str,
    *,
    size,
    at=(0, 0, 0),
    rot=(0, 0, 0),
    slot: str = "body",
    role: str = "static",
    bevel: float = 0.0,
    bevel_segments: int = 2,
    smooth: bool = False,
) -> bpy.types.Object:
    """Axis-aligned box. `size` is full width/height/depth in game axes."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    mesh = _mesh_from_bmesh(bm, name)
    sx, sy, sz = size
    return _finish(
        mesh, name, slot, role, at, rot, (sx, sy, sz), bevel, bevel_segments, smooth
    )


def cylinder(
    name: str,
    *,
    radius: float,
    height: float,
    axis: str = "y",
    at=(0, 0, 0),
    rot=(0, 0, 0),
    segments: int = 12,
    radius_top: float | None = None,
    slot: str = "body",
    role: str = "static",
    bevel: float = 0.0,
    bevel_segments: int = 2,
    smooth: bool = False,
) -> bpy.types.Object:
    """Cylinder (or truncated cone) along a game axis: 'x', 'y' or 'z'."""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=int(segments),
        radius1=float(radius),
        radius2=float(radius if radius_top is None else radius_top),
        depth=float(height),
    )
    mesh = _mesh_from_bmesh(bm, name)
    # create_cone is built along +Z in Blender space, which is game +Y.
    spin = {"y": (0, 0, 0), "x": (0, 0, math.pi / 2), "z": (math.pi / 2, 0, 0)}
    if axis not in spin:
        raise ValueError("axis must be 'x', 'y' or 'z'")
    ax, ay, az = spin[axis]
    rot = (rot[0] + ax, rot[1] + ay, rot[2] + az)
    return _finish(mesh, name, slot, role, at, rot, (1, 1, 1), bevel, bevel_segments, smooth)


def icosphere(
    name: str,
    *,
    radius: float,
    subdivisions: int = 1,
    at=(0, 0, 0),
    rot=(0, 0, 0),
    scale=(1, 1, 1),
    slot: str = "tint",
    role: str = "static",
    smooth: bool = False,
) -> bpy.types.Object:
    """Icosphere — the canopy/rock blob the procedural protos use."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=int(subdivisions), radius=float(radius))
    mesh = _mesh_from_bmesh(bm, name)
    return _finish(mesh, name, slot, role, at, rot, scale, 0.0, 2, smooth)


def plane(
    name: str,
    *,
    size,
    at=(0, 0, 0),
    rot=(0, 0, 0),
    slot: str = "tint",
    role: str = "static",
    smooth: bool = False,
) -> bpy.types.Object:
    """Flat quad in the XZ plane — leaves, blades, signage."""
    w, d = size
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    mesh = _mesh_from_bmesh(bm, name)
    return _finish(
        mesh, name, slot, role, at, (rot[0] + math.pi / 2, rot[1], rot[2]), (w, d, 1), 0.0, 2, smooth
    )


# ---------------------------------------------------------------------------
# Shading hints
# ---------------------------------------------------------------------------

SHADE_LAYER = "EVR_shade"


def shade_gradient(obj: bpy.types.Object, *, lo: float = 0.72, hi: float = 1.10) -> None:
    """Bake a vertical brightness gradient into the part.

    Mirrors `canopyShade` in scenery.ts: darker at the base, brighter at the
    crown. Scenery only — the car profile ignores shade.
    """
    mesh = obj.data
    ys = [(obj.matrix_world @ v.co)[2] for v in mesh.vertices]
    if not ys:
        return
    y0, y1 = min(ys), max(ys)
    span = (y1 - y0) or 1.0
    _write_shade(mesh, [lo + (hi - lo) * ((y - y0) / span) for y in ys])


def shade_flat(obj: bpy.types.Object, value: float) -> None:
    """Set one brightness multiplier across the whole part."""
    _write_shade(obj.data, [value] * len(obj.data.vertices))


def _write_shade(mesh: bpy.types.Mesh, values) -> None:
    attr = mesh.color_attributes.get(SHADE_LAYER)
    if attr is None:
        attr = mesh.color_attributes.new(SHADE_LAYER, "FLOAT_COLOR", "POINT")
    for i, value in enumerate(values):
        attr.data[i].color = (float(value), 0.0, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def export(*, out_dir: Path | str | None = None, recipe: str | None = None) -> Path:
    """Evaluate modifiers, split by material, and write `<name>.evr.json`."""
    _require_profile()
    if not _state["order"]:
        raise RuntimeError("model has no parts")
    return everroad_export.write_model(
        name=_state["name"],
        profile=_state["profile"],
        meta=_state["meta"],
        order=list(_state["order"]),
        out_dir=Path(out_dir) if out_dir else OUT_DIR,
        project_root=PROJECT_ROOT,
        recipe=recipe,
        to_game=to_game,
    )
