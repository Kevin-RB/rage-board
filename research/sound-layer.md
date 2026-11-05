# How do we build the sound layer?

Findings for [issue #3](https://github.com/Kevin-RB/rage-board/issues/3), part of the [Rage Board map](https://github.com/Kevin-RB/rage-board/issues/1). Researched 2026-11-05. No app was built and no sound files were downloaded.

## The short answer

**Use the browser's Web Audio API directly, wrapped in a small local `sound.ts` module. Do not add Howler.js.**

The sound layer needs four things that all depend on the same clock and the same final volume control:

- many overlapping one-shot sounds;
- a music bed that visuals can lock onto beat by beat;
- a master volume and mute that persist;
- an optional distortion stage for the Meltdown.

Web Audio gives all four in one graph, with one master gain at the end. Howler is a friendly wrapper for "play this file", but it deliberately hides the audio clock and the graph. Once you need sample-accurate beat scheduling or a distortion chain, you end up reaching through Howler to Web Audio anyway, so you carry both.

Howler is not a bad library. It is the right answer if the app only needed fire-and-forget sound effects. It is the wrong tool for a beat-synced montage.

Nothing here depends on a UI framework. Vite is only relevant to how the audio files are imported and served; the same design works in Astro or with no build tool at all.

### The decisions at a glance

| Decision | Recommendation |
| --- | --- |
| Engine | Native Web Audio API in a local `sound.ts`; no Howler dependency |
| Graph | SFX/music/Meltdown buses → mix → gentle limiter → **master gain last** → speakers |
| One-shots | One decoded `AudioBuffer` per file; a new `AudioBufferSourceNode` per play |
| Beat sync | Schedule with `source.start(when)` on the audio clock; 25 ms scheduler, 100 ms lookahead |
| Visual sync | Compare cue times to `getOutputTimestamp().contextTime`; fall back to `currentTime - outputLatency` |
| Formats | WAV/PCM mono for short effects; MP3 128–192 kbps for music and longer clips |
| Voice cap | ~24 concurrent on desktop, ~16 on mobile/low-end; per-sound caps and priority |
| Autoplay | Create the context suspended; `resume()` on the first click/tap/keydown |
| Volume | Slider position persisted separately from mute; master gain is the only final gain |
| Distortion | Separate Meltdown bus, fixed drive, loudness-matched post-gain, no automatic makeup |
| Persistence | Versioned `localStorage` key, read before the graph is built |

### What the map already settled

These come from [map issue #1](https://github.com/Kevin-RB/rage-board/issues/1) and are treated as requirements, not questions:

- Sound is on by default.
- There is a visible mute control and a volume control.
- Both persist in the browser.
- The app never raises the volume by itself. More Overload means more sounds and more frequent sounds, not a higher volume setting.
- Meltdown is a roughly 10–20 second montage, then a lasting wreckage state.

The open question this ticket was asked to inform is whether distortion can make Meltdown audio *feel* louder without changing the volume setting. The short answer is yes, and there is a safe way to use it. See [Distortion](#distortion-the-open-question).

### How much to trust this

- **High:** facts taken from MDN, the Web Audio specification, Chrome and WebKit documentation, the LAME FAQ, and the actual Howler 2.2.4 source and npm metadata. Versions and file sizes were checked, not remembered.
- **Medium:** the recommended voice limits and file-size budgets. They are sensible starting points, not measured results on the owner's hardware.
- **Low / unverified:** how loud distortion will *feel* on the owner's speakers, and exact latency and voice counts on their machines. Those need a prototype and ears. They are marked below.

## Plain-language primer: what the Web Audio API actually is

It helps to have four ideas before the comparison.

### 1. The audio graph is a chain of little machines

An **`AudioContext`** is the audio engine for the page. Inside it, you connect **nodes**:

```
sound source  →  volume  →  effect  →  speakers
```

Each node does one job. A `GainNode` multiplies the signal (that is volume). A `WaveShaperNode` bends the waveform (that is distortion). A `DynamicsCompressorNode` turns down the loudest parts (that is a compressor/limiter). A `BiquadFilterNode` cuts or boosts frequencies (that is a tone control).

The important part for this app: **volume is just another node**. If the very last node before the speakers is the master gain, then nothing upstream can make the final output louder than that gain allows. That is how the "app never raises the volume" rule becomes structural rather than a promise.

MDN's introduction to the API describes this modular routing and the source → effects → destination workflow ([MDN: Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API), [MDN: Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API)).

### 2. A buffer is the sound; a source node is one playback of it

When you load an MP3 or WAV, you fetch the file and decode it into an **`AudioBuffer`**: the actual samples, held in memory. You do that once per file.

To play it, you create an **`AudioBufferSourceNode`**, point it at the buffer, connect it, and call `start()`.

An `AudioBufferSourceNode` is **one-shot**. After you call `start()`, that node is spent. To play the same sound again, you make a new source node. This sounds wasteful, but MDN is explicit that the nodes are very inexpensive to create and the buffers can be reused for every playback; the nodes are garbage-collected after the sound ends ([MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)).

That is the whole trick behind many overlapping one-shots:

- one decoded buffer per sound file;
- one new source node per playback;
- connect, start, forget.

A useful analogy: the buffer is a cake. Each playback is a slice. You do not bake a new cake for every slice.

### 3. The audio clock is the clock that matters

`AudioContext.currentTime` is a high-precision clock that counts seconds since the context was created. It is not the JavaScript clock. It is the audio system's clock, and scheduled audio events still happen on time even if the main thread is busy ([Chris Wilson, "A Tale of Two Clocks"](https://web.dev/articles/audio-scheduling); [MDN: Advanced techniques](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques)).

To start a sound at a precise moment, pass a time to `start()`:

```ts
source.start(when);            // start at an audio-clock time
source.start(when, offset);    // start at `when`, from `offset` seconds into the buffer
source.start(when, offset, duration);
```

MDN documents all three forms and notes that `when` is in the same time coordinate system as `currentTime` ([MDN: AudioBufferSourceNode.start()](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)).

This is the difference between "play it now" and "play it on beat 9". The first is at the mercy of the main thread. The second is sample-accurate.

### 4. Volume is amplitude, but loudness is what you hear

A gain of `0.5` halves the waveform's amplitude. It does not sound like "half as loud" to a person. That is why a volume slider usually maps its 0–100 position through a curve, such as `gain = (slider/100)²`, instead of sending the slider straight into the gain node.

This matters later for distortion: two signals can have the same peak but different average energy, and the denser one sounds louder. More on that in [Distortion](#distortion-the-open-question).

## Native Web Audio vs Howler.js

### The comparison

| | Native Web Audio API | Howler.js 2.2.4 |
| --- | --- | --- |
| What it is | A browser standard, built in | A wrapper around Web Audio with an HTML5 Audio fallback |
| Install size | 0 bytes of dependency | 36,173 bytes minified, **9,722 bytes gzipped** for the full build; 26,924 bytes / **7,967 bytes gzipped** for the core-only build |
| Licence | Part of the web platform | **MIT** |
| Browser support | `AudioBufferSourceNode` since Chrome 14, Firefox 25, Safari 6 | Supports Web Audio where available, falls back to `<audio>` |
| Playing a sound | Create a source node, connect, `start()` | `sound.play()` |
| Start at a precise future time | `source.start(when)` | No public "start at this audio-clock time" argument; the Web Audio backend starts immediately |
| Beat-synced montage | Direct: schedule every cue on the audio clock | Possible with JS timers in front, but not sample-accurate; the library's own end bookkeeping uses `setTimeout` |
| Master volume/mute | Your own `GainNode`, exactly where you want it | `Howler.volume()` / `Howler.mute()`; `Howler.masterGain` is exposed for custom routing |
| Distortion | `WaveShaperNode`, plus any other node | Not built in; you add Web Audio nodes yourself |
| Voice pooling | You write it; source nodes are cheap | A pool of inactive sounds (default 5) is recycled, but it is **not** a hard concurrent-voice cap |
| Audio sprites | `start(when, offset, duration)` on one buffer | Built-in `sprite` map |
| Autoplay unlock | You call `resume()` after a gesture | `autoUnlock` tries to unlock on the first touch/click |
| Maintenance | Browser standard; no release cadence | Latest release **2.2.4, 19 September 2023**; repository still receives commits, but no newer release; 420 open issues/PRs when checked |
| TypeScript types | Built into the DOM lib | Separate package `@types/howler` (2.2.13, MIT, 13,263 bytes unpacked when checked) |

Sizes and licence came from the published `howler@2.2.4` tarball: `howler.min.js` is 36,173 bytes and 9,722 bytes gzipped; `howler.core.min.js` is 26,924 bytes and 7,967 bytes gzipped; the package is MIT ([npm: howler](https://www.npmjs.com/package/howler), [Howler licence](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/LICENSE.md)). The release date is from the npm registry; the open-issue/PR count is from the GitHub API on 2026-11-05. The types package version and size are from the npm registry.

### What Howler is genuinely good at

Howler earns its popularity:

- It gets you from "file" to "sound" in one line.
- It handles the "unlock audio on the first touch/click" dance automatically (`Howler.autoUnlock`, default `true`).
- It falls back to HTML5 Audio if Web Audio is missing.
- It has sprites, fades, rate changes, and per-sound volume/mute.
- It is small: under 10 KB gzipped for the full build.

For a page that just needs an airhorn button, it is a reasonable dependency.

### Where it stops fitting this app

Three things matter here.

**1. It starts sounds immediately, not on a beat.**

Howler's Web Audio backend calls `bufferSource.start(0, seek, duration)` — the `0` means "now" — and uses `setTimeout` for end/sprite bookkeeping. That is fine for a button, but it is not a scheduling API. There is no `play({ when })` that takes an audio-clock time. If you want a hit marker exactly on beat 3 of a 140 BPM track, you are back to `setTimeout` or `requestAnimationFrame`, both of which jitter under main-thread load ([Howler source, v2.2.4, lines 870–875](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/src/howler.core.js#L870-L875); [Chris Wilson on why JS timers jitter](https://web.dev/articles/audio-scheduling)).

**2. The graph is hidden until you need it.**

Howler creates its own `AudioContext` with default options and builds a master gain for you ([Howler source, lines 2521 and 2550–2552](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/src/howler.core.js#L2521-L2552)). That is convenient. But the Meltdown distortion stage needs a `WaveShaperNode` in a specific place, and the "master volume last" rule needs the master gain to be the last node. You can reach through `Howler.masterGain` and rewire it, but at that point you are writing Web Audio code with a library in the middle.

**3. The pool is not a stacking limit.**

Howler's `pool` option (default 5) is a pool of *inactive* sounds to recycle. If all pooled sounds are active, `_inactiveSound()` creates another one; it does not refuse playback ([Howler README: `pool`](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/README.md); [Howler source, lines 2052–2075](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/src/howler.core.js#L2052-L2075)). So you still need your own concurrency policy for the "stacking limits" requirement, whichever library you use.

### Verdict

**Native Web Audio, in a local module.** It is more code up front, but less total machinery: one context, one clock, one graph, one master gain, no dependency, and no second abstraction to learn around the part that matters. The target browsers all support Web Audio, so Howler's HTML5 fallback is not buying anything here.

If the owner later decides the montage does not need beat sync and the distortion is not worth it, Howler becomes a perfectly good simplification. That is not the app described in the map.

## The recommended design

### The graph

```
one-shot voices ──> sfxBus ──────┐
                                 │
music ───────────> musicBus ─────┼──> mixBus ──> limiter ──> masterGain ──> destination
                                 │
Meltdown bus ──> drive ──> meltdownBus ─┘
```

- **`sfxBus`**: one-shots (hit ticks, airhorns, voice clips). Per-voice gain lives on each voice; the bus is a convenient overall trim.
- **`musicBus`**: the track. It can be ducked down under big moments; it is never boosted above its set level.
- **`meltdownBus`**: the distorted music/stinger path. Distortion lives here, not on the master.
- **`mixBus`**: sums everything.
- **`limiter`**: a gentle `DynamicsCompressorNode` as a safety net against clipping when many sounds stack. It is not a loudness tool and gets no makeup gain.
- **`masterGain`**: the user's volume and mute. **Last node before the speakers.** This is the rule made structural.

MDN describes the compressor as a way to lower the loudest parts and help prevent clipping when multiple sounds are combined ([MDN: DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode)). That is exactly its job here. It is not a brick-wall limiter, though: leave headroom in the per-sound gains so the mix rarely pushes it hard.

### Module shape

A single `src/audio/sound.ts` can own everything:

```ts
export type SoundId = "hit" | "airhorn" | "voice-triple" | "riser" | "music-meltdown";

export type PlayOptions = {
  when?: number;     // AudioContext time; defaults to "now"
  gain?: number;     // per-voice trim, 0..1
  rate?: number;     // playbackRate; 1 = normal
  priority?: number; // higher wins when the cap is hit
};

export type SoundEngine = {
  unlock(): Promise<void>;
  load(manifest: Record<SoundId, string>): Promise<void>;
  play(id: SoundId, opts?: PlayOptions): number | null; // returns a voice id
  playScore(score: Score, startAt?: number): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  getSettings(): { volume: number; muted: boolean };
  stopAll(): void;
};
```

That is deliberately small. It gives the rest of the Board a vocabulary of sounds and cues, and hides the node plumbing.

### Loading: buffers, not `<audio>` elements

For short effects and a 15–20 second montage track, use `fetch()` + `decodeAudioData()`:

```ts
async function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  const bytes = await res.arrayBuffer();
  return ctx.decodeAudioData(bytes);
}
```

`decodeAudioData()` turns the compressed file into raw samples and resamples it to the context's sample rate. It is the preferred way to create an audio source from a file for Web Audio, and it needs the complete file, not a fragment ([MDN: decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)).

Why buffers rather than an `<audio>` element?

- `AudioBufferSourceNode` is designed for precise timing; MDN calls it especially useful for sounds that must match a rhythm ([MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)).
- All the samples are in memory, so playback does not wait on the network.
- You can start the same buffer many times, at different offsets and rates, with no extra decoding.

The trade-off is memory. Decoded audio is stored as 32-bit floats:

- 44.1 kHz stereo = 44,100 × 2 × 4 bytes = **352,800 bytes per second**, about **21.2 MB per minute**.
- A 20-second montage track is about **7 MB** decoded. Fine.
- A 3-minute track would be about **63 MB** decoded. Use an `<audio>` element + `MediaElementAudioSourceNode` for that, not a buffer.

This arithmetic is mine, from the sample format; it is not a browser measurement.

If the app later has a long ambient loop, use one `<audio>` element routed through `createMediaElementSource()` into `musicBus`. MDN's tutorial shows that pattern and notes that a media element is the better choice for full-length tracks, while buffers are better for short, sample-like sounds ([MDN: Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API); [MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)).

**Where the files live:** keep the curated, committed sounds in `public/sounds/` (Vite copies `public/` to the site root unchanged) or import them so Vite hashes and fingerprints them. The gitignored `assets-inbox/` is an input pile, not a served directory. Vite 8.3.5 was the current npm release when checked; its asset docs describe both approaches ([Vite: Static asset handling](https://vite.dev/guide/assets); [npm: vite](https://www.npmjs.com/package/vite)).

### Audio file formats

There is no single perfect format. The practical split is:

| Format | Good for | Watch out for |
| --- | --- | --- |
| **WAV / linear PCM** | Short effects: hit ticks, clicks, UI sounds | Large files; a 44.1 kHz mono 16-bit file is about 88 KB/s, so 0.1 s is ~9 KB and 2 s is ~176 KB |
| **MP3** | Music, voice clips, airhorns longer than about a second | Encoder delay and padding; not ideal for very short transients |
| **AAC / M4A** | Music, if you prefer it to MP3 | Firefox relies on the operating system for AAC, so support is less predictable; patent-encumbered |
| **Ogg Opus** | Music or speech where size/quality matters | Safari support in MDN's table is limited to CAF on older macOS/iOS; not the safest first choice for a cross-browser release |
| **FLAC** | Archival or lossless effects | Overkill for this app; larger files |

**Recommendation:**

- **WAV, mono, 44.1 or 48 kHz, 16-bit** for the very short sounds: hit tick, click, maybe the airhorn if it is short. These are tiny and decode exactly.
- **MP3, 128–192 kbps, 44.1 or 48 kHz** for music and longer voice clips. MP3 is supported everywhere, its patents have expired, and it is small ([MDN: audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)).

Why avoid MP3 for a 50 ms hit tick? MP3 is built on an overlapped transform, and encoders add padding at the start and end. LAME's own FAQ explains the encoder/decoder delay and the extra samples ([LAME Technical FAQ](https://lame.sourceforge.io/tech-FAQ.txt)). Browser decoders vary in whether they trim that padding. For a tick that is supposed to land exactly on a beat, do not rely on it.

MP3's patent situation is settled: MDN states the patents expired in the EU in 2012 and the US in April 2017, so it is free to use ([MDN: MP3](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs#mp3_mpeg-1_audio_layer_iii)). AAC is still patent-encumbered, and Firefox's support depends on the OS ([MDN: AAC](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs#aac_advanced_audio_coding)). Opus is open and technically excellent, but the Safari packaging caveat makes it a second-round optimization, not a first-release requirement ([MDN: Opus](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs#opus)).

Also normalize the files before shipping them. The app is not allowed to raise volume automatically, so a quiet airhorn and a loud voice clip will stay mismatched forever. Aim for a consistent peak around −3 to −1 dBFS (decibels relative to full scale, where 0 dBFS is the loudest the system can represent), trim leading silence, and keep the music a little under the effects. This is asset prep, not runtime gain.

### Playing overlapping one-shots

The core is small:

```ts
function playBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  bus: AudioNode,
  opts: PlayOptions = {},
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = opts.gain ?? 1;

  source.connect(voiceGain).connect(bus);
  source.playbackRate.value = opts.rate ?? 1;

  source.start(opts.when ?? ctx.currentTime);

  // The source is one-shot. Let it be collected when it ends.
  source.onended = () => {
    source.disconnect();
    voiceGain.disconnect();
  };

  return source;
}
```

Notes:

- Create a new source per play. Do not try to restart an old one; the spec forbids calling `start()` twice on the same node ([MDN: start()](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)).
- `playbackRate` changes pitch as well as speed; the spec notes there is no pitch correction ([MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)). A little random rate variation (0.97–1.03) makes repeated hit ticks feel less robotic.
- Keep a reference only while you need to stop or duck it. Otherwise `onended` cleanup is enough.
- If you schedule the same sound several times in the same tick, pass a shared `when` (for example `ctx.currentTime + 0.02`) so they line up exactly instead of starting a few microseconds apart.
- Synthesised sounds — an airhorn built from oscillators, a hit tick built from a short noise burst — go through the same `sfxBus`. They do not need a file. The montage research suggests these are viable for the airhorn and hit marker ([mlg-montage research](https://github.com/Kevin-RB/rage-board/blob/research/mlg-montage/research/mlg-montage.md)).

### Voice limits and stacking

MDN makes a point that surprises many people: Web Audio has **no strict sound-call limitation**. It says there is no ceiling of 32 or 64 sounds, and some processors can play more than 1,000 simultaneous sounds without stuttering ([MDN: Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API)).

That does not mean "play everything". A cap here is a **design choice**, not a browser limit:

- the mix turns to mud if 40 airhorns overlap;
- each active voice costs CPU, and weak laptops/phones hit the limit sooner;
- a predictable cap makes the escalation feel deliberate.

A reasonable starting point, to tune by ear and by profiling:

| Sound | Max at once | Minimum gap between triggers |
| --- | --- | --- |
| Hit tick | 4 | 30 ms |
| Airhorn | 2 | 250 ms |
| Voice clip | 1 per clip, 3 voice clips total | 100 ms |
| Riser / stinger | 1 | — |
| Music | 1 | — |
| **Global** | **24 on desktop, 16 on mobile/low-end** | — |

These numbers are **unverified heuristics**. They are low enough to stay clean and high enough to feel chaotic. Measure on the owner's machines and adjust.

Policy:

1. **Music is never dropped.** It is the clock and the bed.
2. **Priority order:** music > Meltdown stinger > voice clip > airhorn > hit tick.
3. When the cap is hit, drop the lowest-priority voice, or the oldest voice at that priority.
4. Fade a dropped voice out over 10–20 ms rather than cutting it instantly; an abrupt stop clicks.
5. Enforce a minimum gap per sound. "More frequent" does not mean "every frame".
6. Count active voices, not scheduled ones, where possible. If you pre-schedule a whole 15-second score, enforce the limit when the score is generated, or track start/end times.

Why not use Howler's `pool` for this? Because it is an inactive-sound recycler, not a concurrency cap; when all pooled sounds are active it simply creates more ([Howler source, lines 2052–2075](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/src/howler.core.js#L2052-L2075)). You would still write this policy yourself.

### Autoplay: "sound on by default" does not mean "sound before a click"

Browsers block audible autoplay until the user interacts with the page. The exact rules differ, but the shape is the same:

- Chrome blocks autoplay with sound until the user has interacted with the domain, or the site has a high media-engagement score; Web Audio has been covered since Chrome 71. If an `AudioContext` is created before a gesture, it starts **suspended**, and you call `resume()` after the gesture ([Chrome: Autoplay policy](https://developer.chrome.com/blog/autoplay); [MDN: Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)).
- Safari/WebKit says to assume `<video>` and `<audio>` need a user gesture, and iOS has required one for media playback for years ([WebKit: Auto-Play Policy Changes for macOS](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/); [WebKit: New `<video>` Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)).
- Firefox's `media.autoplay.block-webaudio` preference defaults to `true`, so audio contexts only play after sticky activation ([MDN: Autoplay guide, Firefox preferences](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay#firefox)).

So the honest behaviour is:

- A **new visitor** sees the sound control in the "on" position, and the volume at its default.
- **No sound is audible until the first click, tap, or key press.** That is the browser, not the app.
- The first Task add is a click, so in normal use the first sound is available exactly when the app needs it.
- The app should not show a pause icon or a "playing" state before the context is actually running.

The unlock is small:

```ts
async function unlock(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

window.addEventListener("click", () => void unlock(ctx), { once: true });
window.addEventListener("keydown", () => void unlock(ctx), { once: true });
```

A few practical details:

- Create the context on page load (suspended) so you can start fetching and decoding immediately, then `resume()` on the gesture. MDN and Chrome both describe this pattern. Chrome may log a warning that the `AudioContext` was not allowed to start; that is the expected suspended state, not a bug.
- Use `click`/`touchend`/`keydown` as the unlock events; Chrome's guidance explicitly recommends `click`, and WebKit's user-gesture rule is written around touch/click/key events. Listen for `statechange` if you want the UI to reflect the real state; the context can be suspended by the browser when the tab is backgrounded or by an OS interruption.
- Do not create one context per sound. One shared context is simpler, avoids per-tab context limits, and gives you one master gain. MDN notes that context limits are implementation-defined; older Chrome had a six-context-per-tab limit ([MDN: AudioContext constructor](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)).
- Howler's `autoUnlock` does this for you. With native Web Audio, this is the small piece you write yourself.

### Latency: what to expect and what to schedule

There are two latency numbers:

- **`baseLatency`**: processing latency from the end of the graph to the host audio system. MDN's example shows `0.00` for the default interactive hint and `0.15` for the playback hint, but these are illustrative; the real value depends on the machine ([MDN: baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency)).
- **`outputLatency`**: the time between the browser handing a buffer to the OS and the first sample actually reaching the output device. It varies by platform and hardware ([MDN: outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)).

Useful facts:

- `new AudioContext({ latencyHint: "interactive" })` asks for the lowest latency that does not glitch. That is the right default for a page with click feedback and beat-synced effects. The browser may ignore the request, so check `baseLatency` if it matters ([MDN: AudioContext constructor](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)).
- For a click-triggered one-shot, a few tens of milliseconds is usually imperceptible. The bigger source of jitter is *when your code calls `start()`*, not the audio hardware. Scheduling with an explicit `when` removes that jitter.
- For a stack of effects that should hit together, schedule them all at the same `when` about 20–50 ms in the future. They will be sample-aligned even if the main thread is busy.
- For the montage, schedule ahead. Chris Wilson's classic recommendation is a **25 ms** scheduler interval with **100 ms** of lookahead; MDN's step-sequencer tutorial uses the same numbers ([Chris Wilson](https://web.dev/articles/audio-scheduling); [MDN: Advanced techniques](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques)). That is more than enough for a 140–170 BPM montage.

Howler creates its context with `new AudioContext()` and does not expose a latency hint ([Howler source, line 2521](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/src/howler.core.js#L2521)). The browser default is already `"interactive"`, so this is not a disaster; it is just one less knob, and it is not the reason to reject Howler. The scheduling gap is the real reason.

### Beat-synced montage

The montage research gives a useful skeleton at 140 BPM: one beat = 0.43 s, one 4-beat bar = 1.71 s; a 15.4 s structure of bait, kill/reaction, build-up, drop, closer ([mlg-montage research](https://github.com/Kevin-RB/rage-board/blob/research/mlg-montage/research/mlg-montage.md)). That research also warns that every timing in it is inference and should be checked against real videos. The sound layer should therefore take timing as data, not hard-code it.

Represent a montage as a **score**:

```ts
type Cue = {
  beat: number;       // when, in beats from the start
  sound: SoundId;
  gain?: number;
  rate?: number;
};

type Score = {
  bpm: number;
  music?: SoundId;
  musicOffset?: number; // seconds into the track, e.g. start at the drop
  cues: Cue[];
};

function scheduleScore(ctx: AudioContext, score: Score, startAt: number) {
  const secondsPerBeat = 60 / score.bpm;
  for (const cue of score.cues) {
    play(cue.sound, {
      when: startAt + cue.beat * secondsPerBeat,
      gain: cue.gain,
      rate: cue.rate,
    });
  }
}
```

For a one-off 10–20 second Meltdown, scheduling the whole score up front is fine: a few dozen `AudioBufferSourceNode`s are cheap, and the audio thread handles the timing. For the ongoing ambient layer (small reactions as Tasks are added), use the lookahead scheduler so you can change density, stop, or mute without leaving a queue of future sounds.

The scheduler pattern:

```ts
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1; // seconds

let nextBeatTime = 0;
let nextBeat = 0;

function scheduler() {
  while (nextBeatTime < ctx.currentTime + SCHEDULE_AHEAD) {
    playCuesForBeat(nextBeat, nextBeatTime);
    nextBeatTime += 60 / bpm;
    nextBeat++;
  }
  setTimeout(scheduler, LOOKAHEAD_MS);
}
```

`setTimeout` is only the wake-up call. The actual sound times come from `ctx.currentTime` and `start(when)`. That is the "two clocks" idea: the JS timer wakes up early and books slots on the audio clock ([Chris Wilson](https://web.dev/articles/audio-scheduling)).

### Syncing visuals to the music

This is the part most implementations get subtly wrong. Do not compare a cue's time to `ctx.currentTime` and draw immediately. `currentTime` is the audio graph's clock, which runs ahead of what the speakers are actually playing by roughly `outputLatency`. The visuals will lead the sound.

Use `AudioContext.getOutputTimestamp()`:

- `contextTime` is the time of the sample frame currently being rendered by the output device — i.e. what the listener is hearing now.
- `performanceTime` is the `performance.now()` time at which that frame was rendered.

MDN documents both ([MDN: getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)). Browser support is broad: Chrome 57+, Firefox 70+, Safari 14.1+ ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json)).

```ts
function visualFrame() {
  const ts = ctx.getOutputTimestamp?.();
  const audibleTime = ts?.contextTime ?? ctx.currentTime - (ctx.outputLatency ?? 0);

  for (const cue of visualCues) {
    if (!cue.done && audibleTime >= cue.at) {
      cue.done = true;
      render(cue);
    }
  }

  requestAnimationFrame(visualFrame);
}
```

Notes:

- `outputLatency` is not available in Safari before 18.4 ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json)), so feature-detect and fall back to `currentTime` if `getOutputTimestamp` is missing. The fallback will be a frame or two early, which is acceptable.
- `requestAnimationFrame` runs at the display's refresh rate, typically 60 Hz. At 140 BPM a 16th note is about 107 ms, so a frame is plenty. At absurd tempos, batch multiple cues in one frame.
- In a background tab, `requestAnimationFrame` pauses but scheduled audio keeps going. On return, `getOutputTimestamp` tells you where the music actually is; catch the visuals up rather than assuming they stayed in sync.
- If the montage uses video clips, drive them from the same audio clock; do not give the video its own timer.

### Escalation without raising volume

The map's rule is easy to implement once the graph is fixed:

- **Do not** change `masterGain` when Overload rises.
- **Do not** change per-sound gains when Overload rises.
- **Do** increase the number of layers, the density of cues, and the variety.

A simple density table, to tune later:

| Stage | Sound behaviour |
| --- | --- |
| Calm | Sparse UI tick on add; no music, or a very quiet bed |
| Uneasy | Occasional airhorn; a second layer on big adds |
| Stressed | Hit ticks on every add; a low music bed; occasional voice clip |
| Unhinged | Denser patterns, risers, overlapping voice clips; music still under the effects |
| Meltdown | Full score: music + stacked effects on the beat; then sparse wreckage bursts |

The app can also **duck** the music under a big effect: automate `musicBus.gain` down 3–6 dB for 200 ms and back. Ducking is attenuation, so it does not violate the rule. It also makes the effects feel bigger without making them louder.

### Distortion: the open question

**Can distortion make Meltdown audio feel louder without changing the volume? Yes.** Here is the mechanism, and the safe way to use it.

#### What a `WaveShaperNode` does

A `WaveShaperNode` applies a non-linear curve to the waveform. The input sample, nominally in the range −1 to +1, indexes into a table of output values. A straight line through the table does nothing; a curved line bends the wave. The Web Audio spec calls it a non-linear distortion effect and allows arbitrary shaping curves ([Web Audio spec: WaveShaperNode](https://webaudio.github.io/web-audio-api/#WaveShaperNode); [MDN: WaveShaperNode](https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode)).

A simple, well-behaved curve is a normalized hyperbolic tangent:

```ts
function makeTanhCurve(drive = 3, samples = 1024): Float32Array {
  const curve = new Float32Array(samples);
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1; // -1..1
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

const shaper = ctx.createWaveShaper();
shaper.curve = makeTanhCurve(3);
shaper.oversample = "2x"; // or "4x" for higher quality, more CPU
```

Two details:

- The curve should pass through zero. The spec warns that a curve with a non-zero output at zero input produces a DC offset even with no input connected ([Web Audio spec: WaveShaperNode](https://webaudio.github.io/web-audio-api/#WaveShaperNode)). The `tanh` curve above is odd, so it passes through zero.
- `oversample` can be `"none"`, `"2x"`, or `"4x"`. Oversampling reduces aliasing, at extra CPU cost; the spec says `"4x"` gives the highest quality ([Web Audio spec: WaveShaperNode](https://webaudio.github.io/web-audio-api/#WaveShaperNode)). Start with `"2x"`.

#### Why it sounds louder

Distortion adds harmonics. A pure sine becomes a buzzy, squarer wave. A squarer wave spends more of each cycle near its maximum amplitude, so its **RMS** (average energy) is higher even when its **peak** (the highest single sample) is the same.

Concrete arithmetic: a sine of peak amplitude `A` has RMS `A / √2 ≈ 0.707A`. A square wave of the same peak has RMS `A`. That is a ratio of `√2`, or about **+3.0 dB** of average energy at the same peak. Real distortion is somewhere between the two. For the usual drive curves, the direction is consistent: more harmonics and a flatter wave mean more average energy, and the ear tends to read that as louder.

That is why a distorted guitar sounds louder than a clean guitar at the same peak meter reading. The peak did not move; the average did.

#### The part that matters for the volume rule

The app's rule says the app never raises the volume. The strict implementation is:

> `masterGain` is only ever set from the user's volume control (including restoring their saved value). No code path increases it beyond what the user set.

Distortion does not have to change `masterGain` at all. Put it on a **separate Meltdown bus**, before the master:

```
Meltdown music/stinger → preGain → WaveShaper → postGain → meltdownBus → mixBus → limiter → masterGain → speakers
```

Then:

- The volume slider still scales the final output. Muting still mutes everything. The slider's position and the master gain value are unchanged by the distortion.
- At the *same* slider position, the distorted signal may still **feel** louder, because its RMS is higher. That is the loophole in the letter of the rule.

There are two honest ways to handle it:

1. **Treat distortion as timbre, not volume.** Loudness-match the distorted path to the clean path with a fixed `postGain`. The effect becomes "grittier", not "louder". This is the safest reading of the rule's intent.
2. **Accept a small perceived lift, but never automate it upward.** Use a fixed drive and a fixed post-gain, and let the owner decide by ear. Do not tie drive or makeup gain to Overload.

**Recommendation: option 1.** It gives the owner the Meltdown texture without the "why did it suddenly get louder?" surprise that the rule is trying to prevent. It also keeps the door open to increasing density for escalation, which is the map's chosen mechanism.

#### How to loudness-match

Do it offline, at build/asset-prep time, not at runtime:

1. Render the same short passage twice through an `OfflineAudioContext`: once clean, once through the distortion chain. `OfflineAudioContext` renders as fast as it can and gives you an `AudioBuffer`; it does not need the speakers ([MDN: OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)).
2. Measure peak and RMS of both.
3. Adjust the distortion path's fixed `postGain` until its RMS is within about 0.5 dB of the clean path.
4. Check that the peak stays below about −1 dBFS so the limiter is not working hard.
5. A/B them at the **same slider position**. If the distorted one still feels louder, lower `postGain` a little more.

RMS is a rough proxy for loudness, not a perfect one; the ear is more sensitive in some frequency ranges. The final check is listening. That is why this is a recommendation to test, not a measured result.

#### What not to do

- **Do not put the master gain before the distortion.** If the slider feeds the shaper, turning the slider up increases the drive and changes the timbre; turning it down cleans the sound. The slider stops being a volume control.
- **Do not add makeup gain automatically.** That is the app raising the volume, just with extra steps.
- **Do not tie drive to Overload.** "More overload = more distortion" will also mean "more overload = louder", which is exactly the rule's target.
- **Do not use a compressor to make the mix louder.** A compressor can reduce peaks and, with makeup gain, raise average level. Use it as a safety net with no makeup, or skip it and leave headroom in the asset gains.

A `DynamicsCompressorNode` is still useful: MDN describes it as lowering the loudest parts and helping prevent clipping when multiple sounds are combined ([MDN: DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode)). Set a gentle threshold and ratio, and do not use its reduction as a loudness tool.

## Volume, mute and persistence

### The state

Keep two stored values, and derive the third:

```ts
type SoundSettings = {
  volume: number; // 0..1, the slider position
  muted: boolean;
};
```

- `volume` is the **slider position**, not the gain. Persist it as the user set it.
- `muted` is independent. Muting must not overwrite the slider with 0; otherwise unmuting loses the user's level.
- The gain sent to `masterGain` is derived: `muted ? 0 : curve(volume)`.

### The curve

A simple, cheap perceptual mapping:

```ts
function volumeToGain(volume: number): number {
  return volume * volume; // 0..1 -> 0..1, with a more usable low end
}
```

At 50% on the slider this gives 25% amplitude, which feels closer to "half as loud" than a straight linear mapping. A dB-based mapping is more precise, but the square is easy to understand and good enough for a joke app. This is a design choice, not a spec requirement.

### Applying it without clicks

Do not assign `masterGain.gain.value` abruptly while sound is playing; that can click. Ramp it:

```ts
function applyMaster(ctx: AudioContext, master: GainNode, s: SoundSettings) {
  const target = s.muted ? 0 : volumeToGain(s.volume);
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(target, now, 0.01); // ~10 ms time constant
}
```

`setTargetAtTime` approaches the target exponentially; after a few time constants it is inaudibly close. MDN describes it as an exponential move toward the target, with the rate set by the time constant ([MDN: AudioParam](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam)). For an exact mute, a short `linearRampToValueAtTime(0, now + 0.02)` is also fine.

### Persisting it

`localStorage` stores strings per origin and survives browser sessions ([MDN: Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)). Use a versioned key so a future schema change does not break old data:

```ts
const KEY = "rageboard.sound.v1";

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { volume: 0.7, muted: false };
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      volume: clamp(parsed.volume ?? 0.7, 0, 1),
      muted: parsed.muted ?? false,
    };
  } catch {
    return { volume: 0.7, muted: false };
  }
}

function saveSettings(s: SoundSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / storage disabled: keep the in-memory value.
  }
}
```

Notes:

- Read the settings **before** creating the audio graph, so the first sound uses the stored level.
- A new visitor gets `volume: 0.7, muted: false`. That is "sound on by default".
- A returning visitor who muted gets `muted: true`; the persisted choice wins over the default. That is what persistence means.
- `localStorage` can throw a `SecurityError` if storage is disabled, and is unavailable/undefined for `file:` URLs in some browsers ([MDN: Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)). The `try/catch` keeps the app working.
- If "New day" is meant to reset the Board, decide separately whether it resets sound settings. My recommendation: keep sound preferences across New day; they are a user preference, not part of the day's data. That is a small question for the map.

### What mute actually does

The simplest reliable behaviour:

- Mute sets `masterGain` to 0 with a short ramp. The volume value is untouched, so unmute restores the same level.
- Dragging the volume slider while muted updates the saved value but does **not** unmute. The mute button is the only thing that unmutes.
- For a short montage, let the timeline keep running silently while muted. If the user unmutes halfway through, they hear the rest in sync rather than restarting or jumping.
- For a long ambient bed, pausing or suspending the context saves power. Unmuting is itself a user gesture, so resuming the context there is allowed.

That is a little more logic than "set volume to 0", but it avoids the classic bug where unmuting loses the user's chosen level.

### UI details that matter

- Use a real `<button>` for mute, with a clear label and `aria-pressed` (or `role="switch"`), and a real `<input type="range">` for volume with a `<label>`. MDN's best-practices page recommends exactly these controls and labels for accessibility ([MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)).
- Show the mute state clearly. Do not rely on colour alone.
- If the context is suspended because the browser has not seen a gesture yet, the UI can still show "Sound on"; the first gesture unlocks it. Do not show a "playing" animation before that.
- Keep the volume slider's value when muting. On unmute, restore the derived gain from the saved value.

## Music: short montage track vs long bed

- **Montage track (10–20 s):** decode into an `AudioBuffer`, play one `AudioBufferSourceNode`, schedule all cues against its start time. This is the simplest and most precise.
- **Long ambient bed (minutes):** use an `<audio>` element routed through `createMediaElementSource()` into `musicBus`. You avoid decoding tens of megabytes and get streaming for free. The cost is less precise timing; do not use it as the montage's beat clock.
- **Looping:** `source.loop = true`, with `loopStart`/`loopEnd` if the file has silence at the ends. For the montage, do not loop; schedule a stop at the end and clean up.
- **Music offset:** if the track has an intro and the joke starts at the drop, store a `musicOffset` in seconds and call `source.start(startAt, musicOffset)`. Schedule the visual cues relative to the same `startAt`.

A useful pattern for variation: generate a `Score` from templates each time the Meltdown starts, choosing a subset of cues and small random rate/gain variations. The sound layer stays the same; only the score changes. That satisfies "the Meltdown should vary rather than play the same way every time" without making the audio engine unpredictable.

## A build order that teaches the pieces

This is the order I would build it in, smallest useful step first:

1. **Silent graph + volume/mute.** Create the context, build `masterGain → destination`, wire a slider and a mute button, persist the values. Verify with a single test tone or a short file. No scheduling yet.
2. **Load and play one shot.** `fetch` + `decodeAudioData`, one `AudioBufferSourceNode`, one button. Confirm the autoplay unlock works on Chrome, Firefox and Safari.
3. **Overlap.** Play the same shot five times in a row; confirm the buffer is reused and the sources clean up. Add `onended` disconnection.
4. **Voice cap.** Add the global and per-sound caps, priority, and a short fade when dropping. Stress it with 50 rapid clicks.
5. **Scheduler.** Add the 25 ms / 100 ms lookahead scheduler and a metronome click on the audio clock. Confirm it stays steady while you resize the window or run a heavy layout.
6. **Score.** Turn the montage skeleton into a `Score` of cues and play it. Add the visual sync using `getOutputTimestamp`.
7. **Distortion.** Add the `WaveShaperNode` on the Meltdown bus, loudness-match it offline, and A/B at the same slider position.
8. **Tune.** Measure `baseLatency`/`outputLatency` on the owner's machines, tune the caps, and test on a weak laptop and a phone.

Steps 1–3 are a good afternoon. Step 5 is the conceptual leap; everything after it is easier.

## Testing checklist

- [ ] Fresh profile: no sound before the first click/tap/key; sound after it.
- [ ] Sound is on by default for a new visitor; a persisted mute stays muted after reload.
- [ ] Volume and mute persist after reload; muting does not erase the slider value.
- [ ] Reload after interacting: in the normal case the new context starts suspended and unlocks on the next gesture; some browsers may allow it immediately if the site has enough engagement.
- [ ] 50 rapid clicks: no crackle, no runaway voice count, no memory growth.
- [ ] Meltdown: every cue lands on its beat; visuals do not lead the audio by the output latency.
- [ ] Background tab: audio continues; on return, visuals catch up to the audible position.
- [ ] Distortion A/B at the same slider position: it sounds grittier, not suddenly louder; peak stays below −1 dBFS.
- [ ] Chrome, Firefox, Safari desktop; iOS Safari if mobile is in scope.
- [ ] Weak laptop / phone: the global cap prevents dropouts.
- [ ] `prefers-reduced-motion`: visuals calm; decide separately whether sound density should also calm (the map does not say).
- [ ] Missing/404 audio file: the app still works, with a console warning rather than a crash.
- [ ] Production host serves `audio/wav` and `audio/mpeg` with the right extensions, and the hashed asset URLs resolve.

## What I could not verify

- **Actual latency** on the owner's machines. `baseLatency` and `outputLatency` are hardware- and OS-dependent; the MDN examples are illustrative, not targets.
- **Actual voice counts** before dropouts. The 24/16 caps are heuristics. MDN says some processors handle >1,000 simultaneous sounds, but that is not a promise for this app with per-voice gains and effects.
- **How much louder distortion feels** on the owner's speakers/headphones. The +3 dB RMS example is arithmetic for an ideal hard-clipped sine, not a measurement of the actual chain. Loudness matching needs listening.
- **Exact browser support for every codec in 2026.** MDN's tables are the best primary-ish source I found, but they can lag. In particular, the Opus/Safari entry may be stale; that is another reason to start with MP3/WAV.
- **Whether the owner's static host serves the right MIME types and caching headers.** Vite's dev server does; the production host should be checked (`audio/wav`, `audio/mpeg`).
- **The musical timing of the montage.** The 140 BPM skeleton comes from the montage research and is inference, not measured from the reference videos. Treat the score as editable data.

## Questions this raises for the map

1. **Does loudness-matched distortion satisfy the volume rule?** My recommendation is yes: distortion is timbre, and the master gain stays user-controlled and last. But the owner should confirm that "gritty, not louder" is the intended joke, rather than a deliberate perceived lift. This is the one judgement call in this ticket that is not purely technical.
2. **Should "New day" reset sound settings?** I recommend keeping them; they are a preference, not day data. If the map wants a full reset, that needs to be explicit.
3. **Should reduced-motion also reduce sound density?** The map says effects calm down under the system setting; it does not mention audio. A separate "reduce sound" toggle may be kinder than tying it to motion.
4. **Music source and rights.** This layer will play whatever file it is given; the choice between an original synth track and a licensed/recognisable track belongs to the asset collection and rights work (issue #6). A synthesised track removes most of the rights question but may lose the recognition the montage joke relies on.

## Sources

All links checked 2026-11-05.

**Web Audio API and browser behaviour**

- [MDN: Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MDN: Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API)
- [MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [MDN: Advanced techniques: Creating and sequencing audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques)
- [MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)
- [MDN: AudioBufferSourceNode.start()](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)
- [MDN: BaseAudioContext.decodeAudioData()](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
- [MDN: AudioContext constructor](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)
- [MDN: AudioContext.baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency)
- [MDN: AudioContext.outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- [MDN: AudioContext.getOutputTimestamp()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
- [MDN: WaveShaperNode](https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode)
- [MDN: DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode)
- [MDN: AudioParam](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam)
- [MDN: OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)
- [MDN: Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [MDN: Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [W3C Web Audio API specification](https://webaudio.github.io/web-audio-api/)
- [Chrome: Autoplay policy](https://developer.chrome.com/blog/autoplay)
- [WebKit: Auto-Play Policy Changes for macOS](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)
- [WebKit: New `<video>` Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- [Chris Wilson: Scheduling web audio with precision](https://web.dev/articles/audio-scheduling)

**Formats**

- [MDN: Audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)
- [MDN: Media containers — WAVE](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers#wave_wav)
- [LAME Technical FAQ](https://lame.sourceforge.io/tech-FAQ.txt)

**Howler**

- [Howler.js website](https://howlerjs.com/)
- [Howler.js v2.2.4 source (tag commit)](https://github.com/goldfire/howler.js/tree/003b917c40cb41cf382ba47ae0ed7a35ca2abe76)
- [Howler README (v2.2.4)](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/README.md)
- [Howler licence (MIT)](https://github.com/goldfire/howler.js/blob/003b917c40cb41cf382ba47ae0ed7a35ca2abe76/LICENSE.md)
- [npm: howler](https://www.npmjs.com/package/howler)
- [npm: @types/howler](https://www.npmjs.com/package/@types/howler)

**Build tool**

- [Vite: Static asset handling](https://vite.dev/guide/assets)
- [npm: vite](https://www.npmjs.com/package/vite) (latest 8.3.5 when checked)

**Rage Board context**

- [Issue #3: How do we build the sound layer?](https://github.com/Kevin-RB/rage-board/issues/3)
- [Issue #1: Map: Rage Board spec](https://github.com/Kevin-RB/rage-board/issues/1)
- [MLG montage research](https://github.com/Kevin-RB/rage-board/blob/research/mlg-montage/research/mlg-montage.md)
