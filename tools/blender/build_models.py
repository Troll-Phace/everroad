"""
Headless model build: re-run every recipe and rewrite its `.evr.json`.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/blender/build_models.py -- [name ...]

With no arguments it rebuilds every recipe in `assets/models/src/`. Names may
be bare stems (`car.compact`) to rebuild a subset. Recipes whose file name
starts with `_` are templates and are skipped.

This is the reproducibility guarantee: any machine with Blender can regenerate
every committed intermediate from source. CI does not run it — it verifies the
committed intermediates instead.
"""

from __future__ import annotations

import importlib
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RECIPES = ROOT / "assets" / "models" / "src"

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    wanted = set(argv)

    recipes = sorted(p for p in RECIPES.glob("*.py") if not p.name.startswith("_"))
    if wanted:
        recipes = [p for p in recipes if p.stem in wanted]
        missing = wanted - {p.stem for p in recipes}
        if missing:
            print(f"[everroad] no such recipe: {', '.join(sorted(missing))}", file=sys.stderr)
            return 1

    if not recipes:
        print("[everroad] no recipes to build")
        return 0

    import everroad_export
    import everroad_kit

    failures = []
    for recipe in recipes:
        print(f"[everroad] building {recipe.name}")
        try:
            importlib.reload(everroad_export)
            importlib.reload(everroad_kit)
            everroad_export.set_recipe(recipe)
            namespace = {"__file__": str(recipe), "__name__": "__everroad_recipe__"}
            exec(compile(recipe.read_text(encoding="utf-8"), str(recipe), "exec"), namespace)
        except Exception:
            traceback.print_exc()
            failures.append(recipe.name)

    if failures:
        print(f"[everroad] FAILED: {', '.join(failures)}", file=sys.stderr)
        return 1
    print(f"[everroad] built {len(recipes)} recipe(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
