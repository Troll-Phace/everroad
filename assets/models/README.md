# Handcrafted models

Procedural is the default and stays the default. A model lives here only
because someone deliberately chose to hand-author that one asset; everything
without an entry falls through to its procedural builder in `src/world/`.

```
src/*.py            the recipes — the source of truth, reviewable in a diff
*.evr.json          exported intermediates, committed so CI needs no Blender
```

`.blend` files are scratch and are git-ignored. If a model only exists in a
`.blend`, it does not exist.

Full pipeline reference: [`docs/MODELS.md`](../../docs/MODELS.md).
