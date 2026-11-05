# How do we build the visual effects?

Research for [issue #2](https://github.com/Kevin-RB/rage-board/issues/2), part of the [Rage Board map](https://github.com/Kevin-RB/rage-board/issues/1). Checked on 2026-11-05. Words like Board, Task, Estimate, Shift, Overload and Meltdown follow [GLOSSARY.md](https://github.com/Kevin-RB/rage-board/blob/main/GLOSSARY.md).

## The short answer

**Use Vite 8 with plain TypeScript 7, keep every Task as a real DOM element, and split the effects across three tools:**

| Job | Tool | Extra download | Why |
|---|---|---|---|
| Task layout, flying, nudging, screen shake, flickering lights | CSS transitions and the Web Animations API | **0 KB** | The browser already knows how to move DOM elements. Text stays text. |
| Conducting the 10-20 second Meltdown | **GSAP 3.15.1**, core only | **~28 KB gzipped** | A timeline is the right shape for "do this at 3.2 s, that at 4.0 s, overlap these two". |
| Sparks, embers, fire, smoke | **One hand-written Canvas 2D layer** | **0 KB** of library | Hundreds of short-lived dots are much cheaper on a canvas than as DOM elements. |
| Cracked glass | **SVG overlay** | **0 KB** of library | Cracks are lines and polygons. SVG keeps them sharp at any size and never touches the Task text. |
| Physics for scattering | **A tiny custom simulation, not Matter.js** | **0 KB** | Ten to thirty Task cards need velocity, gravity and a floor, not a rigid-body engine. |

No UI framework. No Matter.js. No PixiJS or WebGL. Those are all real options, but each one adds weight or takes away the thing the Board needs most: readable, selectable Task text.

The rest of this document explains why, then explains each effect in plain language, then covers the safety rails, phone performance and a learning order.

## The constraint that chooses the stack: Tasks stay text

The map says Tasks must remain real, readable text until the Meltdown. That is not just a visual preference. It decides the renderer.

- **DOM text** can be selected, copied, zoomed, read by a screen reader and searched by the browser. A Task title is an `<h2>` or `<span>`.
- **Canvas text** is pixels. It cannot be selected or read by a screen reader unless you rebuild all of that by hand. It also gets blurry when zoomed.
- **WebGL text** (PixiJS, Three.js) is a texture or a signed-distance-field sprite. It is fast and pretty, but it is still not text.

So the Board is a **DOM page with effects around it**, not a game canvas with a form bolted on. That single decision makes CSS, the Web Animations API, GSAP, Canvas 2D and SVG the natural tools. It also means the Meltdown can wreck the page while the Tasks remain the owner's actual words.

One practical rule follows: **never set a Task title with `innerHTML`.** Use `textContent`, so a title like `<img onerror=...>` is displayed as characters and never parsed as markup.

```ts
titleEl.textContent = task.title;
```

## How the pieces fit together

Think of the Board as a layer cake:

```
┌──────────────────────────────────────────────┐
│ flash / light overlay     (CSS, full screen)  │  ← uses the shared flash counter
├──────────────────────────────────────────────┤
│ sparks canvas             (Canvas 2D)         │  ← short-lived, additive, on top
├──────────────────────────────────────────────┤
│ cracked glass             (SVG)               │  ← pointer-events: none
├──────────────────────────────────────────────┤
│ Task cards                (real DOM text)     │  ← transforms only; never rasterised
├──────────────────────────────────────────────┤
│ fire / smoke canvas       (Canvas 2D)         │  ← behind the cards
└──────────────────────────────────────────────┘
        all inside one .board-shake wrapper
```

The wrapper is what shakes. The mute button and other controls sit **outside** it, or they jiggle too and become hard to use.

Start with one canvas above the Board if that is simpler. Split it into a behind-canvas for fire and an above-canvas for sparks only when fire starts washing over the text. Two small canvases are still cheap; one huge canvas at device-pixel-ratio 3 is not.

There is **one animation clock**. A single `requestAnimationFrame` loop updates the canvas particles and the shake, while CSS and GSAP run their own animations on the same document timeline. Do not give each effect its own timer.

An effect module can look like this, and the Board logic never needs to know what is inside:

```ts
export interface Effects {
  mount(root: HTMLElement): void;
  onTaskAdded(taskId: string, el: HTMLElement): void;
  onStageChange(from: Stage, to: Stage): void;
  onMeltdown(kind: MeltdownKind, killedTask: HTMLElement): void;
  onRebuild(): void;
  setMode(mode: 'full' | 'calm'): void;
  destroy(): void;
}
```

The Board owns Tasks, Estimates, Shift and Overload. The effects module only reads the DOM and reacts. That keeps the stage logic testable and stops a visual bug from corrupting saved state.

## The realistic options, compared

Sizes are the published browser bundles from npm, measured on 2026-11-05 by extracting each tarball and running `gzip -9` on the minified file. They are **not** the final Vite bundle; tree-shaking can change them. GSAP's figure was also checked in a tiny esbuild bundle (see [What was measured](#what-was-measured)).

| Option | What it is good at | Extra download (gzip) | Many effects at once | Phones | Learning curve | Verdict |
|---|---|---:|---|---|---|---|
| **CSS transitions / keyframes** | Simple, repeatable changes: fades, nudges, flicker, a Task sliding into place | 0 KB | Fine for tens of elements; not for hundreds of particles | Excellent | Easy | **Use** |
| **Web Animations API** (`element.animate()`) | The same browser engine, controlled from TypeScript: pause, reverse, inspect, await `finished` | 0 KB | Same as CSS | Excellent | Easy-medium | **Use** |
| **GSAP core** | Long sequences, labels, overlapping tweens, one master timeline, `timeScale` for slow motion | ~28 KB | Excellent; it only orchestrates, the browser still draws | Excellent | Easy-medium | **Use for the Meltdown** |
| **Hand-written Canvas 2D particles** | Hundreds of sparks, embers, smoke puffs; precise control over every dot | 0 KB | Hundreds at 60 fps on desktop; fewer on phones | Good with a lower particle budget | Medium | **Use** |
| **SVG** | Cracked glass, drawn lines, sharp at any size | 0 KB | A few dozen paths is nothing | Excellent | Easy-medium | **Use** |
| **Matter.js 0.20.0** | Real rigid-body collisions, stacking, constraints, a physics world | ~26 KB | Dozens of bodies fine; collisions cost CPU | Good; mobile-compatible per its README | Medium-hard | **Not needed** |
| **Anime.js 4.5.0** | A MIT-licensed animation engine with timelines, WAAPI sync, draggable | ~41 KB | Excellent | Good | Easy-medium | **Close second to GSAP; not needed** |
| **PixiJS 8.22.0** | WebGL/WebGPU sprites, filters, thousands of particles, shaders | ~237 KB | Thousands of sprites; GPU-bound | Good but uses GPU memory and battery | Hard | **No, for now** |
| **WebGL shaders** (direct, Three.js, Pixi filters) | Full-screen distortion, refraction, lens bulge | Large | Very high | Varies a lot by device | Hardest | **Later, only if distortion is essential** |
| **canvas-confetti 1.9.4** | Confetti, and only confetti | ~6.9 KB | Good | Good | Easy | **Not needed; borrow the technique** |

### Why not Matter.js for the scattering?

Matter.js is a real 2D rigid-body engine: masses, friction, restitution, constraints, stable stacking ([Matter.js README](https://github.com/liabru/matter-js#features)). It is good at what it does. The Board does not need that.

The Board has maybe ten to thirty Task cards, all rectangles, all known sizes, all starting from a layout the page already computed. A convincing scatter needs four things:

1. A position and a velocity per card.
2. Gravity pulling down.
3. Drag and a bounce when a card hits the floor.
4. A stop condition, so cards settle instead of jittering forever.

That is about forty lines of TypeScript. Matter.js would add a world, bodies, a fixed timestep, collision plumbing and a second coordinate system to keep in sync with the DOM. It also invites the wrong architecture: Matter's built-in renderer draws to a canvas, where Task text stops being text. You *can* run Matter headless and copy body positions onto DOM transforms, but then you are paying for a physics engine to do a job a few vectors can do.

**When to revisit:** if the owner later wants cards to pile up, collide and stack believably, or wants draggable Tasks with inertia, Matter.js or GSAP's Physics2D plugin becomes reasonable. Neither is needed for "they fly out and land".

### Why not PixiJS or WebGL?

PixiJS is a serious rendering engine, and its own docs describe it as built for "games, interactive ads, educational content, or data visualizations" on WebGL and optionally WebGPU ([PixiJS introduction](https://pixijs.com/8.x/guides/getting-started/intro)). It would make thousands of sparks trivial and would make full-screen shader distortion possible.

The cost is not only ~237 KB gzipped. It is:

- **Text stops being text.** Pixi renders its own text objects; the DOM accessibility and selection are gone.
- **A second scene graph.** Task positions, hover and focus would exist twice, once in DOM and once in Pixi, and would need syncing.
- **A harder learning curve.** Renderers, textures, containers, the ticker, the asset loader. That is time not spent learning the effects.
- **Phone battery and GPU memory.** A full-screen WebGL canvas is heavier than a transparent 2D overlay.

Pixi earns its place when the effect *is* the product, such as a game. Here the effect is decoration on a page of text.

**When to revisit:** if the design later calls for real glass refraction, heat haze that bends the text, or thousands of sprites, a Pixi filter or a small WebGL shader is the right tool. That is a deliberate later step, not the starting stack.

## How each effect works, in plain language

### 1. Flying and scattering Tasks

**What it really is:** changing an element's position and rotation over time, with the *feel* of weight. The browser does not know about weight. You fake it with acceleration, overshoot, a bounce and a settle.

**The trick that keeps the layout sane: FLIP.** FLIP stands for First, Last, Invert, Play:

1. **First:** measure where the Task is now with `getBoundingClientRect()`.
2. **Last:** change the DOM (insert the Task, reorder the list, remove one) and measure where it ended up.
3. **Invert:** apply a `transform` that puts it visually back at the old position.
4. **Play:** animate that transform to zero.

The element never leaves the document flow, so the rest of the Board lays out normally, and the movement is smooth because it is only a transform.

```ts
const first = el.getBoundingClientRect();
// ...change the DOM here...
const last = el.getBoundingClientRect();

el.animate(
  [
    { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)` },
    { transform: 'translate(0, 0)' },
  ],
  { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' },
);
```

**Scattering** is the same idea with the element temporarily taken out of flow:

1. Measure the card. Copy its position into a `position: fixed` (or absolutely positioned) layer.
2. Give it a velocity away from the click point, plus a random spin.
3. Each frame: `vy += gravity * dt`, `x += vx * dt`, `y += vy * dt`, and apply `transform: translate3d(x, y, 0) rotate(angle)`.
4. When it crosses the floor, bounce: `y = floor`, `vy *= -0.35`, `vx *= 0.8`, `spin *= 0.8`.
5. When speed and spin are below a threshold, stop the loop and leave it resting.
6. To rebuild, measure the resting position, put the card back in flow, and run FLIP in reverse.

A card that rotates more than a few degrees is harder to read. Before the Meltdown, keep the tilt small (roughly under 6°) and settle within a few hundred milliseconds. During the Meltdown, readability can degrade, but the text is still there.

**Collisions:** skip them at first. Cards passing through each other is barely noticeable in a chaotic scatter. If they matter, a pairwise check over ten to thirty cards is cheap; do not reach for a physics engine unless stacking becomes the point.

**What to avoid:** animating `top`, `left`, `width` or `margin`. Those force layout on every frame. Animate `transform` and `opacity`, which the browser can hand to the compositor ([web.dev animation guide](https://web.dev/articles/animations-guide)).

### 2. Burning Tasks and fire

**What it really is:** fire is not one object. It is a process: heat, light, rising gas and smoke. The visual cues are:

- a bright, almost white core;
- yellow and orange around it, red at the edges;
- constant small flicker;
- upward motion, fast at the bottom, slower at the top;
- short-lived particles, constantly replaced;
- a little smoke, which is dark and slow.

Trying to animate a "fire shape" usually looks like a lava lamp. Layering many cheap things looks like fire.

**A three-layer build:**

1. **The body of the fire (CSS).** Two or three small `div`s with radial gradients, `mix-blend-mode: screen` and a fixed `filter: blur()`. Animate their `transform` (scale, slight skew, small position changes) and `opacity`. Do **not** animate the blur radius; that repaints a large area every frame.
2. **The embers and sparks (Canvas 2D).** Spawn particles at the base with upward velocity, a little sideways wobble, drag and a short life. Colour them by age: white-yellow → orange → red → transparent. Draw with `globalCompositeOperation = 'lighter'`, which adds colours together and makes overlaps glow ([MDN compositing](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)).
3. **The smoke (Canvas 2D or CSS).** A few large, dark, slow, low-opacity circles that drift up and fade. Smoke is what makes fire read as hot rather than as a sticker.

**Making a Task look burned:** do not literally set it on fire. Reveal a charred version of the same card through an animated mask, or animate a `clip-path`/`mask-position` so the "burn line" climbs the card. The text underneath can darken and the card edge can glow. Keep the Task readable until the Meltdown; before that, a heat shimmer or a glowing border is enough.

**A cheap and effective alternative:** if the fire is small, skip the canvas body and use only the CSS glow plus a few embers. At desk distance, a blurred orange blob that flickers reads as fire surprisingly well.

**No files needed.** Fire, embers and smoke can all be generated from numbers. That avoids a video asset, a sprite sheet and the rights questions that come with someone else's fire footage.

### 3. Cracked glass

**What it really is:** a pattern of lines, not a material. A real impact makes:

- **radial cracks** running outward from the impact point;
- **concentric cracks** joining them in rough rings;
- **short branches** off the main lines;
- a few **shards**, which are polygons between the lines.

That is drawable as SVG in a few dozen paths.

**How to build it:**

1. Pick an impact point. Seed a small random generator with the Meltdown's seed so the same Meltdown looks the same if it is replayed, but two Meltdowns differ.
2. Generate 6-10 radial paths. Each starts at the impact and walks outward in short segments, nudging the angle slightly each step. Add one or two short branches.
3. Generate 2-3 concentric rings as jagged polygons around the impact.
4. Draw each line twice: a dark, slightly offset copy for depth, then a thin white copy for the highlight.
5. Put the whole SVG over the Board with `pointer-events: none`.
6. Animate the cracks *drawing* by setting `stroke-dasharray` to the path length and animating `stroke-dashoffset` from that length to 0 over about 80-150 ms. `path.getTotalLength()` gives the number.
7. Add a brief white flash and a shake at the same moment. The flash goes through the shared counter in [The flash cap](#the-flash-cap). Do not blur or distort the Task text; the joke reads better when the crack is clearly *over* the page.

**Why SVG rather than canvas or a shader:** SVG is resolution-independent, easy to inspect in DevTools, and each crack is a real element you can animate or remove. A shader could refract the page behind the glass, which is prettier, but it is the hardest option and it would require rendering the page into a texture. Not worth it for the first version.

**Watch out:** a full-screen crack overlay with hundreds of shards can become a lot of DOM. Keep it to tens of paths, or draw the shards on a canvas if the count grows.

### 4. Screen shake

**What it really is:** moving the whole picture a few pixels in a random direction, many times per second, then letting the movement die down.

The classic game technique is **trauma**:

- An impact adds to a `trauma` value between 0 and 1.
- Each frame, trauma decays a little.
- The actual offset uses `trauma * trauma`, so small impacts are subtle and big ones are violent.

```ts
let trauma = 0;

export function addShake(amount: number) {
  trauma = Math.min(1, trauma + amount);
}

function frame(dt: number) {
  trauma = Math.max(0, trauma - dt * 1.4);
  const amp = trauma * trauma;
  const x = (Math.random() * 2 - 1) * amp * 8;
  const y = (Math.random() * 2 - 1) * amp * 8;
  const r = (Math.random() * 2 - 1) * amp * 0.4;
  boardWrapper.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${r}deg)`;
}
```

For a single impact, a short Web Animations API keyframe sequence with decreasing offsets is enough and needs no rAF loop. For continuous Meltdown rumble, the trauma loop is simpler.

**Rules:**

- Shake one wrapper, not `<body>`. Shaking `<body>` moves scrollbars and fixed controls.
- Keep desktop shake small: a few pixels and a fraction of a degree. At the Meltdown, up to roughly 10 px is plenty.
- Do not put the mute button inside the shaking wrapper.
- Stop completely when trauma reaches zero, so the page is not left with a stale transform.
- Under reduced motion: no positional shake at all. Use a one-frame border or brightness pulse instead.

### 5. Sparks

**What it really is:** the same particle system as embers, with different numbers: faster, straighter, shorter-lived and brighter.

Each spark needs:

```ts
type Spark = {
  x: number; y: number;
  px: number; py: number;   // previous position, for the streak
  vx: number; vy: number;
  life: number;             // seconds remaining
  maxLife: number;
  size: number;
};
```

Each frame:

1. Save the old position.
2. Apply gravity, drag and a little randomness.
3. Move.
4. Reduce life.
5. Draw a line from `(px, py)` to `(x, y)`, with `lineWidth` shrinking as life runs out.
6. Recycle the object when life hits zero.

**Why it looks like sparks:** the streak, not the dot. A fast-moving line with a bright head reads as a spark; a circle reads as a bubble. Additive blending (`'lighter'`) makes overlapping sparks glow white.

**Practical rules:**

- **Preallocate a pool** of, say, 400 particles. Do not create objects every frame; garbage collection causes visible stutters.
- **One loop** updates every particle system.
- **Clamp `dt`** to about 50 ms. If the tab was hidden for ten seconds, do not simulate ten seconds of physics in one frame.
- **Clear the whole canvas** each frame with `clearRect`, then draw. Do not fill it with translucent black to make trails; that would darken the DOM underneath.
- **Cap the device pixel ratio at 2** and scale the context, so a 3× phone screen does not use nine times the pixels of a 1× screen ([MDN canvas optimisation](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)).
- **Avoid `shadowBlur`.** It is one of the most expensive canvas features. A glow comes from additive blending and colour, not shadows.
- **Pause when hidden.** `requestAnimationFrame` is already paused in background tabs in most browsers ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)), but also stop spawning when `document.visibilityState !== 'visible'`.
- **Do not reach for a worker yet.** If hundreds of particles ever start blocking the main thread, `OffscreenCanvas` in a worker is the next step. For a Board-sized particle count, one main-thread canvas is simpler and fast enough.

### 6. Flickering lights

**What it really is:** a light source changing brightness irregularly. The trick is irregularity. A smooth sine wave looks like a pulsing screensaver; a lamp looks like it is failing.

**The cheapest version is CSS:**

```css
@keyframes lamp-flicker {
  0%, 17%, 21%, 24%, 52%, 56%, 100% { opacity: 0.18; }
  19%, 23%, 54% { opacity: 0.75; }
  70% { opacity: 0.3; }
}

.lamp-glow {
  animation: lamp-flicker 4.2s steps(1, end) infinite;
  animation-delay: -1.7s;
}
```

Use an overlay with a radial gradient, or a warm box around a light. Animate `opacity`, not `box-shadow` or `filter: brightness()` on a large element; those repaint.

**To stop it looking like a loop:**

- Use two overlays with different durations (for example 3.7 s and 5.3 s) so the pattern takes a long time to repeat.
- Give each a negative `animation-delay` so they do not start together.
- Let JavaScript randomise the duration and delay when the stage changes.
- Reserve the strongest flicker for short bursts around impacts, not constant.

**Local vs full-screen:** a small lamp glow is not a full-screen flash. But a sudden full-screen brightness jump *is* a flash, and it must go through the shared flash counter below. When in doubt, treat it as a flash.

## Keeping the effects from turning into mud

### One stage, one set of effects

The stage already lives in the Board's state. Effects should read it, not invent their own escalation. A sensible mapping:

| Stage | What the effects layer adds |
|---|---|
| **Calm** | Nothing persistent. A small pop when a Task is added. |
| **Uneasy** | Occasional lamp flicker, a slow 1-2 px drift, a faint warm glow on high-Estimate Tasks. |
| **Stressed** | More frequent flicker, a small shake on add, a few sparks, the first hairline cracks at the screen edge. |
| **Unhinged** | Low continuous rumble, embers, cracks spreading, Tasks wobble and settle when added. Still readable. |
| **Meltdown** | The full montage for 10-20 seconds, then wreckage: flicker, occasional sparks, cracked overlay, twitching. New Tasks trigger a short burst. |
| **Back below 100%** | Reverse or quickly rebuild: cracks retract, particles stop, cards FLIP back into place, lights steady. |

The exact amounts are tuning work for [issue #8](https://github.com/Kevin-RB/rage-board/issues/8) and [issue #9](https://github.com/Kevin-RB/rage-board/issues/9). The important part is that **all stages share the same primitives**. A flicker is the same flicker at every stage, just more frequent. A crack is the same generator, just more lines. That keeps the code small and makes the escalation feel coherent.

### Make the Meltdown vary

The Meltdown is a composition, not a fixed video. Build it from small functions:

- `hitMarker()`
- `shake(intensity)`
- `flash(colour)`
- `crack(seed, impactPoint)`
- `burst(sparks, count)`
- `fireAt(x, y, duration)`
- `caption(text, position)`

Then the six variant sketches from [the montage research](https://github.com/Kevin-RB/rage-board/blob/research/mlg-montage/research/mlg-montage.md) become different **orders and selections** of those functions, with a random seed. The Task that crossed 100% supplies the content. GSAP's timeline can seek, reverse and change `timeScale`, which is exactly what a montage needs (slow motion, stutter, replay).

### Do not use separate clocks

Audio will eventually need to line up with the visuals. The browser's audio clock is `AudioContext.currentTime`; the visual timeline is `document.timeline.currentTime`, which is the same timestamp `requestAnimationFrame` receives ([MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)). They are different clocks, so at the start of the Meltdown record both and map elapsed time rather than assuming the numbers match. Keep one source of truth for "when did the Meltdown start" and pass elapsed time into the effects. [Issue #3](https://github.com/Kevin-RB/rage-board/issues/3) owns the audio side.

## Safety rails

### The flash cap

The map's rule is **no more than three full-screen flashes in any one second**. That matches WCAG 2.3.1, which says pages must not contain anything that flashes more than three times in any one-second period, or must stay below the general flash and red flash thresholds ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)). It is a Level A criterion, and it applies to the whole page, not just the part being tested.

The simplest correct implementation is one shared gate. Every flash — strobe, red kill flash, explosion, a sudden full-screen colour-grade jump — calls it:

```ts
const recent: number[] = [];

export function flashAllowed(now = performance.now()): boolean {
  while (recent.length > 0 && now - recent[0] > 1000) {
    recent.shift();
  }
  if (recent.length >= 3) {
    return false;
  }
  recent.push(now);
  return true;
}
```

If the answer is no, the effect **skips** or uses a non-flash alternative. It must not queue the flash and fire three of them a moment later. A sliding window like this is stricter than counting per fixed second, which is what you want.

The montage research's tempo arithmetic is a useful sanity check: at 140 bpm, one flash per beat is 2.3 per second, which fits; one flash per half-beat is 4.7 per second, which does not. Let shake, zoom and hit markers carry the faster rhythm.

Two details:

- **The cap is about area and brightness too.** WCAG's general flash threshold involves a large enough area (on the scale of a 341 × 256 CSS-pixel block, the central 10-degree field of view) and a big enough luminance change. A tiny spark is not a flash. But the map's rule is simpler and safer: anything that feels like a full-screen flash goes through the gate.
- **Do not rely on the cap alone.** Rapid red flashes are more provocative than other colours, and WCAG has a separate red-flash threshold. Keep red flashes rare and short.

### Reduced motion

`prefers-reduced-motion: reduce` is widely available and is the standard signal for this ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)). Read it in **both** places:

- CSS: a media query that turns off keyframe flicker and CSS transitions.
- TypeScript: a `matchMedia` listener that tells the canvas and GSAP what to do. CSS cannot stop a particle loop.

```ts
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let mode: 'full' | 'calm' = motionQuery.matches ? 'calm' : 'full';

motionQuery.addEventListener('change', (event) => {
  mode = event.matches ? 'calm' : 'full';
  effects.setMode(mode);
});
```

What "calm" should mean, effect by effect:

| Effect | Normal | Under reduced motion |
|---|---|---|
| Flying / scattering | Travel, spin, bounce | Position changes instantly or with a short opacity fade; no travel |
| Screen shake | Random offset each frame | None; a brief static border or tint |
| Fire | Moving flames and embers | A steady warm glow; no particle motion |
| Sparks | Bursts of streaks | None |
| Cracked glass | Cracks draw outward over ~100 ms | Cracks appear already drawn |
| Flickering lights | Irregular flicker | Steady low light, no flicker |
| Flash | Up to 3 per second | No full-screen flashes |
| Meltdown | Full montage | Still a sequence, but of still cards and captions with hard cuts |

Reduced motion does not have to mean "no joke". The Fake Calm and Funeral variants from the montage research work well as static cards. WCAG 2.3.3 also asks that interaction-triggered motion can be disabled unless it is essential ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)); the Board's motion is decoration, so it should yield.

