// Works out where every Task card goes for each crowding strategy.
// Every strategy returns plain rectangles, so the cards stay real page text
// and strategies can be swapped live without touching the rendering.

/** A position as a fraction of the room left on the wall, so it survives resizing. */
export type Spot = { x: number; y: number };

export type Task = {
  id: number;
  title: string;
  minutes: number;
  color: string;
  /** Where the owner dropped it. Wins over any strategy. */
  pin?: Spot;
  /** Where it first landed in the pile, kept so it doesn't jump when other Tasks change. */
  spot?: Spot;
};
export type Strategy = "hybrid" | "hours" | "columns" | "shrink" | "scroll" | "pile";

export type Placed = {
  task: Task;
  x: number;
  y: number;
  w: number;
  h: number;
  font: number;
  lines: number;
  rot: number;
  piled: boolean;
};

export type Layout = {
  cards: Placed[];
  /** Height of the content when it is taller than the wall (scrolling only). */
  contentHeight: number;
  /** Size of one 15 minute slot, when the wall is drawn as a grid of the Shift. */
  slot?: { w: number; h: number };
};

type Ctx = { w: number; h: number; maxFont: number; floor: number; gap: number; maxCols: number };

/** Repeatable randomness, so a Task keeps its spot in the pile between redraws. */
function rng(seed: number): () => number {
  let s = seed * 2654435761;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARS = 30; // Typical title length the sizing aims to show in full.

/** Narrow cards put the Estimate under the title instead of beside it. */
export const isTall = (w: number, h: number) => w < h * 1.1;

/**
 * The largest font that fits a typical title in a box, trying 1 to 6 lines.
 * Sizes are in multiples of the font size: padding is 1.1 in total, a line is 1.2,
 * an average letter is 0.52 wide, and the Estimate takes 3 beside the title or 1.8 under it.
 */
function fit(w: number, h: number, maxFont: number, title = ""): { font: number; lines: number } {
  const tall = isTall(w, h);
  const extraH = tall ? 2.9 : 1.1;
  const extraW = tall ? 1.1 : 4.1;
  let best = 0;
  for (let lines = 1; lines <= 6; lines++) {
    const byHeight = h / (1.2 * lines + extraH);
    const byWidth = w / (extraW + (0.52 * CHARS) / lines);
    best = Math.max(best, Math.min(byHeight, byWidth));
  }
  // The longest word has to fit on one line, or it gets cut in half.
  const longestWord = Math.max(0, ...title.split(/\s+/).map((word) => word.length));
  const byWord = w / (extraW + 0.62 * longestWord);
  const font = Math.max(5, Math.min(best, maxFont, byWord));
  // The small nudge stops floating point turning an exact 3 lines into 2.
  return { font, lines: Math.max(1, Math.floor((h - extraH * font) / (1.2 * font) + 0.01)) };
}

function place(task: Task, x: number, y: number, w: number, h: number, c: Ctx, rot = 0, piled = false): Placed {
  return { task, x, y, w, h, rot, piled, ...fit(w, h, c.maxFont, task.title) };
}

function cell(n: number, cols: number, c: Ctx) {
  const rows = Math.ceil(n / cols);
  return {
    cols,
    w: (c.w - c.gap * (cols - 1)) / cols,
    h: Math.min((c.h - c.gap * (rows - 1)) / rows, c.h / 4),
  };
}

function bestGrid(n: number, c: Ctx) {
  let best = cell(n, 1, c);
  for (let cols = 2; cols <= c.maxCols; cols++) {
    const next = cell(n, cols, c);
    if (fit(next.w, next.h, c.maxFont).font > fit(best.w, best.h, c.maxFont).font) best = next;
  }
  return best;
}

function columns(tasks: Task[], c: Ctx): Layout {
  const g = bestGrid(Math.max(tasks.length, 1), c);
  const cards = tasks.map((t, i) =>
    place(t, (i % g.cols) * (g.w + c.gap), Math.floor(i / g.cols) * (g.h + c.gap), g.w, g.h, c),
  );
  return { cards, contentHeight: c.h };
}

function shrink(tasks: Task[], c: Ctx): Layout {
  const n = Math.max(tasks.length, 1);
  const gap = n > 30 ? 1 : c.gap;
  const h = Math.min((c.h - gap * (n - 1)) / n, c.h / 5);
  return { cards: tasks.map((t, i) => place(t, 0, i * (h + gap), c.w, h, c)), contentHeight: c.h };
}

function scroll(tasks: Task[], c: Ctx): Layout {
  const h = Math.max(c.maxFont * 2.4, 56);
  // Newest first: otherwise a new Task lands out of sight, below the fold.
  const newest = [...tasks].reverse();
  const cards = newest.map((t, i) => place(t, 0, i * (h + c.gap), c.w, h, c));
  return { cards, contentHeight: Math.max(c.h, tasks.length * (h + c.gap)) };
}

/**
 * Square notes that land at the emptiest of a few random spots. While there's room they
 * barely touch, so the Board starts out orderly and overlaps more as it fills up.
 */
function pile(tasks: Task[], c: Ctx): Layout {
  const size = Math.min(300, Math.max(130, Math.min(c.w, c.h) * 0.26));
  const roomX = Math.max(0, c.w - size);
  const roomY = Math.max(0, c.h - size);
  const taken: { x: number; y: number }[] = [];

  const overlapWithTaken = (x: number, y: number) =>
    taken.reduce((sum, o) => {
      const dx = size - Math.abs(o.x - x);
      const dy = size - Math.abs(o.y - y);
      return dx > 0 && dy > 0 ? sum + dx * dy : sum;
    }, 0);

  const cards = tasks.map((t) => {
    const r = rng(t.id);
    const rot = (r() - 0.5) * 10;
    let spot = t.pin ?? t.spot;
    if (!spot) {
      let best = Infinity;
      for (let i = 0; i < 30; i++) {
        const candidate = { x: r(), y: r() };
        const score = overlapWithTaken(candidate.x * roomX, candidate.y * roomY);
        if (score < best) {
          best = score;
          spot = candidate;
        }
      }
      t.spot = spot;
    }
    const x = spot!.x * roomX;
    const y = spot!.y * roomY;
    taken.push({ x, y });
    return place(t, x, y, size, size, c, rot, true);
  });
  return { cards, contentHeight: c.h };
}

/** Add columns and shrink down to a readable floor. After that, stop shrinking and overlap. */
function hybrid(tasks: Task[], c: Ctx): Layout {
  const n = Math.max(tasks.length, 1);
  const g = bestGrid(n, c);
  if (fit(g.w, g.h, c.maxFont).font >= c.floor) return columns(tasks, c);

  // The densest grid whose cards still hold a typical title at the floor font size.
  let base = cell(1, 1, c);
  let capacity = 1;
  for (let cols = 1; cols <= c.maxCols; cols++) {
    const w = (c.w - c.gap * (cols - 1)) / cols;
    const lines = [1, 2, 3, 4].find((l) => w / (4.1 + (0.52 * CHARS) / l) >= c.floor);
    if (!lines) break;
    const minH = c.floor * (1.2 * lines + 1.1);
    const rows = Math.max(1, Math.floor((c.h + c.gap) / (minH + c.gap)));
    if (cols * rows > capacity) {
      capacity = cols * rows;
      base = { cols, w, h: (c.h - c.gap * (rows - 1)) / rows };
    }
  }

  const slotX = (i: number) => (i % base.cols) * (base.w + c.gap);
  const slotY = (i: number) => Math.floor(i / base.cols) * (base.h + c.gap);
  const cards = tasks.map((t, i) => {
    if (i < capacity) return place(t, slotX(i), slotY(i), base.w, base.h, c);
    // Overflow lands on top of a random card, slightly off-square.
    const r = rng(t.id);
    const slot = Math.floor(r() * capacity);
    const x = Math.min(c.w - base.w, Math.max(0, slotX(slot) + (r() - 0.5) * base.w * 0.6));
    const y = Math.min(c.h - base.h, Math.max(0, slotY(slot) + (r() - 0.5) * base.h * 1.2));
    return place(t, x, y, base.w, base.h, c, (r() - 0.5) * 8, true);
  });
  return { cards, contentHeight: c.h };
}

/** The wall is the Shift: card area is the Estimate, and 100% Overload means no room left. */
function hours(tasks: Task[], shiftMinutes: number, c: Ctx): Layout {
  const totalSlots = Math.max(4, Math.round(shiftMinutes / 15));
  let cols = Math.max(2, Math.round(Math.sqrt((totalSlots * c.w) / c.h)));
  if (cols % 2) cols += 1; // Even columns keep 30m, 2h and 4h cards tiling cleanly.
  const rows = Math.ceil(totalSlots / cols);
  const unitW = c.w / cols;
  const unitH = c.h / rows;
  const used = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

  const free = (x: number, y: number, sw: number, sh: number) => {
    for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) if (used[y + dy][x + dx]) return false;
    return true;
  };

  const cards = tasks.map((t) => {
    const slots = Math.max(1, Math.round(t.minutes / 15));
    const sh = Math.min(rows, Math.max(1, Math.floor(Math.sqrt(slots))));
    const sw = Math.min(cols, Math.ceil(slots / sh));
    for (let y = 0; y <= rows - sh; y++) {
      for (let x = 0; x <= cols - sw; x++) {
        if (!free(x, y, sw, sh)) continue;
        for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) used[y + dy][x + dx] = true;
        const g = c.gap / 2;
        return place(t, x * unitW + g, y * unitH + g, sw * unitW - c.gap, sh * unitH - c.gap, c);
      }
    }
    // No room left: this hour doesn't exist, so the card lands on top of the others.
    const r = rng(t.id);
    const w = sw * unitW - c.gap;
    const h = sh * unitH - c.gap;
    return place(t, r() * (c.w - w), r() * (c.h - h), w, h, c, (r() - 0.5) * 8, true);
  });
  return { cards, contentHeight: c.h, slot: { w: unitW, h: unitH } };
}

export function layOut(
  strategy: Strategy,
  tasks: Task[],
  shiftMinutes: number,
  w: number,
  h: number,
  phone: boolean,
): Layout {
  const c: Ctx = {
    w,
    h,
    gap: phone ? 6 : 10,
    maxFont: phone ? 22 : Math.min(h * 0.06, 60),
    floor: phone ? 13 : 19,
    maxCols: phone ? 2 : 8,
  };
  const layout = byStrategy(strategy, tasks, shiftMinutes, c);
  for (const card of layout.cards) {
    const pin = card.task.pin;
    if (!pin) continue;
    card.x = pin.x * Math.max(0, w - card.w);
    card.y = pin.y * Math.max(0, h - card.h);
    card.piled = true;
  }
  return layout;
}

function byStrategy(strategy: Strategy, tasks: Task[], shiftMinutes: number, c: Ctx): Layout {
  switch (strategy) {
    case "hybrid": return hybrid(tasks, c);
    case "hours": return hours(tasks, shiftMinutes, c);
    case "columns": return columns(tasks, c);
    case "shrink": return shrink(tasks, c);
    case "scroll": return scroll(tasks, c);
    case "pile": return pile(tasks, c);
  }
}
