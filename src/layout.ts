// Works out where every note goes. Notes stay real page text; this only returns rectangles.

/** A position as a fraction of the room left on the wall, so it survives resizing. */
export type Spot = { x: number; y: number };

export type Task = {
  id: number;
  title: string;
  minutes: number;
  color: string;
  /** Where the owner dropped it. */
  pin?: Spot;
  /** Where it first landed, kept so it doesn't jump when other Tasks change. */
  spot?: Spot;
};

export type Placed = { task: Task; x: number; y: number; rot: number };

/** Repeatable randomness, so a note keeps its tilt between redraws. */
function rng(seed: number): () => number {
  let s = seed * 2654435761;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const noteSize = (w: number, h: number) => Math.min(300, Math.max(130, Math.min(w, h) * 0.26));

/**
 * Square notes land at the emptiest of a few random spots. While there's room they barely
 * touch, so the Board starts out orderly and overlaps more as it fills up.
 */
export function layOut(tasks: Task[], w: number, h: number): Placed[] {
  const size = noteSize(w, h);
  const roomX = Math.max(0, w - size);
  const roomY = Math.max(0, h - size);
  const taken: { x: number; y: number }[] = [];

  const overlapWithTaken = (x: number, y: number) =>
    taken.reduce((sum, o) => {
      const dx = size - Math.abs(o.x - x);
      const dy = size - Math.abs(o.y - y);
      return dx > 0 && dy > 0 ? sum + dx * dy : sum;
    }, 0);

  return tasks.map((task) => {
    const r = rng(task.id);
    const rot = (r() - 0.5) * 10;
    let spot = task.pin ?? task.spot;
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
      task.spot = spot;
    }
    const x = spot!.x * roomX;
    const y = spot!.y * roomY;
    taken.push({ x, y });
    return { task, x, y, rot };
  });
}