Keep the flash cap even in calm mode, in case a future effect bypasses the motion check.

## Performance on phones

All of these APIs are widely available, but "available" is not "fast on a five-year-old phone". Budget for **60 fps on desktop and 30 fps on a phone**, and design the effects so quality can drop without the joke disappearing.

### A quality ladder

Start at full quality, measure, and step down if the frame time is consistently over budget:

1. **Full:** both canvases, 400 sparks, fire, shake, cracks, flicker.
2. **Reduced:** halve particle counts, drop smoke, simplify cracks, cap DPR at 1.5.
3. **Minimal:** static fire glow, no sparks, no shake, CSS flicker only.

Do not guess from `navigator.hardwareConcurrency` alone; it is a rough hint, not a measurement. Use it to pick a starting tier, then sample real frame times for the first second or two and adjust. `matchMedia('(pointer: coarse)')` is a reasonable signal that the device is touch-first, but a laptop with a touchscreen also matches.

### What to drop first

In order:

1. Full-screen `backdrop-filter` and large `filter: blur()` surfaces.
2. Particle count.
3. Smoke and secondary embers.
4. Crack shards (keep the main radial lines).
5. Shake amplitude.
6. Continuous fire → a static glow.

Never drop: the flash cap, the reduced-motion branch, or the DOM text.

