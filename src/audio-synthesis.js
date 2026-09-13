/** Synthesize an authoritative engine track, then reverse its actual PCM samples. */
export function reverseEngineSamples(replay, sampleRate = 22050) {
  const samples = new Float32Array(Math.max(1, Math.ceil(replay.duration * sampleRate)));
  const dt = replay.frames[1].time - replay.frames[0].time;
  let phase = 0, seed = 731;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate, frame = replay.frames[Math.min(replay.frames.length - 1, Math.floor(time / dt))];
    const speed = Math.hypot(frame.linearVelocity.x, frame.linearVelocity.z);
    phase += 2 * Math.PI * (38 + speed * 3.1) / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1;
    const grain = Math.exp(-(time % 0.46) * 7); // Reversing turns decay into a suction-like swell.
    const engine = Math.sin(phase) * 0.48 + Math.sin(phase * 2) * 0.22 + Math.sin(phase * 3) * 0.08;
    const skid = Math.min(0.2, Math.abs(frame.angularVelocity.y) * speed * 0.003);
    samples[samples.length - 1 - i] = (engine * (0.35 + grain * 0.6) + noise * (0.05 + skid)) * (0.3 + Math.min(0.7, speed / 70));
  }
  return samples;
}
export function impactSamples(kind, sampleRate = 22050) {
  const duration = kind === 'water' ? 1.6 : 1.15, samples = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = 91, low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate; seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1; low += (noise - low) * (kind === 'water' ? 0.08 : 0.035);
    const bass = Math.sin(2 * Math.PI * (kind === 'water' ? 170 * t + 23 * Math.sin(t * 17) : 55 * t - 15 * t * t));
    samples[i] = kind === 'water' ? noise * Math.exp(-t * 9) * 0.55 + (low + bass * 0.12) * Math.exp(-t * 2.8) : (low * 1.8 + bass * 0.32) * Math.exp(-t * 5) + noise * Math.exp(-t * 24) * 0.35;
  }
  return samples;
}
