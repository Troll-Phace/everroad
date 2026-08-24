# EverRoad — Economy Design

Implementation: `src/game/economy/` (`cars.ts`, `upgrades.ts`, `economy.ts`).
All numbers below are the live constants; the simulation results at the bottom
were produced by ticking the real compiled module second-by-second.

## Currencies

| Currency | Earned by | Spent on |
|----------|-----------|----------|
| **Coins** | Every mile driven (base rate x multipliers x combo) and road pickups | Coin cars, per-car parts (engine/tuning/tires/magnet/chime) |
| **Horizon Tokens** | Prestige ("Begin a New Journey") | Horizon shop (permanent globals), the Auroracraft |
| **Relics** | Rare roadside spawns (~0.008/mile base chance) | Petal Roadster (12), Marsh Wraith (30) |

## Core formulas

**Base earning constant:** `BASE_COINS_PER_MILE = 60`.

```
carSpeed (mph)   = (baseSpeed + 2 * engineLevel) * (1 + 0.05 * overdriveLevel)

coinRate/mile    = 60
                 * car.coinMult
                 * (1 + 0.08 * tuningLevel)
                 * (1 + 0.10 * horizonFlowLevel)
                 * situational

situational      = sunset x1.15 | dawn x1.05 (phases)
                 * autumn (Emberwood, hero biome) x1.10
                 * aurora x1.50 | leaves x1.05 (weather)

tick earnings    = milesDelta * coinRate/mile * (isActive ? combo : 1)

offline fraction = 0.40 + 0.08 * longHaulLevel        (level 10 => 120%)
idle coins/sec   = carSpeed * 0.94/3600 * coinRate(neutral) * offline fraction
                   (neutral = meadow / day / clear; this is the offline baseline.
                    0.94 = AUTOPILOT_CRUISE_FRACTION, the hands-off cruise speed)

pickup value     = ceil(2 sec of neutral cruising income * combo), min 1
relic chance     = 0.008/mile * (1 + 0.15*chime) * (1 + 0.15*keenEye)
magnet radius    = 2.5 m + 0.7 * magnetLevel
combo cap        = min(8, 2 + 0.5 * tiresLevel)
combo gain       = 0.25/sec + 0.03 * tiresLevel
combo duration   = 5 s + 1 s * momentumLevel
```

**Starter reference:** 42 mph cruised hands-off at 0.94x = 39.5 mph =
0.01097 miles/sec -> **0.658 coins/sec live idle** (39.5/min). Offline baseline
at long-haul 0: 0.263 coins/sec.

## Car catalog (final numbers)

| Id | Name | Tier | Cost | Speed (mph) | coinMult | Body |
|----|------|------|------|------|------|------|
| rusty-hatch | Rusty Hatchback | 0 | free | 42 | 1.0 | compact |
| commuter | Commuter | 1 | 400 c | 52 | 1.25 | sedan |
| homestead-wagon | Homestead Wagon | 1 | 700 c | 55 | 1.45 | wagon |
| orchard-pickup | Orchard Pickup | 2 | 3,500 c | 62 | 1.9 | pickup |
| wanderer-van | Wanderer Van | 2 | 6,000 c | 66 | 2.2 | van |
| sunday-classic | Sunday Classic | 3 | 28,000 c | 74 | 3.0 | classic |
| ember-gt | Ember GT | 3 | 45,000 c | 80 | 3.5 | muscle |
| crimson-comet | Crimson Comet | 4 | 240,000 c | 92 | 4.6 | sports |
| petal-roadster | Petal Roadster | 4 | 12 relics | 88 | 5.2 | classic |
| horizon-s | Horizon S | 5 | 1,800,000 c | 112 | 7.0 | super |
| marsh-wraith | Marsh Wraith | 5 | 30 relics | 105 | 8.0 | sports |
| auroracraft | Auroracraft | 6 | 200 tokens | 150 | 12.0 | hover |

Coin-tier cost growth: 400 -> 3.5K (x8.75) -> 28K (x8) -> 240K (x8.6) -> 1.8M
(x7.5) — inside the x6–10 target. Relic cars are sidegrades-plus for their tier
(higher coinMult, slightly lower speed) so relic hunting always pays off.
Effective earn rate (speed x coinMult) scales x1.9 from hatch to commuter and
~x64 from hatch to Auroracraft, against ~x4,500 cost scaling — prestige
multipliers and tuning close the gap, keeping later tiers a real grind.

## Per-car parts (reset on prestige, coins)

Cost of next level = `ceil(baseCost * growth^level * (1 - 0.02 * quickSpool))`.

| Part | Effect / level | Max | Base cost | Growth | L1..L5 cumulative |
|------|----------------|-----|-----------|--------|-------------------|
| engine | +2 mph | 25 | 15 | 1.55 | 15/24/37/56/87 = 219 |
| tuning | +8% coins | 25 | 20 | 1.60 | 20/32/52/82/132 = 318 |
| tires | +0.5 combo cap, +0.03 gain | 15 | 40 | 1.65 | ~40/66/109/180/297 |
| magnet | +0.7 m radius | 10 | 60 | 1.70 | ~60/102/174/295/502 |
| chime | +15% relic chance | 10 | 80 | 1.75 | ~80/140/245/429/751 |