### Phone-specific advice

- Cap canvas DPR at 2, or 1.5 on the minimal tier. A 3× screen has nine times the pixels of a 1× screen.
- Avoid `backdrop-filter` on phones; it is expensive and inconsistent.
- Keep the canvas transparent but only as large as the viewport; do not allocate a 4K buffer "just in case".
- Test with the phone's real browser, not only desktop DevTools emulation. Emulation does not reproduce GPU limits or thermal throttling.
- Low-power modes and thermal throttling can change frame rates. The quality ladder should adapt at runtime, not assume a fixed device.
- Pause all spawning when hidden, and stop the loop entirely when there is nothing to draw. An idle Board should not burn battery.

### What to measure

Use the browser's Performance panel with 4× or 6× CPU throttling and look for:

- long frames during the Meltdown;
- layout or paint bars in the flame chart (a sign you animated the wrong property);
- garbage collection spikes (a sign of per-frame allocations);
- dropped frames when many sparks and a shake happen together.

The exact particle counts in this document are starting points, not verified limits. The only trustworthy number is the one measured on the target phone.

## A learning order for the owner

The stack is deliberately layered so each step teaches one idea and produces something visible. Do not start with the Meltdown.

1. **CSS: one Task pops in.** Learn `transform`, `opacity`, `transition`, easing and `@media (prefers-reduced-motion: reduce)`. Success: adding a Task feels alive, and it still works with motion off.
2. **Web Animations API: shake and fly.** Learn `element.animate()`, keyframes, `fill`, `finished`, and how to cancel an animation. Success: a click makes the Board flinch, and a new Task flies in.
3. **Canvas: sparks.** Learn `requestAnimationFrame`, delta time, a particle pool, `clearRect`, `globalCompositeOperation = 'lighter'` and DPR scaling. Success: 200 sparks at a steady frame rate, with no allocations per frame.
4. **A tiny physics loop: scatter.** Learn velocity, gravity, drag, bounce and settle. Add FLIP so the layout survives. Success: ten Task cards scatter and come to rest, then rebuild.
5. **GSAP: the 15-second Meltdown.** Learn `gsap.timeline()`, labels, the position parameter (`"+=1"`, `"<"`), `timeScale()` and `matchMedia()`. Success: a sequence that can be paused, reversed and replayed.
6. **SVG: cracked glass.** Learn paths, `getTotalLength()`, `stroke-dasharray` and `stroke-dashoffset`. Success: a crack that draws outward from the impact point and can be regenerated with a new seed.
7. **Integration: stages, flash guard, quality tiers.** Learn how the Board's state drives the effects, and how to degrade gracefully. Success: the page gets worse in a controlled way as Overload rises, and calms down again when it falls.

