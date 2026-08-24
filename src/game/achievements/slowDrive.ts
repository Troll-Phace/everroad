/**
 * Everroad — sustained slow-driving tracker for the "Sunday Stroll" secret.
 *
 * Achievement checks run on a ~1 s cadence, so a raw instantaneous speed test
 * would always sample the 0-to-cruise ramp of a fresh game and hand out the
 * bounty in minute one. The frame loop feeds this accumulator every frame
 * instead, and the achievement requires a genuinely sustained amble.
 */

/** Lower edge of the ambling band (mph) — excludes rolling away from a stop. */
export const SLOW_DRIVE_MIN_MPH = 3;
/** Upper edge of the ambling band (mph) — matches the achievement flavor. */
export const SLOW_DRIVE_MAX_MPH = 20;
/** Seconds of continuous in-band driving required to unlock Sunday Stroll. */
export const SLOW_DRIVE_REQUIRED_SEC = 10;

let slowSec = 0;

/**
 * Frame-loop hook: accumulate seconds spent inside the ambling band while
 * unpaused; leaving the band resets the run. Pausing holds (neither counts
 * nor resets).
 */
export function updateSlowDrive(dtSec: number, speedMph: number, paused: boolean): void {
  if (paused) return;
  if (speedMph > SLOW_DRIVE_MIN_MPH && speedMph < SLOW_DRIVE_MAX_MPH) {
    slowSec += Math.max(0, dtSec);
  } else {
    slowSec = 0;
  }
}

/** Seconds of the current uninterrupted slow-driving run. */
export function getSlowDriveSeconds(): number {
  return slowSec;
}

/** Reset the run (tests). */
export function resetSlowDrive(): void {
  slowSec = 0;
}
