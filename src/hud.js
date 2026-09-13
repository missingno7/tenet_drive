import { VEHICLE, clamp } from './config.js';
export const formatTime = time => `${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')}`;
const gapText = gap => Number.isFinite(gap) ? gap.toFixed(2) + ' m' : '—';
export class HUD {
  constructor(track, actions) {
    this.track = track; this.actions = actions;
    this.elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(e => [e.id, e]));
    this.introMarkup = this.elements.modal.innerHTML; this.overlayKey = 'intro'; this.noticeTime = 0; this.helpOpen = false;
    this.elements.start.onclick = actions.start;
    this.elements.restart.onclick = actions.restart; this.elements.pause.onclick = actions.pause;
    this.elements.help.onclick = actions.help; this.elements.sound.onclick = actions.sound; this.elements['debug-toggle'].onclick = actions.debug;
    this.map = this.elements.map.getContext('2d');
    this.mapBase = document.createElement('canvas'); this.mapBase.width = 300; this.mapBase.height = 220;
    this.buildMap();
  }
  xy(position) { return [125 + position.x * 1.7, 204 - position.z * 0.305]; }
  buildMap() {
    const ctx = this.mapBase.getContext('2d'); ctx.clearRect(0, 0, 300, 220);
    ctx.lineCap = 'round';
    for (let z = 0; z < 620; z += 3) for (const lane of this.track.lanes(z)) {
      const [x, y] = this.xy({ x: lane.center, z });
      ctx.strokeStyle = '#778e9450'; ctx.lineWidth = lane.width * 1.3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 1.2); ctx.stroke();
      ctx.fillStyle = '#a0b0af'; ctx.fillRect(x - 0.65, y, 1.3, 1.4);
    }
    for (const [z, name] of [[12, 'A'], [608, 'B']]) {
      const [x, y] = this.xy({ x: this.track.center(z), z }); ctx.fillStyle = '#dff58a'; ctx.font = 'bold 15px Arial'; ctx.fillText(name, x + 22, y + 5);
    }
  }
  showNotice(text, duration = 2.1) { this.elements.notice.textContent = text; this.noticeTime = duration; }
  update(run, dt, debug, fps) {
    const el = this.elements, scoring = run.scoring;
    el['run-number'].textContent = String(run.runNumber).padStart(2, '0');
    el.direction.innerHTML = run.direction > 0 ? 'A <i>→</i> B' : 'B <i>→</i> A';
    el['run-label'].textContent = run.history ? 'HISTORY IS SOLID' : 'ESTABLISH HISTORY';
    el['record-light'].textContent = run.status === 'playing' && !run.paused ? '● REC' : '○ HOLD';
    el.time.textContent = formatTime(run.elapsed); el.score.textContent = Math.floor(scoring.score).toLocaleString();
    el.speed.textContent = Math.round(run.player.speed * 3.6).toString().padStart(3, '0');
    el['speed-fill'].style.width = `${clamp(run.player.speed / VEHICLE.maxSpeed * 100, 0, 100)}%`;
    el.surface.textContent = !run.player.grounded ? 'AIRBORNE' : run.player.drifting ? 'SLIDING' : this.track.section(run.player.position.z);
    el.distance.textContent = Number.isFinite(scoring.gap) && scoring.gap < 100 ? scoring.gap.toFixed(2) : '—';
    el.multiplier.textContent = `×${scoring.multiplier}`;
    el['proximity-fill'].style.width = `${clamp((5 - scoring.gap) / 5 * 100, 0, 100)}%`;
    el['echo-status'].textContent = !run.echo ? 'NO HISTORY' : !run.echoState ? 'ECHO ENDED' : scoring.cooldown > 0 ? 'CONTACT' : 'SOLID';
    el['echo-hint'].textContent = !run.echo ? 'Complete a run to create your first echo.' : !run.echoState ? 'History has ended. Bring this run home.' : scoring.cooldown > 0 ? 'Contact breaks the chain. Find some space.' : scoring.multiplier ? `Close for ${scoring.sustain.toFixed(1)} s · keep the chain alive.` : 'Get within 5 m. Stay close. Leave a gap.';
    el['echo-panel'].classList.toggle('hot', scoring.multiplier >= 8);
    el['progress-fill'].style.width = `${(run.direction > 0 ? run.progress : 1 - run.progress) * 100}%`;
    el['progress-start'].textContent = run.direction > 0 ? 'A' : 'B'; el['progress-end'].textContent = run.direction > 0 ? 'B' : 'A';
    if (run.notice) { this.showNotice(run.notice); run.notice = null; }
    this.noticeTime = Math.max(0, this.noticeTime - dt); el.notice.style.opacity = this.noticeTime > 0 ? '1' : '0';
    el['debug-panel'].hidden = !debug;
    if (debug) el['debug-text'].textContent = `${Math.round(fps)} FPS · PHYSICS 120 HZ\nLIVE       ${run.elapsed.toFixed(3)} s\nREVERSE    ${Math.max(0, (run.echo?.replay.duration ?? 0) - run.elapsed).toFixed(3)} s\nSAMPLES    ${run.recorder.frames.length}\nHISTORY    ${run.echo?.replay.frames.length ?? 0}\nCHECKPOINT ${run.checkpoints.next}/${run.checkpoints.targets.length}\nCLEARANCE  ${gapText(scoring.gap)}\nBEST GAP   ${gapText(scoring.bestGap)}\nIMPACT     ${run.impact.toFixed(1)} m/s`;
    this.map.clearRect(0, 0, 300, 220); this.map.drawImage(this.mapBase, 0, 0);
    for (const [state, color] of [[run.echoState, '#f39ddd'], [run.player, '#dff58a']]) if (state) {
      const [x, y] = this.xy(state.position); this.map.fillStyle = color; this.map.strokeStyle = '#10212b'; this.map.lineWidth = 2; this.map.beginPath(); this.map.arc(x, y, 4.5, 0, Math.PI * 2); this.map.fill(); this.map.stroke();
    }
    this.updateOverlay(run);
  }
  updateOverlay(run) {
    const key = this.helpOpen ? 'help' : run.paused ? 'paused' : run.status === 'failed' ? 'playing' : run.status;
    const el = this.elements;
    if (key !== this.overlayKey) {
      this.overlayKey = key; el.overlay.hidden = key === 'playing';
      if (key === 'intro') { el.modal.innerHTML = this.introMarkup; document.getElementById('start').onclick = this.actions.start; }
      if (key === 'transition') {
        const result = run.lastResult;
        el.modal.innerHTML = `<div class="eyebrow">RUN ${String(result.runNumber).padStart(2, '0')} / COMPLETE</div><h2>TIMELINE <span style="color:var(--lime)">SEALED.</span></h2><p>Your route is now solid history. The next run starts beside your reversed echo.</p><div class="results"><div><label>RUN TIME</label><b>${formatTime(result.time)}</b></div><div><label>PROXIMITY SCORE</label><b>${result.score.toLocaleString()}</b></div><div><label>BEST CLEAN CLEARANCE</label><b>${gapText(result.bestGap)}</b></div><div><label>MAX MULTIPLIER</label><b>×${result.maxMultiplier}</b></div></div><button class="primary" id="continue">NEXT: ${run.direction > 0 ? 'B → A' : 'A → B'}<span id="countdown"></span></button><small>Only successful runs become history.</small>`;
        document.getElementById('continue').onclick = this.actions.advance;
      }
      if (key === 'paused' || key === 'help') {
        el.modal.innerHTML = `<div class="eyebrow">TENET DRIVE / ${key === 'help' ? 'FIELD GUIDE' : 'TIME SUSPENDED'}</div><h2>${key === 'help' ? 'KNOW YOUR TIMELINE.' : 'TAKE A BREATHER.'}</h2><p>Finish to reverse direction. Your last drive plays backwards beside you, with the car still facing its original way. It cannot be pushed. Clean, sustained proximity earns the most.</p><div class="help-list"><span><kbd>W / ↑</kbd> Accelerate</span><span><kbd>S / ↓</kbd> Brake / reverse</span><span><kbd>A D / ← →</kbd> Steer</span><span><kbd>SPACE</kbd> Handbrake</span><span><kbd>R</kbd> Retry current run</span><span><kbd>ESC / P</kbd> Pause</span><span><kbd>F3</kbd> Debug overlay</span><span><kbd>M</kbd> Toggle sound</span></div><p style="font-size:12px">Gamepad: left stick to steer, RT to drive, LT to brake, A to drift. Take either split lane. The striped ramp launches in both directions. Retry keeps the last valid echo.</p><button class="primary" id="resume">${run.status === 'intro' ? 'BACK TO START' : 'RESUME TIMELINE'} <span>↗</span></button><button class="secondary" id="new-timeline">RESET TO RUN 01 · CLEAR HISTORY</button>`;
        document.getElementById('resume').onclick = this.actions.resume;
        document.getElementById('new-timeline').onclick = this.actions.newTimeline;
      }
      if (!el.overlay.hidden) el.modal.querySelector('button')?.focus({ preventScroll: true });
    }
    const countdown = document.getElementById('countdown'); if (key === 'transition' && countdown) countdown.textContent = `${Math.max(0, run.transitionTime).toFixed(1)}s`;
  }
}