Each step is a small standalone page or a hidden route in the worktree. The owner can throw each one away; the point is the lesson, not the artifact.

## What was measured

On 2026-11-05, I downloaded the published npm tarballs and measured the minified browser files with `gzip -9`:

| Package | Version | Published | Licence | Minified | Gzipped |
|---|---|---|---:|---:|---:|
| gsap (`dist/gsap.min.js`) | 3.15.1 | 2026-11-04 | Standard "no charge" licence | 73,357 B | 28,415 B |
| gsap, tree-shaken `import { gsap }` via esbuild | 3.15.1 | — | — | 71,134 B | **27,688 B** |
| matter-js (`build/matter.min.js`) | 0.20.0 | 2024-06-23 | MIT | 83,476 B | 25,784 B |
| pixi.js (`dist/pixi.min.js`) | 8.22.0 | 2026-10-01 | MIT | 840,663 B | 236,838 B |
| animejs (`dist/bundles/anime.esm.min.js`) | 4.5.0 | 2026-06-22 | MIT | 118,678 B | 40,836 B |
| canvas-confetti (`dist/confetti.module.mjs`) | 1.9.4 | 2025-10-25 | ISC | 24,924 B | 6,903 B |
| Vite | 8.3.5 | 2026-10-21 | MIT | — | — |
| TypeScript | 7.0.2 | 2026-07-08 | Apache-2.0 | — | — |

