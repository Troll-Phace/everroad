/**
 * Fixed car tones — the parts of a car that are not painted by CarStyle.
 *
 * Shared by the procedural builder (`car.ts`) and the handcrafted-model
 * assembler (`models/carModel.ts`) so a Blender rig and its procedural
 * counterpart wear exactly the same glass, rubber and light colours.
 */

export const GLASS = '#bfe8f0';
export const TIRE = '#2b2b33';
export const HUB = '#d8d8d8';

export const HEAD_COLOR = '#fff6c9';
export const HEAD_EMISSIVE = 0xfff2b0;
export const TAIL_COLOR = '#ff5a4a';
export const TAIL_EMISSIVE = 0xff3020;

/** Hover-car additive discs and underglow. */
export const PAD_COLOR = 0x7ae8ff;
export const PAD_OPACITY = 0.65;
export const GLOW_COLOR = 0x58d8ff;
export const GLOW_OPACITY = 0.4;
