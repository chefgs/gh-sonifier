# Contribution Sonifier (browser extension)

Adds a player under the contribution graph on a GitHub profile page and plays the graph as music.
Busier days are higher notes, quiet days are silence, each week sets a chord, and the square being
played is outlined on GitHub's own graph. Click any square to hear that day.

## Install (Chrome, Edge, Brave)
1. Unzip this folder somewhere permanent.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on Developer mode.
3. Choose Load unpacked and pick this folder (the one containing `manifest.json`).
4. Open any GitHub profile. The player appears under the graph. Switching the year rebuilds it.
   After updating the files, press the reload icon on the extension card and refresh the profile.

## Controls
**Playback**: Play/Pause, Restart, Speed (days per second), Volume (capped), Mute.

**Sound**
- Scale: minor or major pentatonic, Dorian, Lydian.
- Skip empty days: plays only days with contributions. On by default. Each day keeps the same note either way.
- Weekly chords, Bells on peak days (60% or more of your busiest day), Drums.
- Drums by shade level: 1 kick; 2 adds hi-hat; 3 adds snare; 4 adds open hi-hat. A crash marks each month's
  first active day and your busiest day.

**Randomise** (always seeded, so the same seed gives the same tune)
- Mode Off: the count sets the note.
- Wander: the count still sets the register, but the exact scale note moves within two steps, favouring stepwise
  motion. Peak days keep their pitch so the shape of your year stays audible.
- Shuffle scale degrees: each seed scrambles which scale note each degree plays, keeping the octave.
- Seed and Re-roll: Re-roll picks a new seed and shows it. Type a seed to get a tune back.
- Humanise: a small random delay, loudness change and occasional neighbouring note.
- Octave per weekday: each weekday is shifted up, down or left alone, chosen by the seed.

**Export MIDI**: saves a Standard MIDI File (type 1, 480 PPQ). One timeline step is an eighth note; set the
tempo in BPM. Tracks you can include: Melody (vibraphone), Bells (glockenspiel), Chords (warm pad),
Drums (channel 10), and Brightness (CC74 follows the daily count). Month starts are written as markers.
The file reflects your current scale, skip, seed and randomise settings. Open it in GarageBand, Ableton, Logic,
FL Studio, LMMS or any MIDI player, and swap in real instruments.

## Privacy and permissions
- Requests no permissions. It runs only on https://github.com/*.
- Reads the graph that is already on the page. It makes no network requests, stores nothing,
  and sends nothing anywhere. There is no `fetch`, storage, `eval` or `innerHTML` in the code.
- Audio starts only when you press Play or click a square. Volume is capped and there is a mute button.
- The MIDI file is built in the page and saved by your browser. It is never uploaded.
- Private contributions appear only if the profile already shows them to you.

## Limits
- It depends on GitHub's current page markup (`table.ContributionCalendar-grid`, `td.ContributionCalendar-day`,
  `tool-tip`). If GitHub changes it, the player simply does not appear. It never guesses.
- If a square's exact count is missing, its note comes from the shade level and the player says so.
- Days after today are not played.
- Tested in Chrome against a saved copy of a profile page. Not tested on the live site or in Firefox.
