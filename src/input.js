export class InputController {
  constructor(onAction) {
    this.keys = new Set(); this.touch = new Set();
    window.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3'].includes(event.code)) event.preventDefault();
      if (!event.repeat && ['KeyR', 'Escape', 'KeyP', 'F3', 'KeyM', 'Enter'].includes(event.code)) onAction(event.code);
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.clear());
    for (const button of document.querySelectorAll('[data-control]')) {
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.touch.add(button.dataset.control); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => this.touch.delete(button.dataset.control));
    }
  }
  clear() { this.keys.clear(); this.touch.clear(); }
  read() {
    const key = (...codes) => codes.some(c => this.keys.has(c));
    let throttle = key('KeyW', 'ArrowUp') || this.touch.has('throttle') ? 1 : 0;
    let brake = key('KeyS', 'ArrowDown') || this.touch.has('brake') ? 1 : 0;
    let steer = (key('KeyA', 'ArrowLeft') || this.touch.has('left') ? 1 : 0) - (key('KeyD', 'ArrowRight') || this.touch.has('right') ? 1 : 0);
    let handbrake = key('Space');
    const pad = navigator.getGamepads?.()?.[0];
    if (pad) {
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0); brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      if (Math.abs(pad.axes[0]) > 0.12) steer = -pad.axes[0];
      handbrake ||= !!pad.buttons[0]?.pressed;
    }
    return { throttle, brake, steer, handbrake };
  }
}
