# Tenet Drive

A playable 3D arcade driving prototype. Complete the 620 m causeway, reverse direction, and drive beside an infinitely heavy recording of your previous run. Close, sustained passes earn points. Colliding changes the live car; history never yields.

## Run

Requires Node.js 20+ and a browser supporting WebGL 2 and WebAssembly.

```sh
npm install
npm start
```

Open **http://127.0.0.1:5173**. `pnpm install` / `pnpm start` also work; the pnpm lockfile pins dependencies. Runtime packages are Three.js 0.180.0 and Rapier 0.17.3.

On Windows, after installation, double-click **Launch Tenet Drive.cmd**. It starts the local server and opens the game in your default browser. Keep its terminal open while playing; Ctrl+C stops the server. The launcher also recognizes Codex's bundled Node runtime on this machine.

```sh
npm test                         # physics, replay, geometry and audio checks
npm run build                    # self-contained dist/ directory
node scripts/serve.mjs --dist     # serve the build without node_modules
```

Serve `dist/` at the root of a static HTTP host. Opening `index.html` with `file://` will not work with ES modules. The development server binds only to loopback. Set `PORT` to choose a different port. Fonts optionally load from Google Fonts; fallbacks work offline. Game code and assets are local. The build includes dependency license notices.

## Controls

| Action | Keyboard | Standard gamepad |
| --- | --- | --- |
| Accelerate | W / Up | RT |
| Brake, then reverse | S / Down | LT |
| Steer | A D / Left Right | Left stick |
| Handbrake / drift | Space | A |
| Retry current direction | R | On-screen button |
| Pause / resume | Esc / P | On-screen button |
| Toggle telemetry | F3 | On-screen button |
| Toggle sound | M | On-screen button |

Touch controls appear on devices with a coarse pointer. Sound is opt-in. Changing tabs or losing focus pauses the simulation. The controls menu includes **clear history** to begin a new timeline.

## The loop

1. Run 01 goes A to B without an echo. Pass the six ordered checkpoints and finish gate.
2. Only a completed run becomes stored history. Results show time, proximity score, best clean clearance and maximum multiplier.
3. After 2.5 seconds, or immediately with Next / R, start B to A alongside the exact reverse recording.
4. Completing the return replaces history and starts A to B again. There is one active echo.
5. Falling reaches the actual river or terrain. Water produces a splash and visible sinking; land produces an impact, sparks and smoke. After 2.2 seconds the current direction restarts, preserving successful history. R retries immediately.
6. Becoming stuck, leaving world bounds, or exceeding 180 seconds also fails the attempt, with a 1.1-second retry. A stationary overturned car triggers the crash sequence.

The road includes open stretches, a 6.8 m choke, two split lanes around a void, a symmetric launch ramp and a finishing straight. The speed ceiling is **360 km/h** (100 m/s), configurable in `src/config.js`; brake early for bends and narrow sections.

The closed concrete deck casts shadows and has solid top, side and underside surfaces. Bollards and bridge supports are solid. Signs have supports and readable faces in both directions. Rolling riverbanks, 480 instanced trees, shoreline rocks and 34 windowed towers are generated locally.

With sound enabled, the echo plays a synthesized engine/tire track derived from its recorded speeds and steering, with the actual audio samples reversed. Distance controls loudness and stereo position follows the car. Pausing or retrying resynchronizes playback. Collisions, land crashes and water impacts have sound effects.

### Reverse-time direction

The authoritative rule is:

```text
echo(t) = previousRun(T - t)
```

For a previous A-to-B run, reverse playback starts at B and moves toward A. The returning player also starts at B and moves toward A. Both travel toward the same destination, while the echo retains its original orientation and appears to drive backwards. Differences in pace and line create catches, overtakes and crossings. An oncoming echo would require a different rule.

