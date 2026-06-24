/*
 * Seat geometry for 2-9 players. The hero is always pinned bottom-center; the
 * rest are spread evenly around the rim of an ellipse. Returned as percentages
 * so the felt's aspect-ratio handles responsiveness and the renderer just sets
 * left%/top%. Pure → unit tested (no DOM).
 *
 * Angles use the math convention (0°=right, 90°=up). Hero sits at 270° (bottom);
 * the others step clockwise by an equal slice, which yields the familiar
 * symmetric poker-table arc for every seat count.
 */

export interface SeatPos {
  /** 0-100, percent of the felt width. */
  readonly xPct: number;
  /** 0-100, percent of the felt height. */
  readonly yPct: number;
}

const RX = 45; // horizontal radius (% of felt)
const RY = 41; // vertical radius (% of felt)
const CENTER = 50;

/** Seat positions, index 0 = hero at bottom-center. */
export function seatPositions(count: number): SeatPos[] {
  const n = Math.max(1, count);
  const out: SeatPos[] = [];
  for (let i = 0; i < n; i++) {
    const deg = 270 - (360 * i) / n; // start at the bottom, step clockwise
    const rad = (deg * Math.PI) / 180;
    out.push({
      xPct: round1(CENTER + RX * Math.cos(rad)),
      yPct: round1(CENTER - RY * Math.sin(rad)),
    });
  }
  return out;
}

/**
 * Shrink seats/cards when the table is crowded so 9 plates don't overlap. Used
 * to set the CSS `--seat-scale` custom property.
 */
export function seatScale(count: number): number {
  if (count <= 6) return 1;
  if (count === 7) return 0.9;
  if (count === 8) return 0.82;
  return 0.75;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
