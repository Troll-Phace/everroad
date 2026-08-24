---
name: model-new
description: "Author a handcrafted Blender model to replace one named procedural asset. Use only when a specific asset has been explicitly chosen for replacement."
allowed-tools: Read Write Edit Bash Grep Glob
---

# New handcrafted model

Procedural is the default. Run this only for an asset the user has explicitly
named. If no asset was named, ask which one — do not pick.

## 1. Establish the target

Identify the profile and key:

- scenery — a `SceneryKind` from `src/world/biomes.ts`
- car — a `CarBodyType` from `src/types.ts`

Read its procedural builder (`buildProceduralProto` in `src/world/scenery.ts`,
or `buildProceduralCar` in `src/world/car.ts`) and record its triangle count
and dimensions. That is the target to match, and the thing to beat.

## 2. Author the recipe

Copy `assets/models/src/_template.py` to `assets/models/src/<profile>.<key>.py`
and delegate to **model-smith**, citing docs/MODELS.md, the procedural
builder's file and line range, and the triangle target.

## 3. Build

```bash
npm run models:blender -- <profile>.<key>
npm run models
```

## 4. Judge it

`npm run dev`, open `/model-viewer.html`, select the subject. Procedural is on
the left, handcrafted on the right, under the game's toon ramp and fog.
Check silhouette at distance, the wireframe, and — for cars — that the wheels
roll about the axle rather than sideways.

Then check it in the game itself: drive with and without `?models=procedural`.

If the handcrafted version is not clearly better, delete the `.evr.json`, re-run
`npm run models`, and say so. Reverting to procedural is a legitimate result.

## 5. Close

```bash
npm run verify
```

Commit the recipe, the `.evr.json`, and `src/world/models/generated.ts`
together. Report triangles vs procedural, encoded bytes, and the viewer verdict.
