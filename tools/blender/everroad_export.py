"""
EverRoad exporter: Blender scene -> `<name>.evr.json`.

The `.evr.json` is a plain, readable intermediate — deduplicated vertices,
triangle indices, one part per (object, material) pair. It is committed to the
repo so CI never needs Blender; `scripts/build-models.mjs` turns it into the
quantised TypeScript the game actually ships.

Normals are deliberately NOT exported. The decoder recomputes them from the
triangle winding, flat or smoothed per the part's `smooth` flag, which is both
smaller and consistent with how `buildProto` shades the procedural protos.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import bmesh
import bpy

SCHEMA = 1
GENERATOR = "everroad-blender-kit/1"
POS_DP = 5
SHADE_DP = 4
SHADE_LAYER = "EVR_shade"
PIVOT_ROLES = {"wheel", "hub", "hoverPad"}

_current_recipe: Path | None = None


def set_recipe(path) -> None:
    """Record which recipe file is being executed (for provenance)."""
    global _current_recipe
    _current_recipe = Path(path).resolve() if path else None


def write_model(*, name, profile, meta, order, out_dir, project_root, recipe, to_game) -> Path:
    recipe_path = Path(recipe).resolve() if recipe else _current_recipe
    parts: list[dict] = []
    for obj_name in order:
        obj = bpy.data.objects.get(obj_name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"part {obj_name!r} vanished before export")
        parts.extend(_object_parts(obj, profile, to_game))

    if not parts:
        raise RuntimeError(f"{name}: every part evaluated to empty geometry")

    doc = {
        "schema": SCHEMA,
        "name": name,
        "profile": profile,
        "generator": GENERATOR,
        "axis": "y-up",
        "units": "meters",
        "meta": meta,
        "parts": parts,
    }
    if recipe_path is not None:
        # Provenance is a nicety; a scratch recipe run from outside the repo
        # still exports, it just records an absolute path.
        try:
            recorded = str(recipe_path.relative_to(project_root))
        except ValueError:
            recorded = str(recipe_path)
        doc["recipe"] = recorded
        doc["recipeSha256"] = hashlib.sha256(recipe_path.read_bytes()).hexdigest()

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{name}.evr.json"
    dest.write_text(json.dumps(doc, indent=2, sort_keys=False) + "\n", encoding="utf-8")

    tris = sum(len(p["triangles"]) for p in parts)
    verts = sum(len(p["positions"]) for p in parts)
    print(f"[everroad] {name}: {len(parts)} parts, {verts} verts, {tris} tris -> {dest}")
    return dest


def _object_parts(obj, profile, to_game) -> list[dict]:
    slot = obj.get("evr_slot")
    if slot is None:
        return []
    role = obj.get("evr_role", "static")
    smooth = bool(obj.get("evr_smooth", False))

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
        bm.verts.ensure_lookup_table()

        shade_layer = bm.verts.layers.float_color.get(SHADE_LAYER)
        matrix = obj.matrix_world
        # Wheels and pads spin/pulse about their own origin, so their geometry
        # is stored relative to that pivot; everything else is body-relative.
        pivot = to_game(matrix.translation) if role in PIVOT_ROLES else (0.0, 0.0, 0.0)

        by_material: dict[int, list] = {}
        for face in bm.faces:
            by_material.setdefault(face.material_index, []).append(face)

        slots = _material_slots(obj)
        out = []
        for material_index in sorted(by_material):
            faces = by_material[material_index]
            part_slot = slots.get(material_index, slot)
            part_name = obj.name if len(by_material) == 1 else f"{obj.name}.{material_index}"
            part = _build_part(
                faces, matrix, pivot, shade_layer, to_game, part_name, part_slot, role, smooth
            )
            if part is not None:
                out.append(part)
        bm.free()
        return out
    finally:
        evaluated.to_mesh_clear()


def _material_slots(obj) -> dict[int, str]:
    """Map each material index to the slot its material name encodes."""
    out = {}
    for i, mat in enumerate(obj.data.materials):
        if mat is not None and mat.name.startswith("EVR."):
            out[i] = mat.name[len("EVR.") :]
    return out


def _build_part(faces, matrix, pivot, shade_layer, to_game, name, slot, role, smooth):
    index_of: dict[tuple, int] = {}
    positions: list[list[float]] = []
    shade: list[float] = []
    triangles: list[list[int]] = []

    for face in faces:
        tri = []
        for loop in face.loops:
            vert = loop.vert
            world = matrix @ vert.co
            gx, gy, gz = to_game(world)
            key = (
                round(gx - pivot[0], POS_DP),
                round(gy - pivot[1], POS_DP),
                round(gz - pivot[2], POS_DP),
            )
            idx = index_of.get(key)
            if idx is None:
                idx = len(positions)
                index_of[key] = idx
                positions.append([key[0], key[1], key[2]])
                value = 1.0 if shade_layer is None else float(vert[shade_layer][0])
                shade.append(round(value, SHADE_DP))
            tri.append(idx)
        if tri[0] != tri[1] and tri[1] != tri[2] and tri[0] != tri[2]:
            triangles.append(tri)

    if not triangles:
        return None

    part = {
        "name": name,
        "role": role,
        "slot": slot,
        "smooth": bool(smooth),
        "positions": positions,
        "triangles": triangles,
    }
    if any(abs(v - 1.0) > 1e-6 for v in shade):
        part["shade"] = shade
    if role in PIVOT_ROLES:
        part["pivot"] = [round(c, POS_DP) for c in pivot]
    return part
