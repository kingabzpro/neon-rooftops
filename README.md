# Neon Rooftops 🐱🌙

A tiny, original, browser-based endless runner — an adventurous cat sprinting
across neon-lit rooftops at night. Runs as a plain web page **and** as a
standalone Windows desktop app.

![screenshot](docs/screenshot.png)

## Download & play (no install)

1. Go to [**Releases**](../../releases/latest)
2. Download `NeonRooftops-<version>-win-x64.zip`
3. Unzip it
4. Double-click **`Neon Rooftops.exe`**

That's it — the app bundles its own embedded Chromium, so nothing else is
installed and no browser window is opened. (The exe is unsigned, so Windows
SmartScreen may ask "More info → Run anyway" the first time.)

Prefer the browser? Open `game/index.html` directly, or run a local server:

```
cd game && npx serve
```

## Controls

| Key | Action |
|-----|--------|
| `Space` / `↑` | Start · jump (hold = higher, release early = shorter hop) |
| `↓` | Mid-air dive |
| `Space` / `Enter` / tap | Restart after crashing |

## Gameplay

- Endless automatic running, score in the top-right (`HI` = personal best)
- Difficulty ramps up: speed accelerates from 6 to 13, gaps widen with speed
- Hurdles: small/large chimney stacks (1–3 clusters), satellite dishes,
  wide AC units, and hovering drones that only appear once you're fast enough
- Two-phase collision boxes (like the Chrome dino): grazing pixels won't kill you
- Milestone flash + sound-free celebration every 100 points

## How the mechanics were designed

The tuning constants and core formulas (gravity-integrator jump with
speed-scaled velocity, `width × speed + minGap × coefficient` obstacle gaps,
`distance × 0.025` scoring, speed-gated obstacle types) were recovered by
reverse-engineering the shipped Chrome offline game embedded in
`resources.pak` of a local Chrome installation — then re-implemented from
scratch with original art and code. No Chromium assets are used or included
in this repository.

## Repository layout

```
game/        the game itself — index.html + game.js (zero dependencies)
desktop/     Electron wrapper + build script (electron-packager)
docs/        screenshot
```

## Development

```
# run the game's self-test (9 groups: physics, gaps, collision, spawns, restart)
node game/game.js

# run in Electron dev mode
cd desktop && npm install && npm start

# build the standalone Windows app
cd desktop && npm run build
# -> desktop/dist/Neon Rooftops-win32-x64/Neon Rooftops.exe
```

Releases are built automatically by GitHub Actions (`.github/workflows/release.yml`)
whenever a `v*` tag is pushed.

## License

[MIT](LICENSE) — the game code and pixel art in this repository are original.
"Neon Rooftops" is not affiliated with Google or the Chrome team.
