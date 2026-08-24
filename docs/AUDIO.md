# Everroad — Audio Module

Fully generative Web Audio soundscape. No audio files, no DOM, no timers —
every sound is synthesized from oscillators and noise buffers, and every
"event" (chord change, bird chirp, chime) is scheduled off the audio clock
inside the per-frame `update()` call.

Entry point: `src/audio/audio.ts` → `createAudioEngine(): AudioEngine`
(the interface lives in `src/types.ts`).

## Files

| File | Responsibility |
|------|----------------|
| `audio.ts` | Graph wiring, bus/master chain, lifecycle (start/enable/volumes), mood-change detection, one-shot dispatch |
| `palettes.ts` | Per-biome key/mode data: root note, melody scale, chord progression, brightness |
| `music.ts` | Pad chords, phase (time-of-day) shaping, wind-chime melody + feedback delay |
| `engineSound.ts` | Engine hum bed + drift tire layer |
| `nature.ts` | Wind, birds, crickets, rain bed + thunder rumbles, aurora shimmer |
| `sfx.ts` | One-shots: coin/relic pickups, achievement, purchase, near-miss, prestige |
| `helpers.ts` | Noise buffer generation, `rampTo` (click-free param ramps), midi→Hz, RNG |

## Node graph

```
MUSIC BUS (setMusicVolume)
  pad chords: [per-note triangle(-cents) + sine(+cents)] x4  ┐
              + sine sub an octave below chord root          ├─ chordGain ─▶ LP filter ─▶ padGain ─┐
              (old chord releases 8s, new attacks 6s,        ┘      ▲ slow LFO (0.06 Hz, ±140 Hz)  │
               overlapping = seamless crossfade)                                                   │
  chimes: sine pluck ─▶ chimeBus ─┬─ dry ──────────────────────────────────────────────────────────┤
                                  └─ delay(0.42s) ⇄ LP(2.4k)·fb(0.34) ─ wet ───────────────────────┤
  aurora shimmer: 2 detuned high sines + chorus LFO ─▶ shimmerGain ────────────────────────────────┤
                                                                                                   ▼
                                                                                              musicBus
SFX BUS (setSfxVolume)                                                                             │
  engine: brown noise ─▶ LP(~140–340) ─▶ gain      ┐                                               │
          saw+sine(55→110 Hz) ─▶ LP(~180–340) ─▶ g ├───────────────────────────────────────────────┤
          drift: white noise ─▶ BP(1.7k) ─▶ gain   ┘                                               │
  nature: wind pink noise ─▶ BP(wandering ~320–640) ─▶ gain (slow swell LFO)                       │
          rain white noise ─▶ LP(5.2k) ─▶ HP(420) ─▶ gain                                          │
          birds / crickets / thunder (scheduled one-shots) ────────────────────────────────────────┤
  one-shots: plucks, whoosh, swell ─┬─ dry ────────────────────────────────────────────────────────┤
                                    └─ echo send: delay(0.27s) ⇄ LP(2.6k)·fb(0.3) ─────────────────┤
                                                                                                   ▼
                                                                                               sfxBus
                                                                                                   │
                                        musicBus + sfxBus ─▶ master ─▶ DynamicsCompressor ─▶ output
                                                             (threshold -20 dB, ratio 3:1, soft glue)
```

