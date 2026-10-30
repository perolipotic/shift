/**
 * A tiny rasterizer for the icon facade's SVGs (story 15.1), so a test can ask
 * what a mark looks like at the size it is DRAWN rather than what its source
 * text says.
 *
 * WHY HERE AND NOT A LIBRARY. Phosphor's core files hold one `viewBox="0 0 256
 * 256"` and `<path d>` elements, nothing else (`icon.tsx` throws on anything
 * more), and the browser fills them with the nonzero rule. That is small enough
 * to do exactly: parse the path data (M L H V C S Q T A Z, both cases), flatten
 * curves and arcs into polygons, and sample each pixel on a supersampled grid
 * with the nonzero winding rule. No native module, no new dependency, and the
 * root suite stays node-only (AD-15).
 *
 * The result is a coverage mask: one number in [0, 1] per pixel, row-major.
 */

type Point = readonly [number, number];

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/** The path data as commands with their numbers. */
function tokens(d: string): { command: string; args: number[] }[] {
  const out: { command: string; args: number[] }[] = [];
  let at = 0;

  while (at < d.length) {
    const char = d[at] ?? '';
    if (/[MLHVCSQTAZmlhvcsqtaz]/.test(char)) {
      out.push({ command: char, args: [] });
      at += 1;
      continue;
    }
    if (/[\s,]/.test(char)) {
      at += 1;
      continue;
    }
    NUMBER.lastIndex = at;
    const found = NUMBER.exec(d);
    if (found === null) throw new Error(`SVG_PATH_UNPARSEABLE at ${String(at)}: ${d.slice(at, at + 12)}`);
    const last = out.at(-1);
    if (last === undefined) throw new Error('SVG_PATH_NO_COMMAND');
    last.args.push(Number(found[0]));
    at = NUMBER.lastIndex;
  }

  return out;
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const STEPS = 24;

/** The arc from `from` to `to` (SVG 1.1 F.6.5), as points after `from`. */
function arc(from: Point, rx0: number, ry0: number, angle: number, large: number, sweep: number, to: Point): Point[] {
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [to];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1))) * (large === sweep ? -1 : 1);
  const cx1 = (root * rx * y1) / ry;
  const cy1 = (-root * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number): number => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));

    return sign * Math.acos(Math.min(1, Math.max(-1, dot)));
  };
  const start = angleOf(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * STEPS));
  const points: Point[] = [];
  for (let index = 1; index <= steps; index += 1) {
    const theta = start + (delta * index) / steps;
    const ex = rx * Math.cos(theta);
    const ey = ry * Math.sin(theta);
    points.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }

  return points;
}

