/**
 * A reverb impulse response generated at runtime: exponentially decaying noise, lightly
 * low-passed by mixing neighbouring samples. No audio files, no libraries.
 */
export function createImpulseResponse(ctx: BaseAudioContext, seconds = 1.9, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const envelope = Math.pow(1 - i / length, decay);
      const noise = Math.random() * 2 - 1;
      // One-pole smoothing takes the harshest top off the tail.
      last = last * 0.42 + noise * 0.58;
      data[i] = last * envelope;
    }
  }
  return buffer;
}