Routing rationale: the **music bus** carries everything tonal-and-ambient
(pads, chimes, aurora shimmer — it's pitched, so it lives with the music).
The **sfx bus** carries the car, the weather/nature noise beds, and all
one-shots — turning "SFX" down quiets the world; turning "Music" down leaves
just the drive.

## Lifecycle & safety

- **No AudioContext until `start()`.** `main.ts` calls `start()` on the first
  user gesture; before that every method is a silent no-op. `start()` is
  idempotent and wrapped in try/catch — if construction fails (no Web Audio,
  weird browser), the engine flags itself failed and every later call no-ops.
  An audio failure can never crash the game.
- **`setEnabled(false)`** ramps the master gain to 0 over ~0.5 s (no abrupt
  cut); once the tail has faded, the next `update()` call suspends the
  AudioContext to save CPU. `setEnabled(true)` resumes and ramps back up.
- **Volumes** are squared (`v*v`) for a perceptual-feeling curve and applied
  with short ramps; values set before `start()` are stored and applied at
  build time.
- **`update(mood)` is cheap:** it compares the incoming mood to what was last
  applied and only touches AudioParams on change (biome, phase, weather,
  drift-flag; speed only when it moved > 0.4 mph). Scheduled events (chords,
  chimes, birds, crickets, rumbles) are simple `now >= nextTime` checks on
  `ctx.currentTime` — no `setInterval`/`setTimeout` anywhere.

## Layer details

### 1. Music bed (`music.ts`)

Each chord is a fresh set of oscillators: for every chord tone, a triangle
detuned a few cents flat + a sine a few cents sharp (the beating between them
is the "analog warmth"), plus one sine an octave below the chord root as a
sub. All feed a shared lowpass whose cutoff breathes with a 0.06 Hz LFO.

- **Chord clock:** every 20–30 s (random) the progression advances (85%
  next-chord, 15% random-chord for variety). The outgoing chord releases over
  ~8 s while the incoming one swells over ~6 s — the overlap is the
  crossfade, so there is never a hard cut.
- **Biome change:** just a chord change into the new palette with a ~5 s
  fade, plus a filter-brightness ramp. Handled identically, so biome
  transitions are musically seamless.
- **Time of day** (`PHASE_CFG` in `music.ts`): night darkens the filter
  (430 Hz base), drops the top chord tone (sparser), and quiets the pad;
  sunset is the warmest/fullest (1250 Hz, +15% gain); dawn/day sit between.
- **Chimes:** every 8–20 s a single sine pluck on a random scale note, two
  octaves up, into a lowpassed feedback delay — distant wind chimes. At
  night they become quieter, higher "starlight" plinks arriving every 6–14 s.

### 2. Engine (`engineSound.ts`)

Deliberately soft — a cozy presence, not a motor sport. Brown noise through
a heavy lowpass is the road-rumble body; a saw+sine pair (with a 0.11 Hz
±1.2 Hz pitch wobble) is the faint motor tone. Speed maps 0→120 mph onto
pitch 55→110 Hz and modest gain/cutoff increases, smoothed with
`setTargetAtTime` (~0.5 s) so speed changes glide. Drifting fades in a
bandpassed white-noise "shhh" at 1.7 kHz (fast in, slow out).

### 3. Nature (`nature.ts`)

- **Wind** — always on: pink noise through a bandpass whose center wanders
  (0.028 Hz LFO, ±160 Hz) with a slow amplitude swell (0.045 Hz). `leaves`
  (and petal-drift) weather roughly doubles both base level and swell depth.
- **Rain** — white noise shaped LP 5.2 kHz + HP 420 Hz, faded in/out over
  ~2.5 s on weather change; while raining, a distant rumble every 15–40 s
  (low sine swell 42→38 Hz + a lowpassed brown-noise puff, ~2.4 s).
- **Birds** — day/dawn, not during rain: every 4–15 s a chirp of 2–4 fast
  sine pitch-envelope notes (2.4–3.8 kHz, up-then-down glides).
- **Crickets** — night: every 0.6–1.8 s a burst of 4–6 short 4.1 kHz sine
  ticks 65 ms apart.
- **Aurora shimmer** — two high sines at the palette's root+fifth three
  octaves up, detuned ±6–7 cents with a 0.31 Hz chorus LFO on detune, faded
  in over ~4 s. Routed to the music bus so it always agrees with the key.

### 4. One-shots (`sfx.ts`)

All pitched one-shots receive frequencies from the *current biome's scale*
(via the music layer), so pickups always land in key.

| Event | Sound |
|-------|-------|
| `onPickup('coin')` | Marimba-ish pluck: sine + faint 4× partial, ~0.3 s decay, ±3-cent humanization. Pitches form a **coin run**: consecutive coins walk up then down a scale (major, natural minor, or lydian — picked at random per run) rooted at the current biome key; a >2.5 s lull starts a fresh run |
| `onPickup('relic')` | 3-note upward scale arpeggio (degrees d, d+2, d+4) into the echo send, capped with a high-octave sparkle |
| `onAchievement()` | Warm major arpeggio — root, just-intoned 3rd (5/4), 5th (3/2) — on the key's root, 0.9 s decays |
| `onPurchase()` | Soft felt thump (sine 150→62 Hz) + one modest chime. Deliberately kaching-less |
| `onNearMiss()` | White-noise whoosh through a bandpass sweeping 450→3000 Hz over ~0.25 s |
| `onPrestige()` | ~2.5 s: low saw + air noise through an opening lowpass (150→2600 Hz) swelling up, then an 8-note scale cascade with echo, last note ringing 1.6 s |

## Per-biome palettes (`palettes.ts`)

Roots sit in the C2–E3 range so pads stay warm and low.

| Biome | Key / mode | Progression | Mood |
|-------|-----------|-------------|------|
| meadow (Emerald Meadows) | C major | Cmaj7 · Fmaj7 · Am7 · G(add9) | warm, open |
| farmland (Amber Farmland) | D major | D(add9) · G(add9) · D · A7 | folksy, plain triads |
| sunflower (Sunflower Coast) | E major (pent. melody) | E(add9) · A(add9) · C#m7 · B7 | sunny, bright register |
| autumn (Emberwood, HERO) | G mixolydian | G(add9) · Fmaj7 · C(add9) · Dm7 | nostalgic amber (the bVII chord) |
| pine (Mistpine Hills) | E minor (pent. melody) | Em(add9) · Cmaj7 · G · Am7 | cool, misty |
| lavender (Lavender Reach) | F lydian | Fmaj7♯11 · Cmaj7 · G(lyd) · Em7 | dreamy, floating ♯4 |
| cherry (Blossom Vale) | A major pentatonic | A(add9) · F♯m7 · D(add9) · E(add9) | bright, blossom-light |
| wetland (Dawnmarsh) | D suspended | Dsus2 · Csus-color · Gsus2 · Asus4 | airy, unresolved dawn mist |

Each palette also carries a `brightness` (0–1) that biases the pad filter
±35% around the time-of-day cutoff — pine/wetland sit darker, sunflower and
cherry brighter.

## Tuning guide

Most knobs are named constants near the top of their file:

- **Overall pad level:** `PAD_LEVEL` in `music.ts` (0.14). Per-phase gain and
  cutoff: `PHASE_CFG` in `music.ts`.
- **Chord pacing:** the `rand(20, 30)` in `changeChord()`; crossfade lengths
  are the `changeChord(8, 6)` call in `update` and `BIOME_FADE_SEC` (5 s) in
  `audio.ts`.
- **Chime frequency/level:** `chimeMin/chimeMax/chimeVol` per phase in
  `PHASE_CFG`; delay color in the `delay`/`fbFilter`/`fb` nodes of `music.ts`.
- **Engine loudness/pitch:** gain and frequency maps in
  `engineSound.ts#update` (the `0.008 + 0.014 * t` style lines); drift level
  is the `0.035` in the same function. Speed normalization is `/ 120`.
- **Weather levels:** wind base/swell and rain gain targets in
  `nature.ts#update`; rumble cadence is `rand(15, 40)`.
- **One-shot levels:** the `vol` arguments inside each method of `sfx.ts`
  (coins ~0.08, whoosh 0.06, prestige swell 0.06).
- **Give a biome a new sound:** edit its entry in `palettes.ts` — chords are
  semitone offsets from `root`, melody `scale` is one octave of intervals.
  Keep chord offsets roughly within −5…+21 so voicings stay in the pad's
  sweet register.
- **Glue:** compressor settings in `audio.ts#build` (threshold −20 dB,
  ratio 3:1). If you add loud layers, drop bus trims rather than fighting
  the compressor.

## Interface notes

- `AudioContext` is created lazily in `start()`; call it from a user gesture.
- Volumes/enabled may be set before `start()` — they're stored and applied
  once the graph exists.
- One-shots (`onPickup` etc.) silently no-op while the engine is not started,
  disabled, or the context isn't running — safe to call from anywhere.
- `update(mood)` should be called every frame (or every few frames); all
  internal scheduling derives from it.
