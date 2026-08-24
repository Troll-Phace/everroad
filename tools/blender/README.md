# Blender side of the model pipeline

| File | Does |
|---|---|
| `everroad_kit.py` | authoring kit recipes import — primitives, slots, roles, shade, game-space coordinates |
| `everroad_export.py` | evaluates modifiers, triangulates, splits by material, writes `assets/models/*.evr.json` |
| `build_models.py` | headless driver: re-runs every recipe (`npm run models:blender`) |
| `smoke_test.py` | exporter regression test (`npm run models:smoke`) |

Recipes live in `assets/models/src/`, not here. The full reference is
[`docs/MODELS.md`](../../docs/MODELS.md).
