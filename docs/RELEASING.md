# Releasing Everroad

Everroad ships two ways from one bundle: as a web page you serve yourself, and
as an Electron-wrapped desktop app published to
[GitHub Releases](https://github.com/Troll-Phace/everroad/releases). This
document is the procedure for cutting one of those releases.

The whole thing rests on a **three-way agreement**: the git tag, `package.json`'s
`version`, and the newest `## [x.y.z]` heading in `CHANGELOG.md` all name the
same version. Every gate in this document exists to keep those three from
drifting, because a build that lies about its own version is a build whose bug
reports cannot be trusted.

Two gates, not one, and they cover different legs:

- **`npm run changelog:check`** proves the two legs that exist on disk — the
  changelog's newest entry matches `package.json`, and the generated module
  matches the changelog. It never looks at a git tag, so it cannot tell you
  that a tag is wrong. It runs in `npm run verify`, in CI, and again in the
  release workflow's `guard` job.
- **The `guard` job** in `.github/workflows/release.yml` checks the tag leg, in
  its *Resolve and verify the version* step: tag == `v$(package.json version)`.
  It also runs the full `npm run verify`. Both happen before the draft release
  is created and before any platform is packaged, so nothing is published by a
  run that failed either one.

See docs/ARCHITECTURE.md §16 for how the pieces fit together.

---

## Versioning

Everroad follows [Semantic Versioning](https://semver.org/). It is pre-1.0, and
that is a deliberate statement rather than an oversight: the save format is
still allowed to move. Until there is a considered 1.0, every shipped change is
a **patch bump** — `0.1.17` to `0.1.18` — and every release is marked as a
prerelease on GitHub. The release workflow does that automatically for any `0.x`
version, so there is nothing to remember.

## As you work

Add your notes to `CHANGELOG.md` under `## [Unreleased]` **in the same change
that ships the code**. Not at release time, and not from `git log` afterwards.
The notes are player-facing: they say what changed for someone driving the car,
not which module was refactored.

```markdown
## [Unreleased]

### Fixed

- Shadows are anchored to the things casting them.
```

Use the [Keep a Changelog](https://keepachangelog.com/) headings — `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. `**Bold**` survives
into the in-game What's New panel and is the way to name a feature; nothing else
in the Markdown is rendered, so avoid links, code spans and nested lists. A
nested list is a hard error, because the panel has no way to draw one.

## Cutting a release

Everything below happens on a branch, through a PR, like any other work item.

**1. Move the notes under a version heading.** Rename `## [Unreleased]` to the
new version with today's date, and open a fresh empty `## [Unreleased]` above
it:

```markdown
## [Unreleased]

## [0.1.18] - 2026-08-25

### Fixed

- Shadows are anchored to the things casting them.
```

Also update the `[Unreleased]` compare link at the foot of the file to point at
the new tag.

**2. Bump `package.json`.** Set `"version": "0.1.18"` by hand, or with
`npm version 0.1.18 --no-git-tag-version`. Do not let `npm version` create the
tag — the tag is pushed later, after CI has agreed with it.

**3. Regenerate the in-game notes.**

```bash
npm run changelog
```

This rewrites `src/version/changelog.generated.ts`, which is committed. It also
validates everything: semver, strictly descending versions, real ISO dates, and
that the newest entry matches `package.json`. If it complains, it is right.

**4. Verify.**

```bash
npm run verify
```

`verify` includes `changelog:check`, so a stale generated module or a version
mismatch fails here rather than in CI — or, worse, at tag time.

**5. Commit, PR, merge.**

```bash
git add CHANGELOG.md package.json src/version/changelog.generated.ts
git commit -m "chore(release): 0.1.18"
```

Open the PR, let CI go green, merge it to `main`.

**6. Tag `main` and push the tag.**

```bash
git switch main && git pull
git tag -a v0.1.18 -m "Everroad 0.1.18"
git push origin v0.1.18
```

The tag must be on the merge commit that carries the version bump. Tagging
anything else means the workflow builds a bundle whose `package.json` disagrees
with the tag, and it will refuse.

**7. Watch the workflow.**

```bash
gh run watch "$(gh run list --workflow=release.yml --limit=1 --json databaseId --jq '.[0].databaseId')"
```

It runs in three stages:

| Job | What it does |
|-----|--------------|
| `guard` | Runs `npm run verify`, re-checks the three-way agreement (including the tag), extracts the release notes from `CHANGELOG.md`, and creates the GitHub Release as a **draft** |
| `package` | A matrix over macOS, Windows and Linux — builds the bundle and uploads that platform's artifacts into the draft |
| `finalize` | Writes the notes, marks it a prerelease for `0.x`, and publishes the draft |

The draft is created up front on purpose: three concurrent `electron-builder`
runs would otherwise race to create the same release.

**8. Verify the assets.**

```bash
gh release view v0.1.18
```

These are the files a user downloads:

| Platform | Assets |
|----------|--------|
| macOS | `Everroad-0.1.18-mac-arm64.dmg`, `-mac-x64.dmg`, and a `.zip` of each |
| Windows | `Everroad-0.1.18-win-x64-setup.exe` (NSIS installer) and `-win-x64-portable.exe` |
| Linux | `Everroad-0.1.18-linux-x86_64.AppImage` and `Everroad-0.1.18-linux-x86_64.rpm` |

The two Windows names must stay distinct. Both targets emit an `.exe` for the
same os/arch, so they shared one filename under the global `artifactName` until
`nsis.artifactName` and `portable.artifactName` were set separately — the
second upload overwrote the first, then timed out and failed the v0.1.17
release outright. If you add a Windows target, give it its own name.

The release will list more assets than that. With `publish: github`,
electron-builder also emits update metadata — `latest.yml`, `latest-mac.yml`,
`latest-linux.yml` and a `.blockmap` beside several of the binaries — which
brings the total to somewhere around thirteen. Those are not user-facing and
their exact number moves with the target list; do not treat a count as the
check. Check that every row in the table above is present.

Download one and launch it. A release nobody opened is not a release.

---

## When the workflow fails midway

The release is a draft until `finalize` runs, so a failure part-way leaves an
unpublished draft rather than a broken public release. That is the design.

**`guard` failed.** Nothing was created. The message names the problem — a tag
that does not match `package.json`, or a changelog that does not match either.
Delete the tag, fix the mismatch on a branch, merge, and re-tag:

```bash
git push --delete origin v0.1.18
git tag -d v0.1.18
```

**One platform in `package` failed.** `fail-fast` is off, so the others
finished and their assets are in the draft. Re-run just the failed job from the
Actions UI, or `gh run rerun <id> --failed`. `electron-builder` overwrites an
asset of the same name, so a re-run is safe.

**`finalize` failed.** The assets are all uploaded and the draft is complete;
only publishing did not happen. Finish it by hand:

```bash
node scripts/release-notes.mjs 0.1.18 > /tmp/notes.md
gh release edit v0.1.18 --draft=false --prerelease --notes-file /tmp/notes.md
```

**You need to abandon the release entirely.** Delete the draft and the tag, then
start over. A version number that never shipped costs nothing; a published
release that has to be pulled costs trust.

```bash
gh release delete v0.1.18 --yes
git push --delete origin v0.1.18
```

**Never re-tag a version that has already been published.** Bump to the next
patch instead. Someone has already downloaded the old one. `guard` enforces
this: if the release for the resolved tag already exists and is *not* a draft,
the job fails rather than editing it.

---

## Releasing by hand (`workflow_dispatch`)

The release workflow also has a `workflow_dispatch` trigger. It exists as an
escape hatch — a tag push that did not reach GitHub, a `guard` failure fixed on
a branch and worth re-running before re-tagging — and it is **not a second way
to release.**

Understand what it does before using it:

- **It publishes from whatever ref you dispatch it on**, including a feature
  branch. Whatever is in that ref's `dist/` build becomes a public release.
- **There is no tag to check against**, so the tag leg of the three-way
  agreement is simply absent. `guard` takes the ref's `package.json` version as
  authoritative and names the release `v<that version>`. If the ref's version
  disagrees with what is on `main`, nothing will notice.
- `changelog:check` and `npm run verify` still run, so the code is still gated;
  only the *identity* of the release is unverified.
- If a published release with that version already exists, `guard` fails — a
  manual run cannot overwrite a published release either.

The tag flow above is the supported path. Reach for the manual trigger
knowingly, from `main`, and check `gh release view` before you publish.

---

## Unsigned builds: what a user sees

Everroad has no Apple Developer certificate and no Windows code-signing
certificate. The builds are therefore unsigned, and both desktop platforms treat
an unsigned app from the internet as suspicious. This is expected, it is not a
bug in the build, and it needs saying plainly on the download page.

**macOS.** The `.app` carries a quarantine flag after download. Gatekeeper
refuses the first launch with *"Everroad" cannot be opened because the developer
cannot be verified* — or, on recent macOS, the more alarming and quite
misleading *"Everroad" is damaged and can't be opened*. The app is not damaged;
it is unsigned. The user opens it once via **right-click → Open → Open**, or
clears the flag directly:

```bash
xattr -dr com.apple.quarantine /Applications/Everroad.app
```

After the first successful open, macOS remembers and launches it normally.

**Windows.** SmartScreen shows *Windows protected your PC* on the installer.
The user clicks **More info → Run anyway**. The warning fades as the download
count grows, but for a new release it will always appear at first.

**Linux.** The AppImage needs the executable bit, which some browsers strip:

```bash
chmod +x Everroad-0.1.18-linux-x86_64.AppImage
./Everroad-0.1.18-linux-x86_64.AppImage
```

On Fedora or RHEL, install the RPM instead:

```bash
sudo dnf install ./Everroad-0.1.18-linux-x86_64.rpm
```

The RPM is unsigned, so `dnf` will ask to confirm an untrusted package. Building
it needs `rpmbuild` on the runner, which the release workflow installs on the
Linux job; `linux.maintainer` in electron-builder.yml is required for rpm and
deb, and is a GitHub noreply address rather than a personal one because it goes
into public package metadata.

No signing gate on Linux.

Signing macOS costs an Apple Developer membership plus a notarisation step in
the workflow; signing Windows costs an EV certificate. Both are worth revisiting
at 1.0. Until then, the honest thing is to document the warnings rather than
pretend they do not happen.

---

## Building locally

You do not need a tag, a token, or the workflow to produce a desktop build.

```bash
npm run electron:dir     # unpacked app in release/<platform>/ — fastest check
npm run electron:build   # real installers in release/, publishes nothing
npm run electron         # run the built dist/ in the Electron shell
```

`electron:build` uses `--publish never`, so it cannot touch GitHub by accident.
Each of these only ever produces artifacts for the machine you are on:
cross-compiling desktop apps is the workflow's job, which is why the workflow
has a three-OS matrix rather than one Linux runner.

`npm run dev` is unchanged and unaffected by any of this. Browser development
is still the primary workflow — see docs/ARCHITECTURE.md §16.