/** The path as closed polygons, in viewBox units. */
export function polygonsOf(d: string): Point[][] {
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let control: Point | null = null;
  let previous = '';

  const close = (): void => {
    if (current.length > 1) polygons.push(current);
    current = [];
  };
  const cubic = (c1: Point, c2: Point, end: Point): void => {
    for (let index = 1; index <= STEPS; index += 1) {
      const t = index / STEPS;
      const u = 1 - t;
      current.push([
        u * u * u * pen[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
        u * u * u * pen[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
      ]);
    }
  };
  const quadratic = (c: Point, end: Point): void => {
    for (let index = 1; index <= STEPS; index += 1) {
      const t = index / STEPS;
      const u = 1 - t;
      current.push([u * u * pen[0] + 2 * u * t * c[0] + t * t * end[0], u * u * pen[1] + 2 * u * t * c[1] + t * t * end[1]]);
    }
  };

  for (const { command, args } of tokens(d)) {
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const arity = ARITY[upper] ?? 0;
    if (arity === 0) {
      close();
      pen = start;
      previous = upper;
      control = null;
      continue;
    }
    for (let at = 0; at < args.length; at += arity) {
      const a = args.slice(at, at + arity);
      const ox = relative ? pen[0] : 0;
      const oy = relative ? pen[1] : 0;
      let kind = upper;
      if (kind === 'M' && at > 0) kind = 'L';
      switch (kind) {
        case 'M': {
          close();
          pen = [(a[0] ?? 0) + ox, (a[1] ?? 0) + oy];
          start = pen;
          current = [pen];
          control = null;
          break;
        }
        case 'L':
        case 'H':
        case 'V': {
          const end: Point =
            kind === 'L'
              ? [(a[0] ?? 0) + ox, (a[1] ?? 0) + oy]
              : kind === 'H'
                ? [(a[0] ?? 0) + ox, pen[1]]
                : [pen[0], (a[0] ?? 0) + oy];
          current.push(end);
          pen = end;
          control = null;
          break;
        }
        case 'C':
        case 'S': {
          const c1: Point =
            kind === 'C'
              ? [(a[0] ?? 0) + ox, (a[1] ?? 0) + oy]
              : control !== null && /[CS]/.test(previous)
                ? [2 * pen[0] - control[0], 2 * pen[1] - control[1]]
                : pen;
          const rest = kind === 'C' ? a.slice(2) : a;
          const c2: Point = [(rest[0] ?? 0) + ox, (rest[1] ?? 0) + oy];
          const end: Point = [(rest[2] ?? 0) + ox, (rest[3] ?? 0) + oy];
          cubic(c1, c2, end);
          control = c2;
          pen = end;
          break;
        }
        case 'Q':
        case 'T': {
          const c: Point =
            kind === 'Q'
              ? [(a[0] ?? 0) + ox, (a[1] ?? 0) + oy]
              : control !== null && /[QT]/.test(previous)
                ? [2 * pen[0] - control[0], 2 * pen[1] - control[1]]
                : pen;
          const rest = kind === 'Q' ? a.slice(2) : a;
          const end: Point = [(rest[0] ?? 0) + ox, (rest[1] ?? 0) + oy];
          quadratic(c, end);
          control = c;
          pen = end;
          break;
        }
        case 'A': {
          const end: Point = [(a[5] ?? 0) + ox, (a[6] ?? 0) + oy];
          current.push(...arc(pen, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0, a[4] ?? 0, end));
          pen = end;
          control = null;
          break;
        }
        default:
          throw new Error(`SVG_PATH_COMMAND ${command}`);
      }
      previous = kind;
    }
  }
  close();

  return polygons;
}

/** The nonzero winding number of `point` against every polygon. */
function winding(polygons: readonly Point[][], x: number, y: number): number {
  let total = 0;
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const [x0, y0] = polygon[index] as Point;
      const [x1, y1] = polygon[(index + 1) % polygon.length] as Point;
      if (y0 <= y) {
        if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) total += 1;
      } else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) {
        total -= 1;
      }
    }
  }

  return total;
}

/**
 * The coverage of each pixel when the paths are drawn in a `size`×`size` px
 * box, sampled `samples`×`samples` times per pixel with the nonzero rule.
 */
export function coverage(paths: readonly string[], size: number, samples = 4): number[] {
  const polygons = paths.flatMap((d) => polygonsOf(d));
  const scale = 256 / size;
  const mask: number[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (column + (sx + 0.5) / samples) * scale;
          const y = (row + (sy + 0.5) / samples) * scale;
          if (winding(polygons, x, y) !== 0) hits += 1;
        }
      }
      mask.push(hits / (samples * samples));
    }
  }

  return mask;
}

/** A coverage mask thresholded at half a pixel, as the eye reads a small mark. */
export function filled(mask: readonly number[]): boolean[] {
  return mask.map((value) => value >= 0.5);
}

/** The share of the box a thresholded mask fills. */
export function fillRatio(mask: readonly boolean[]): number {
  return mask.filter(Boolean).length / mask.length;
}

/** The share of pixels inked in either mask that differ between the two. */
export function difference(one: readonly boolean[], other: readonly boolean[]): number {
  let differ = 0;
  let either = 0;
  for (let index = 0; index < one.length; index += 1) {
    if (one[index] === true || other[index] === true) either += 1;
    if (one[index] !== other[index]) differ += 1;
  }

  return either === 0 ? 0 : differ / either;
}