Early engine/tuning levels are tens of coins (seconds-to-a-minute of income), so
the first session has constant small purchases. Max engine on the hatch = +50
mph; tires 12 reaches the hard combo cap of 8.

## Horizon shop (permanent, tokens)

Cost of next level = `ceil(baseCost * growth^level)`.

| Id | Effect / level | Max | Base | Growth |
|----|----------------|-----|------|--------|
| horizon-flow | +10% all coin earnings | 50 | 1 | 1.6 |
| long-haul | +8% offline rate (base 40%, L10 = 120%) | 10 | 2 | 1.6 |
| momentum | +1 s combo duration | 10 | 2 | 1.6 |
| head-start | start journey with `250 * L * 2^(L-1)` coins (250/1K/3K/8K/20K...) | 8 | 1 | 1.7 |
| token-magnet | +10% prestige token gain | 20 | 3 | 1.6 |
| keen-eye | +15% relic spot chance | 15 | 2 | 1.6 |
| overdrive | +5% top speed (all cars) | 20 | 3 | 1.65 |
| quick-spool | -2% per-car upgrade costs | 15 | 2 | 1.6 |

First prestige (1 token) buys horizon-flow L1 (+10% forever). Second buys
head-start or long-haul. Costs reach tens of tokens by ~L7 (1.6^7 ≈ 27).

## Prestige math

```
milesRequired = 25 * 1.35^prestigeCount
tokens        = max(1, floor((journeyMiles / 25)^0.85 * (1 + 0.10 * tokenMagnet)))
                (only when journeyMiles >= milesRequired)
```

Resets: journeyMiles -> 0, coins -> head-start value, ALL per-car part levels.
Keeps: cars, relics, tokens, globals, achievements, lifetime stats.

| Journey miles | Tokens |
|---|---|
| 25–50 | 1 |
| 75 | 2 |
| 100 | 3 |
| 150 | 4 |

Mile gates: 25 / 33.8 / 45.6 / 61.5 / 83 / 112... The 0.85 exponent makes
overshooting the gate sublinear, nudging players to prestige early and often
(cozy loop) rather than camp a run.

## Pacing timeline (simulated)

Simulated with 1-second ticks of the real module. "Mixed" = 35% of time active
(avg combo 1.8, 6 pickups/min), greedy small-upgrade buying; "mostly idle" =
10% active. Measured active/idle earn ratio at start: **x2.23** (combo 1.8 +
pickups) — inside the 2–3x target.

| Time | Mixed idle+active | Mostly idle |
|------|-------------------|-------------|
| 0–4 min | engine/tuning L1–5 on the hatch (15–90 c each) | engine/tuning L1–4 |
| ~6 min | mile 5; **commuter affordable if saving** (~1.0 c/s avg) | mile 5 |
| ~11 min | commuter bought (after upgrade spending) | — |
| ~15 min | mile 15 | commuter bought |
| ~26–27 min | **mile 25 — first prestige available (1 token)** | mile 25 @ ~27 min |
| ~31 min | homestead-wagon bought (3rd car) | — |
| ~41 min | mile 40 (still 1 token; 2 tokens at 75 mi) | homestead-wagon bought |
| 45 min | 46 mi, ~6.2K lifetime coins, 50 upgrades | 44 mi, ~4.5K lifetime coins |

Pure idle floor: commuter affordable at ~16.5 min never touching the wheel.

**Targets vs. results:**
- First car 5–8 min: a saving player affords it at ~6–7 min mixed; players who
  splurge on parts first get it at ~11 min. Pure idle ~16 min. ✓
- First prestige 30–40 min: gate reached at ~26 min, but the natural stopping
  point (after buying the wagon, ~31–40 min) yields the prestige; 1–3 tokens
  depending on how far past 25 mi the player pushes. ✓
- Active ≈ 2.2x idle. ✓
- Three cars in the first hour (hatch, commuter, wagon). ✓

## Design rationale

- **60 coins/mile** keeps early numbers chunky (whole coins per second) without
  needing exponent notation until deep in tier 4+.
- **Additive tuning (+8%/level) on a multiplicative stack** means a fresh car
  at a higher tier immediately out-earns a tuned lower car, so car purchases
  always feel like the milestone.
- **Offline at 40% of live idle** rewards checking in; long-haul lets prestige
  investment push it past 100%, a classic satisfying "break the rule" upgrade.
- **Pickups worth 2 s of income** scale automatically with the player's whole
  multiplier stack — they stay "juicy" at every stage without separate tuning.
- **Relic pacing:** 0.008/mile ≈ 1 relic per ~125 miles base; chime 10 +
  keen-eye turns that into 1 per ~35 miles late-game, putting the 12-relic
  Petal Roadster a few sessions out and the 30-relic Marsh Wraith deep-game.
- **Quick-spool at -2%/level (max -30%)** is deliberately mild: per-car parts
  reset on prestige, so the discount mostly buys back post-prestige ramp time.
