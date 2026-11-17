/**
 * A small two-voice synth on raw Web Audio. Every note is a short-lived oscillator plus
 * filter plus envelope, routed through a shared reverb and a master chain whose gain is
 * hard-capped, so no combination of settings can produce a painfully loud output.
 */

import { createImpulseResponse } from './reverb.ts';
import type { Voice } from '../core/types.ts';

/** The absolute ceiling on master gain, before the compressor. */
export const MASTER_CAP = 0.5;

export interface NoteRequest {
  when: number; // audio-clock time
  freq: number;
  velocity: number; // 0..1
  duration: number; // seconds
  voice: Voice;
}

export interface Engine {
  readonly ctx: AudioContext;
  now(): number;
  playNote(note: NoteRequest): void;
  setVolume(percent: number): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  volume(): number;
  resume(): Promise<void>;
  stopAll(): void;
  close(): Promise<void>;
}

/** Perceptual volume curve, capped. 100% on the slider is still only MASTER_CAP. */
export function volumeToGain(percent: number): number {
  const x = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
  return x * x * MASTER_CAP;
}

/**
 * Must be called from a user gesture handler: browsers refuse to start an AudioContext
 * otherwise, which is also exactly the behaviour we want (no audio without a click).
 */
export function createEngine(ContextCtor: typeof AudioContext = AudioContext): Engine {
  const ctx = new ContextCtor();

  const master = ctx.createGain();
  master.gain.value = volumeToGain(70);

  // A gentle limiter so a dense week cannot clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.16;

  const dry = ctx.createGain();
  dry.gain.value = 0.82;

  const wet = ctx.createGain();
  wet.gain.value = 0.3;

  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulseResponse(ctx);

  dry.connect(master);
  wet.connect(convolver);
  convolver.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  let volume = 70;
  let muted = false;
  const live = new Set<{ stop(at: number): void }>();

  function applyGain(): void {
    const target = muted ? 0 : volumeToGain(volume);
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
  }

  function playNote(note: NoteRequest): void {
    const when = Math.max(note.when, ctx.currentTime);
    const velocity = Math.min(1, Math.max(0, note.velocity));
    const duration = Math.min(8, Math.max(0.05, note.duration));
    if (velocity === 0) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    if (note.voice === 'bass') {
      osc.type = 'triangle';
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(1200, note.freq * 6);
      filter.Q.value = 0.7;
    } else {
      osc.type = 'sine';
      filter.type = 'lowpass';
      // Brighter when played harder, which is what makes a busy day sound busy.
      filter.frequency.value = Math.min(9000, note.freq * (3 + velocity * 6));
      filter.Q.value = 1.1;
    }
    osc.frequency.value = note.freq;

    // Percussive envelope: fast attack, exponential-ish decay via linear ramps.
    const peak = velocity * (note.voice === 'bass' ? 0.5 : 0.75);
    const attack = note.voice === 'bass' ? 0.02 : 0.008;
    const release = Math.max(0.08, duration * 0.6);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.setTargetAtTime(0.0001, when + attack, release / 3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    if (note.voice === 'lead') gain.connect(wet);

    const end = when + attack + release + 0.12;
    osc.start(when);
    osc.stop(end);

    const handle = {
      stop(at: number): void {
        try {
          gain.gain.cancelScheduledValues(at);
          gain.gain.setTargetAtTime(0.0001, at, 0.02);
          osc.stop(at + 0.1);
        } catch {
          // Already stopped; nothing to do.
        }
      },
    };
    live.add(handle);
    osc.onended = (): void => {
      live.delete(handle);
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  applyGain();

  return {
    ctx,
    now: () => ctx.currentTime,
    playNote,
    setVolume(percent: number): void {
      volume = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
      applyGain();
    },
    setMuted(value: boolean): void {
      muted = value === true;
      applyGain();
    },
    isMuted: () => muted,
    volume: () => volume,
    resume: () => ctx.resume(),
    stopAll(): void {
      const at = ctx.currentTime;
      for (const handle of [...live]) handle.stop(at);
      live.clear();
    },
    close: () => ctx.close(),
  };
}
