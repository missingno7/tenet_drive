import { PHYSICS } from './config.js';
import { TrackManager } from './track.js';
import { RunManager } from './run.js';
import { InputController } from './input.js';
import { WorldRenderer } from './render.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';

const track = new TrackManager(), run = new RunManager(track), audio = new GameAudio();
let renderer, hud, input, debug = false, accumulator = 0;
const clear = () => { input?.clear(); accumulator = 0; };
const actions = {
  start() { clear(); run.start(); hud.helpOpen = false; renderer.chase.reset(); },
  restart() { clear(); hud.helpOpen = false; run.restart(); renderer.chase.reset(); },
  advance() { clear(); run.advance(); renderer.chase.reset(); },
  pause() { if (run.status === 'intro') { actions.help(); return; } clear(); hud.helpOpen = false; run.paused = !run.paused; },
  help() { clear(); hud.helpOpen = true; run.paused = true; },
  resume() { clear(); hud.helpOpen = false; run.paused = false; },
  newTimeline() { clear(); hud.helpOpen = false; run.newTimeline(); renderer.chase.reset(); },
  debug() { debug = !debug; renderer.setDebug(debug); },
  async sound() { const enabled = await audio.toggle(); const el = document.getElementById('sound'); el.textContent = enabled ? 'SOUND ON' : 'SOUND OFF'; el.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound'); },
};
try {
  renderer = new WorldRenderer(document.getElementById('game'), track);
  hud = new HUD(track, actions);
  input = new InputController(code => {
    if (code === 'KeyR') actions.restart();
    if (code === 'Escape' || code === 'KeyP') hud.helpOpen ? actions.resume() : actions.pause();
    if (code === 'F3') actions.debug();
    if (code === 'KeyM') actions.sound();
    // Enter on a focused button is handled natively, avoiding a second activation.
    if (code === 'Enter' && document.activeElement?.tagName !== 'BUTTON') {
      if (run.status === 'intro') actions.start(); else if (run.status === 'transition') actions.advance(); else if (run.paused) actions.resume();
    }
  });
  window.addEventListener('blur', () => { if (run.status !== 'intro') { run.paused = true; clear(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && run.status !== 'intro') { run.paused = true; clear(); } });
  document.getElementById('game').addEventListener('webglcontextlost', event => { event.preventDefault(); run.paused = true; hud.showNotice('GRAPHICS INTERRUPTED / RELOAD TO RESUME', 60); });
  let previousTime = performance.now(), hudTime = 0, previousRun = run.runNumber, fps = 60;
  function frame(now) {
    const realDt = Math.max(0.0001, (now - previousTime) / 1000); previousTime = now;
    const dt = Math.min(PHYSICS.maxFrameTime, realDt); fps += (1 / realDt - fps) * 0.03;
    accumulator += dt;
    const controls = input.read();
    while (accumulator + 1e-10 >= PHYSICS.dt) { run.step(controls); accumulator -= PHYSICS.dt; }
    if (previousRun !== run.runNumber) { previousRun = run.runNumber; renderer.chase.reset(); input.clear(); }
    renderer.render(run, Math.max(0, accumulator / PHYSICS.dt), dt, now / 1000);
    audio.update(run);
    hudTime += dt;
    if (hudTime >= 1 / 30) { hud.update(run, hudTime, debug, fps); hudTime = 0; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Read-only inspection for reproducible manual QA; gameplay mutations remain in the UI.
  window.tenetDrive = Object.freeze({ snapshot: () => ({ status: run.status, paused: run.paused, direction: run.direction, run: run.runNumber, time: run.elapsed, score: run.scoring.score, position: { ...run.player.position }, speed: run.player.speed, echoTime: run.echo ? Math.max(0, run.echo.replay.duration - run.elapsed) : null, samples: run.recorder.frames.length, historySamples: run.history?.frames.length ?? 0 }) });
} catch (error) {
  console.error(error);
  const modal = document.getElementById('modal');
  modal.innerHTML = '<div class="eyebrow">GRAPHICS UNAVAILABLE</div><h2>THE ENGINE COULD NOT START.</h2><p>Tenet Drive needs WebGL 2. Enable hardware acceleration in a current browser, then reload.</p><button class="primary" id="reload">TRY AGAIN ↗</button>';
  document.getElementById('reload').onclick = () => location.reload();
}
