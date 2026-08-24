/**
 * Handcrafted-model lookup.
 *
 * Procedural is the default and stays the default: an asset is only
 * handcrafted when someone has deliberately authored a recipe for it, and the
 * presence of an entry in `generated.ts` is that opt-in. Everything else falls
 * through to its procedural builder, which is why every caller here treats
 * `null` as the ordinary case rather than an error.
 *
 * `?models=procedural` in the URL disables handcrafted models wholesale, for
 * side-by-side comparison against the procedural original.
 */

import type { CarBodyType } from '../../types';
import type { EncodedModel } from './codec';
import { MODELS } from './generated';

export type ModelSource = 'auto' | 'procedural';

let cachedSource: ModelSource | null = null;

/** Which builder to prefer, read once from the URL. */
export function modelSource(): ModelSource {
  if (cachedSource === null) {
    let source: ModelSource = 'auto';
    if (typeof location !== 'undefined' && location.search) {
      const value = new URLSearchParams(location.search).get('models');
      if (value === 'procedural') source = 'procedural';
    }
    cachedSource = source;
  }
  return cachedSource;
}

/** Test/viewer hook: force a source, or pass null to re-read the URL. */
export function setModelSource(source: ModelSource | null): void {
  cachedSource = source;
}

function lookup(key: string): EncodedModel | null {
  if (modelSource() === 'procedural') return null;
  return MODELS[key] ?? null;
}

/** The handcrafted proto for a scenery kind, or null to stay procedural. */
export function sceneryModel(kind: string): EncodedModel | null {
  const model = lookup(`scenery.${kind}`);
  return model?.profile === 'scenery' ? model : null;
}

/** The handcrafted rig for a car body type, or null to stay procedural. */
export function carModel(bodyType: CarBodyType): EncodedModel | null {
  const model = lookup(`car.${bodyType}`);
  return model?.profile === 'car' ? model : null;
}

/** Every handcrafted model, for the model viewer's index. */
export function allModels(): EncodedModel[] {
  return Object.values(MODELS);
}
