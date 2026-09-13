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
5. Every solid contact is resolved by the physics engine. Gentle landings and brief splashes are recoverable. Severe impacts wreck the car; sustained deep submersion stalls the engine. Wrecks continue simulating for 2.2 seconds before retrying, preserving successful history. R retries immediately.
6. Becoming stuck, leaving world bounds, or exceeding 180 seconds also fails the attempt, with a 1.1-second retry. A stationary overturned car triggers the crash sequence.

The road includes open stretches, a 6.8 m choke, two split lanes around a void, a symmetric launch ramp and a finishing straight. The speed ceiling is **360 km/h** (100 m/s), configurable in `src/config.js`; brake early for bends and narrow sections.

The closed concrete deck casts shadows and has solid top, side and underside surfaces. Bollards, bridge pillars and footings, sign posts and panels, gates, building bodies, rocks and tree trunks are solid. Structural meshes and colliders use the same dimensions and placements. Signs have supports and readable faces in both directions. Rolling riverbanks, 480 instanced trees, shoreline rocks and 34 windowed towers are generated locally.

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
| `src/physics.js`, `src/rapier.js` | Rapier chassis, suspension/tire controller, CCD, solid contacts and breakaway parts |
| `src/water.js` | Fluid volume, distributed buoyancy and drag, current submersion |
| `src/infrastructure.js`, `src/scenery-layout.js`, `src/car-parts.js` | Shared object definitions for visible geometry and solid bodies |
| `src/vehicle.js` | Full quaternion vehicle state and coordinate transforms |
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

The game records at **120 Hz**, with two fixed physics substeps per tick (**240 Hz**). Rapier owns gravity, position, full rotation and contact response. Its raycast vehicle controller applies four suspension springs, tire grip, steering and engine/braking forces. Driving input never directly assigns the chassis velocity or yaw. A low center of mass and damped springs provide stability; losing tire support lets the chassis contact the edge, slide, tip or fall according to the forces involved. Rounded chassis surfaces and solid tire sidewalls prevent sharp-corner catches and protect the car when wheel rays miss the road.

Hard contact impulses can break the hood, bumpers, spoiler and roof off. Detached parts are separate CCD-enabled rigid bodies with their own mass, velocity, rotation, solid contacts and water forces. Release preserves incoming part momentum with a balancing chassis impulse. Brief self-collision grace allows adjoining meshes to separate; debris always collides with the environment. Reset removes debris and restores attachments. Thresholds and part definitions live in `src/car-parts.js`.

Water is a volume between the submerged terrain and river surface. Each physics step samples the car's current immersed volume and applies distributed buoyancy and drag. Forces stop when it leaves the water. Colliders, gravity and solid contacts remain active, including against banks, the riverbed and underwater pillars. A splash only creates audiovisual feedback; retry requires sustained deep submersion or a severe physical impact.

Road rendering and physics share slab vertices. Adjacent collision vertices are welded, internal end caps are omitted, and Rapier corrects internal triangle edges. The terrain collider uses the exact rendered triangle mesh. Water detection samples that mesh to distinguish submerged riverbed from land.

The echo retains a kinematic rounded-box body envelope. Each substep sets its position and quaternion from the authoritative reverse sample. Collision impulses affect the live car only. Proximity scoring uses rounded body envelopes in full 3D, including pitch and roll; it does not reward gaps opened by missing panels.

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

`npm test` covers immutable reverse replay, render-independent samples, 3D clearance, scoring, road and prop geometry, edge tipping in both directions, stable edge support, road fascia and underside collisions, bollards at 360 km/h, exact kinematic echo motion during impacts, terrain landings, water sinking and retry, crash pause behavior, four alternating completed runs through both branches and jumps, and deterministic reverse/impact audio. Additional regressions cover gentle edge brushing, partial overhang, airborne controls, solid pillars above/below water, escaping water, shore landings, breakaway-part mass and debris reset.

F3 displays the recorded path, collider bounds, track boundaries, clearance, time, samples, checkpoints, impact speed and FPS. `window.tenetDrive.snapshot()` is a read-only browser inspection helper.

## Prototype limitations

- The vehicle uses Rapier raycast suspension and tires with a compound rigid chassis. It has detachable panels, but no continuously deformable bodywork or detailed tire model.
- Road edges are intentionally open. Bollards are obstacles, not continuous barriers. Tree foliage, tower antennae and the orange ramp guide rings remain decorative.
- Water uses sampled buoyancy and drag, without waves or a fluid solver. Spark/smoke effects are decorative; detached car parts are physical.
- The course is procedurally described as longitudinal road strips; stacked roads and loops need additional track authoring.
- The echo records chassis trajectories, not detached debris or individual panel states. Its collision envelope remains intact.
- Runs and scores live in memory. Reloading clears history. There is no replay export, persistence or online service.
- Human playtesting is still needed for grip, difficulty and scoring balance. Keyboard is the primary validated input; this is a desktop-first prototype.