The GSAP tree-shaken check was a two-line esbuild entry (`import { gsap } from 'gsap'`), bundled with `--bundle --minify --format=esm`. It was done in a throwaway folder inside the research worktree and deleted afterwards. No app was built.

The GSAP licence is **not** an open-source licence. It is a free-of-charge proprietary licence from Webflow. The official FAQ says commercial use is covered and that formerly members-only plugins are now free; the restriction is on using GSAP to build a visual animation tool that competes with Webflow ([GSAP standard licence](https://gsap.com/standard-license/)). A public joke site is nowhere near that restriction. This is a factual note, not legal advice.

**Sizes are not the whole cost.** A library that adds 28 KB but saves days of timeline plumbing is a good trade. A library that adds 237 KB and forces the Task text out of the DOM is not.

## What I could not verify

- **Real frame rates on the owner's desktop and phone.** No device testing was done. The particle counts and quality tiers are reasoned starting points, not measured limits.
- **The exact Vite production bundle sizes.** Only GSAP was bundled in a throwaway esbuild check. The other figures are published minified files, which can differ after tree-shaking and compression.
- **Whether animating a CSS mask for the burn effect is smooth in every target browser.** The technique is sound, but it should be prototyped on Safari and on a phone before it becomes central.
- **Safari's behaviour with large SVG overlays and `backdrop-filter`.** Not tested. The recommendation avoids `backdrop-filter` for that reason.
- **Matter.js's current maintenance activity.** Its latest published release is 0.20.0 from June 2024; I did not audit its issue tracker or commit history, so "less active" would be an inference, not a finding.
- **Any claim of WCAG conformance.** This document checks the flash and motion criteria only. Colour contrast, focus, keyboard access and the rest of WCAG are outside this ticket.
- **Legal advice on GSAP's licence or on meme assets.** The licence summary is from GSAP's own page. Asset rights belong to [issue #6](https://github.com/Kevin-RB/rage-board/issues/6).

## Questions this raises for the map

1. **How literal is "Tasks remain real text until the Meltdown"?** The recommendation keeps them as DOM text *during* the Meltdown too, just harder to read. Rasterising them for a full-screen shader would be a one-way door. If the owner wants a true glass-refraction effect later, that trade-off needs a decision, not an accident.
2. **Do Tasks actually burn away?** If a Task is destroyed by fire, the list loses a real item and the user needs a way to recover it. Safer: burn a visual clone while the real Task stays in the list until the user completes or removes it. This affects [issue #8](https://github.com/Kevin-RB/rage-board/issues/8) and the wreckage state.
3. **What is exclusive to the Meltdown?** If earlier stages already use fire, cracks and big shakes, the Meltdown has less room to escalate. I would reserve fire, cracked glass and full-screen shake for Unhinged and above, and let earlier stages use flicker, small shakes and sparks.
4. **Is 30 fps acceptable on a phone?** The map calls mobile a secondary target. A 30 fps quality tier is a reasonable compromise; a 60 fps requirement would force much smaller effects. [Issue #9](https://github.com/Kevin-RB/rage-board/issues/9) should decide.
5. **Does the owner want a visible "Calm mode" switch as well as the system setting?** WCAG 2.3.3 accepts either a user-agent preference or a site control. A small toggle would also let coworkers opt out without changing their OS, but it adds UI the map has not specified.

## Sources

**Platform and accessibility**

- [MDN: Using the Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API) — `Element.animate()`, keyframes, playback control, `document.getAnimations()`.
- [MDN: `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) — what the setting means and how to honour it.
- [MDN: `requestAnimationFrame()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) — one-shot callback, timestamps, background-tab pausing, delta-time warning.
- [MDN: Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) — DPR scaling, layering, avoiding `shadowBlur`, using rAF.
- [MDN: `globalCompositeOperation`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation) — `'lighter'`, `'screen'` and the other blend modes.
- [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide) — animate `transform` and `opacity`, avoid layout and paint.
- [W3C: Understanding SC 2.3.1, Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) — the 3-per-second rule and the general flash threshold.
- [W3C: Understanding SC 2.3.3, Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — motion triggered by interaction must be disableable.

**Libraries**

- [GSAP Timeline docs](https://gsap.com/docs/v3/GSAP/Timeline/) — sequencing, labels, position parameter, nesting, `timeScale`.
- [GSAP standard licence](https://gsap.com/standard-license/) — free for commercial use, not open source, visual-builder restriction.
- [Matter.js README](https://github.com/liabru/matter-js) — features, canvas renderer, MIT licence.
- [PixiJS introduction](https://pixijs.com/8.x/guides/getting-started/intro) — WebGL/WebGPU renderer, intended use, features.
- [Anime.js documentation](https://animejs.com/documentation/) — timelines, WAAPI sync, dragging, MIT licence.
- [Vite guide](https://vite.dev/guide/) — dev server and build tool.

**Versions and licences**

- npm registry metadata for `gsap`, `matter-js`, `pixi.js`, `animejs`, `canvas-confetti`, `vite` and `typescript`, read on 2026-11-05 via `https://registry.npmjs.org/<package>`.

**Project context**

- [Rage Board map, issue #1](https://github.com/Kevin-RB/rage-board/issues/1)
- [GLOSSARY.md](https://github.com/Kevin-RB/rage-board/blob/main/GLOSSARY.md)
- [MLG montage research, issue #5](https://github.com/Kevin-RB/rage-board/blob/research/mlg-montage/research/mlg-montage.md)
- [Astro and Coolify research, issue #4](https://github.com/Kevin-RB/rage-board/blob/research/astro-coolify/research/astro-coolify.md)
