/**
 * GENERATED FILE — do not edit.
 *
 * Written by `npm run changelog` from CHANGELOG.md, which is the source of
 * truth for patch notes. Edit that file and regenerate; `npm run verify` and
 * CI both fail when the two drift apart.
 *
 * 18 release(s), 42 note(s), newest 0.1.17 (2026-08-24).
 */

/** One `### ` block of a release: "Added", "Changed", "Fixed", and friends. */
export interface ChangelogSection {
  heading: string;
  /** Bullet text with Markdown `**bold**` left intact for the renderer. */
  items: string[];
}

/** One published version, with its ISO 8601 release date. */
export interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

/** Newest first. Excludes the [Unreleased] section. */
export const CHANGELOG: readonly ChangelogRelease[] = [
  {
    version: '0.1.17',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: [
          'Everroad now ships as a **desktop app**. Release builds are wrapped in Electron and published to GitHub Releases for macOS, Windows and Linux. The browser build is unchanged and remains how the game is developed.',
          "**What's New** — a button in the top-right of the main menu opens the full patch notes, newest release expanded.",
          'The build number sits in the bottom corner of the main menu and the settings panel, so a bug report can always name the build it came from.',
          '**Quit to Desktop** in settings, shown only in the desktop app. The browser build still quits to the main menu, because a tab cannot close itself.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          "Versioning is now semantic and retroactive: this changelog reconstructs the project's history from its commits, and every build from here on carries a version number you can quote in a bug report.",
        ],
      },
    ],
  },
  {
    version: '0.1.16',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: [
          '**The main menu.** The game no longer boots straight into driving. Continue (with a live summary of your journey), New Journey (which asks twice before erasing one) and Settings sit over live in-engine footage — a real car on a real road, re-rolled from the whole catalog each time you arrive, in a random biome at a flattering hour, with eight directed camera shots cutting every 7–11 seconds.',
          '**Quit to Main Menu** in settings. It saves your journey first.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'Sitting on the main menu no longer paid offline earnings. Quitting to the menu stamped a save, so an overnight title screen paid out a full night.',
          'New Journey silently reset your audio and graphics settings.',
          'A panel opened over the menu left the buttons behind it keyboard-live with an invisible focus ring — Enter dropped you into gameplay with the panel still up.',
          'A stray "Relic found!" toast could leak out of the attract-mode footage into a fresh journey.',
          'The offline-earnings modal survived a quit to the menu.',
        ],
      },
    ],
  },
  {
    version: '0.1.15',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          "Removed the high-pitched whine that played during an aurora. It was a pair of bare sine tones three octaves above the biome's root — consonant with the key, and still effectively a siren. Auroras are now visual-only.",
        ],
      },
    ],
  },
  {
    version: '0.1.14',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'The aurora no longer cuts off at a hard edge, and no longer pops as it crossfades between episodes.',
          'The world no longer runs out past the edge of the terrain ribbon. A distant land backdrop fills the horizon, so grazing sight lines find ground instead of sky — the "floating trees" report.',
        ],
      },
    ],
  },
  {
    version: '0.1.13',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Shadows are anchored to the things casting them. A shadow bias measured in metres rather than texels had been displacing every shadow lookup by 2.2 m, walking shadows clean off their casters.',
          'Shadows no longer stretch to the horizon around dawn and sunset.',
          'Trees, rocks and props sit on the ground as drawn instead of hovering above or sinking into it, and lean with the slope they stand on.',
        ],
      },
    ],
  },
  {
    version: '0.1.12',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Wheels roll about their axle instead of flailing in the wheel well. They had been castoring flat since the first build.',
        ],
      },
    ],
  },
  {
    version: '0.1.11',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: [
          'The starter car, the Rusty Hatch, is now a handcrafted model — repainted faded beige, and 47% lighter than the procedural one it replaces.',
        ],
      },
    ],
  },
  {
    version: '0.1.10',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: [
          'A Blender-to-bundle pipeline for handcrafted models. Procedural generation stays the default for every asset; a handcrafted model exists only where one was asked for. Nothing is fetched at runtime.',
        ],
      },
    ],
  },
  {
    version: '0.1.9',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Work now reaches the main branch only through a CI-green pull request, behind six checks: formatting, types, tests on Node 20 and 22, build and bundle budget, and a dependency audit.',
        ],
      },
    ],
  },
  {
    version: '0.1.8',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'A non-finite combo multiplier could permanently poison your coin totals.',
          'Offline earnings returned nonsense when the stored save time was not a number.',
          'Ten further backlog defects across the world, economy, save and UI.',
        ],
      },
    ],
  },
  {
    version: '0.1.7',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Nineteen defects found in a full audit of the world, economy, save system and UI.',
        ],
      },
    ],
  },
  {
    version: '0.1.6',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Changed',
        items: [
          'The HUD odometer now reads as journey miles, so it cannot be mistaken for the lifetime total.',
        ],
      },
    ],
  },
  {
    version: '0.1.5',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          "Speed is capped at the car's stated limit. Holding W tops out where the spec sheet says it should, and autopilot cruises at 94% of it.",
          'Removed the pitched engine hum. The noise-only rumble bed stays.',
        ],
      },
    ],
  },
  {
    version: '0.1.4',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Steering was inverted.',
          'The camera orbited instead of turning with the car.',
          'The terrain was wound inside out after an axis flip.',
          'Removed the idle camera sway.',
        ],
      },
    ],
  },
  {
    version: '0.1.3',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: [
          "Coin pickups play a run up the scale — major, minor or lydian, in the biome's key.",
        ],
      },
    ],
  },
  {
    version: '0.1.2',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: ['Autopilot holds the right lane.'],
      },
      {
        heading: 'Fixed',
        items: ['The combo meter and the coin magnet no longer tick over while the game is idle.'],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Road dash markings bled into one another.',
          'The game ran in slow motion after the tab lost focus.',
        ],
      },
      {
        heading: 'Changed',
        items: ['Art tuning: saturation, shadows and tree placement.'],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Added',
        items: [
          '**The first playable build of Everroad.** A procedurally generated country highway that scrolls forever through painted biomes: driving, the road, chunk streaming, biomes, sky and day/night, weather, scenery and pickups.',
          'Economy, upgrades, the car catalog, prestige and achievements.',
          'A generative audio engine, the HUD and panel overlay, and a save system that keeps earning while you are away.',
        ],
      },
    ],
  },
];
