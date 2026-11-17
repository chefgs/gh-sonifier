/**
 * mulberry32: a tiny seeded PRNG. Used only for humanisation, so that the same seed and
 * the same data produce the same jitter and playback stays reproducible.
 */
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
