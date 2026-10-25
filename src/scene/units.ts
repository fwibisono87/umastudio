// Unit conversions and the standard photographic scales. See docs/DESIGN.md, "Units".

/** One MMD unit in metres. MMD models are authored at roughly 1 unit = 8 cm. */
export const MMD_UNIT_M = 0.08;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Full-stop ISO values a camera body offers. */
export const ISO_STOPS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800] as const;

/** Shutter speeds in 1/3 stops, seconds, slowest first. */
export const SHUTTER_STOPS = [
  30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1, 0.8, 0.6, 0.5, 0.4, 0.3,
  1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 13, 1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 40,
  1 / 50, 1 / 60, 1 / 80, 1 / 100, 1 / 125, 1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400,
  1 / 500, 1 / 640, 1 / 800, 1 / 1000, 1 / 1250, 1 / 1600, 1 / 2000, 1 / 2500, 1 / 3200,
  1 / 4000, 1 / 5000, 1 / 6400, 1 / 8000,
] as const;

/** Apertures in 1/3 stops, as engraved (f/1.4 ... f/32). */
export const APERTURE_STOPS = [
  1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13,
  14, 16, 18, 20, 22, 25, 29, 32,
] as const;

/** "1/125", "0.5\"", "2\"". Fractions under 1/3 s, decimal seconds otherwise. */
export function formatShutter(seconds: number): string {
  if (seconds < 0.3) return `1/${Math.round(1 / seconds)}`;
  return `${Number(seconds.toFixed(1))}"`;
}

/** "f/8", "f/5.6". */
export function formatAperture(n: number): string {
  return `f/${Number(n.toFixed(1))}`;
}

/** "1/1", "1/8", "1/8 +0.3" for a strobe set `stops` below full power. */
export function formatPowerStops(stops: number): string {
  const whole = Math.floor(stops + 1e-6);
  const tenth = Math.round((stops - whole) * 10) / 10;
  const base = `1/${2 ** whole}`;
  // A fractional setting sits between two whole stops; show it relative to the brighter one.
  return tenth > 0 ? `${base} −${tenth.toFixed(1)}` : base;
}

/** Snaps to the nearest value of a scale (by ratio, i.e. in stops). */
export function nearestStop(value: number, scale: readonly number[]): number {
  let best = scale[0]!;
  for (const s of scale) {
    if (Math.abs(Math.log2(s / value)) < Math.abs(Math.log2(best / value))) best = s;
  }
  return best;
}