The live car starts laterally clear of the recorded endpoint. The echo's position and timing are never offset. After its recorded duration, the echo expires.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/physics.js`, `src/rapier.js` | Rapier rigid bodies, CCD, solid world geometry, contact impulses and water detection |
| `src/vehicle.js` | Arcade acceleration, braking, grip and steering; full quaternion state |
| `src/track.js`, `src/surfaces.js` | Shared road/terrain meshes, exposed boundaries, prop placement and checkpoints |
| `src/run.js` | Run lifecycle, impact/sinking sequence, retry and success-only history replacement |
| `src/replay.js` | Immutable state recording, interpolation and kinematic reverse playback |
| `src/collision.js`, `src/scoring.js` | Full 3D surface clearance and proximity rewards |
| `src/render.js`, `src/world-geometry.js`, `src/scenery.js` | Cars, camera, closed road, terrain, vegetation and city |
| `src/impact-effects.js` | Splash, ripples, impact particles, smoke and light flash |
| `src/audio.js`, `src/audio-synthesis.js` | Live engine, reversed PCM track and impact audio |
| `src/input.js`, `src/hud.js`, `src/main.js` | Controls, interface and fixed-step orchestration |
| `src/config.js` | Physics, vehicle, scoring and lifecycle tuning |

### Physics and recording

The game records at **120 Hz**, with four fixed physics substeps per tick (**480 Hz**). Rapier owns gravity, translation, full rotation and contact response. Continuous collision detection handles fast movement. The live car uses a rounded box collider to avoid catching sharp chassis corners at triangle seams. Wheel-position rays enable arcade traction near the road; they do not hold the car upright. Support, tipping, tumbling, side impacts and underside impacts are solved by rigid-body contacts.

Road rendering and physics share slab vertices. Adjacent collision vertices are welded, internal end caps are omitted, and Rapier corrects internal triangle edges. The terrain collider uses the exact rendered triangle mesh. Water detection samples that mesh to distinguish submerged riverbed from land.

The echo is a kinematic rounded box matching the live collider. Each substep sets its next position and quaternion from the authoritative reverse sample. Collision impulses affect the live car only. Scoring measures the same shapes in full 3D, including pitch and roll.

At every complete tick, the recorder copies position, quaternion, linear velocity and angular velocity. An initial frame is recorded at time zero. Timestamps come from integer tick indices. Successful runs finalize deeply frozen recordings; samples use binary search, vector interpolation and shortest-arc quaternion slerp. Reverse playback samples T minus t and negates velocities. No input resimulation is used.

Rendering interpolates the live pose and samples the echo at fractional simulation time. Stalls are capped at 100 ms to bound catch-up work; very slow rendering slows wall-clock progression without changing recorded tick spacing.

### Scoring

Configure `SCORING` in `src/config.js`.

| Surface clearance | Multiplier |
| --- | --- |
| 2-5 m | x1 |
| 1-2 m | x2 |
| 0.5-1 m | x4 |
| 0.25-0.5 m | x8 |
| Under 0.25 m, without contact | x16 |

Points per second equal base rate times proximity multiplier times speed factor times sustained-proximity factor. Live and relative speeds increase value; sustained proximity builds up to x4. Parking earns nothing. Contact resets the chain, awards no points that step, and imposes a 0.55-second cooldown.

## Verification

`npm test` covers immutable reverse replay, render-independent samples, 3D clearance, scoring, road and prop geometry, edge tipping in both directions, stable edge support, road fascia and underside collisions, bollards at 360 km/h, exact kinematic echo motion during impacts, terrain landings, water sinking and retry, crash pause behavior, four alternating completed runs through both branches and jumps, and deterministic reverse/impact audio.

F3 displays the recorded path, collider bounds, track boundaries, clearance, time, samples, checkpoints, impact speed and FPS. `window.tenetDrive.snapshot()` is a read-only browser inspection helper.

## Prototype limitations

- Traction and steering are arcade controls on a rigid chassis. Wheels are visual; there is no tire/suspension simulation or vehicle deformation.
- Road edges are intentionally open. Solid bollards can be hit but are not continuous barriers. Trees, rocks, buildings and sign panels remain decorative.
- Water uses surface detection and a short sinking animation, without buoyancy or fluid simulation. Explosions are visual effects, not physical debris.
- The course is procedurally described as longitudinal road strips; stacked roads and loops need additional track authoring.
- Runs and scores live in memory. Reloading clears history. There is no replay export, persistence or online service.
- Human playtesting is still needed for grip, difficulty and scoring balance. Keyboard is the primary validated input; this is a desktop-first prototype.
