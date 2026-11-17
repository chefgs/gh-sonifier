/**
 * Look-ahead scheduler. Notes are placed on the audio clock a little ahead of time, so
 * timing does not depend on when a timer happens to fire. The timer only decides when to
 * top up the queue; the audio clock decides when a note sounds.
 */

import { degreeToMidi, midiToFreq } from '../core/scales.ts';
import type { Engine } from './synth.ts';
import type { ScaleName, SoundEvent } from '../core/types.ts';

const LOOKAHEAD = 0.18; // seconds of notes queued ahead
const TICK_MS = 25;

export interface TransportOptions {
  engine: Engine;
  events: SoundEvent[];
  totalSteps: number;
  stepDuration: number; // seconds per step at speed 1
  scale: ScaleName;
  rootMidi: number;
  onEnded?: () => void;
}

export interface Transport {
  play(): void;
  pause(): void;
  toggle(): boolean;
  seekStep(step: number): void;
  /** Fractional step position right now, for the playhead. */
  position(): number;
  isPlaying(): boolean;
  setSpeed(multiplier: number): void;
  speed(): number;
  replace(events: SoundEvent[], totalSteps: number): void;
  dispose(): void;
}

export function createTransport(options: TransportOptions): Transport {
  const { engine } = options;
  let events = options.events;
  let totalSteps = options.totalSteps;
  let speed = 1;
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Step position where playback resumes from. */
  let cursorStep = 0;
  /** Index of the next event to schedule. */
  let next = 0;
  /** Audio time that corresponds to step 0 of the current run. */
  let originTime = 0;
  /** How far ahead we have already scheduled, in steps. */
  let scheduledTo = 0;

  function secondsPerStep(): number {
    return options.stepDuration / speed;
  }

  function stepToTime(step: number): number {
    return originTime + step * secondsPerStep();
  }

  function firstEventAtOrAfter(step: number): number {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((events[mid]?.step ?? 0) < step) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function schedule(): void {
    if (!playing) return;
    const horizon = engine.now() + LOOKAHEAD;
    const perStep = secondsPerStep();

    while (next < events.length) {
      const event = events[next]!;
      const when = stepToTime(event.step + event.offset);
      if (when > horizon) break;
      const midi = degreeToMidi(event.degree, options.rootMidi, options.scale);
      engine.playNote({
        when,
        freq: midiToFreq(midi),
        velocity: event.velocity,
        duration: event.duration * perStep,
        voice: event.voice,
      });
      next++;
    }

    scheduledTo = (horizon - originTime) / perStep;
    if (next >= events.length && scheduledTo >= totalSteps) {
      pause();
      cursorStep = 0;
      options.onEnded?.();
    }
  }

  function play(): void {
    if (playing) return;
    playing = true;
    originTime = engine.now() + 0.08 - cursorStep * secondsPerStep();
    next = firstEventAtOrAfter(cursorStep);
    schedule();
    timer = setInterval(schedule, TICK_MS);
  }

  function pause(): void {
    if (!playing) return;
    cursorStep = position();
    playing = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    engine.stopAll();
  }

  function position(): number {
    if (!playing) return cursorStep;
    const step = (engine.now() - originTime) / secondsPerStep();
    return Math.min(totalSteps, Math.max(0, step));
  }

  function seekStep(step: number): void {
    const target = Math.min(totalSteps, Math.max(0, Math.floor(Number(step) || 0)));
    const wasPlaying = playing;
    if (wasPlaying) pause();
    cursorStep = target;
    if (wasPlaying) play();
  }

  return {
    play,
    pause,
    toggle(): boolean {
      if (playing) pause();
      else play();
      return playing;
    },
    seekStep,
    position,
    isPlaying: () => playing,
    setSpeed(multiplier: number): void {
      const value = Math.min(8, Math.max(0.25, Number(multiplier) || 1));
      if (value === speed) return;
      const was = playing;
      if (was) pause();
      speed = value;
      if (was) play();
    },
    speed: () => speed,
    replace(nextEvents: SoundEvent[], steps: number): void {
      const was = playing;
      pause();
      events = nextEvents;
      totalSteps = steps;
      cursorStep = Math.min(cursorStep, steps);
      if (was) play();
    },
    dispose(): void {
      pause();
      events = [];
    },
  };
}
