# Mapping: Contributions to Sound

`sonify(days, settings)` is a pure function: contribution days in, a plain array of
`SoundEvent` objects out. It makes no audio calls, reads no clock, and uses no unseeded
randomness, so the same data and settings always produce **byte-identical** output. The
player, the share card and the tests all read from that one array.

## Contribution Data to Sound Mapping

| Contribution data | Becomes |
| --- | --- |
| Level 0 (empty day) | a rest — no note at all |
| Levels 1–4 | scale degrees 0–3: a darker green is a lower note, a brighter green higher |
| The exact daily count | velocity, on a log curve against the busiest day in the data |
| Each week | one bass note underneath, pitched by how busy that week was |
| A month passing | optional drift up and down the scale (off by default) |
| The weekday | optional octave, Sunday lowest (off by default) |

Pitch is only ever produced by `degreeToMidi`, which indexes into the chosen scale and wraps
octaves. **Every note is therefore in the chosen scale by construction**, and a test asserts
it across all four scales and every combination of options.

## Time Mappings

Two time mappings:

- **A note per day** — about 365 steps, one bar per week. The default.
- **A chord per week** — 53 steps; each week's distinct shades sound together.

## Audio Settings

Scales: minor pentatonic (default), major pentatonic, dorian, hirajoshi. Default root A3,
default tempo 120 BPM. The speed slider sets days (or weeks) per second. Master gain is
hard-capped at 0.5 before a limiter, there is a mute button and a volume slider, and the
`AudioContext` is only ever created inside a click handler — **no sound happens without a
deliberate user action**.

The current year is partial, so playback stops at today; the remaining days still render in
the grid, marked as future, and are never played.
