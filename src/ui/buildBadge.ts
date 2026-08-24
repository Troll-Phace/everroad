/**
 * The build-identity badge, shared by the main menu corner and the foot of the
 * settings panel so the two cannot drift apart.
 *
 * Two renderings of the same fact live inside one element:
 *
 * - the terse `v0.1.17 · web · be074dc` line, which is what a sighted player
 *   sees and what they copy into a bug report, marked `aria-hidden` because
 *   middle dots and a bare sha read as noise out loud; and
 * - the spoken form, `EverRoad 0.1.17, web build, commit be074dc`, carried as
 *   visually-hidden text *inside* the badge rather than as an `aria-label`.
 *
 * The `aria-label` route is the trap here: the badge is a plain container,
 * which maps to the ARIA `generic` role, and `generic` prohibits naming — the
 * label is discarded and the raw dotted string is announced instead. Text
 * content is announced whatever role the element ends up with, so the spoken
 * form cannot be silently dropped by a later markup change.
 *
 * `.sr-only` sets `user-select: none`, so selecting the badge still yields
 * only the terse line.
 */
import { APP_VERSION, BUILD_COMMIT, buildLabel, runtime } from '../version/version';
import { el } from './dom';

/** The spoken form of the build identity — also used as the `title` tooltip. */
export function buildDescription(): string {
  return `EverRoad ${APP_VERSION}, ${runtime()} build, commit ${BUILD_COMMIT}`;
}

/**
 * Build one badge element. `className` carries the site-specific styling
 * (`menu-build` in the menu corner, `build-badge` in settings); both add
 * `mono` themselves.
 */
export function createBuildBadge(className: string): HTMLParagraphElement {
  const description = buildDescription();
  const badge = el('p', className);
  badge.title = description;

  const spoken = el('span', 'sr-only', description);

  const terse = el('span', undefined, buildLabel());
  terse.setAttribute('aria-hidden', 'true');

  badge.append(spoken, terse);
  return badge;
}
