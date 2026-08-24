---
name: phase-implement
description: "Execute the approved plan for the current work item. Use after phase-plan is approved."
allowed-tools: Read Write Edit Bash Grep Glob Agent
---

# Implement

Execute the approved plan: delegate in dependency order, verify each result
against its acceptance criteria, run `npm run verify`, close per
rules/orchestrator.md (review → commit → progress.md → triage and milestone
review), and report what shipped.

Changes to the scene, the overlay, or audio also get a browser check before
close: `npm run dev`, drive far enough to cross a biome boundary, and confirm
the change behaves and the frame rate holds.
