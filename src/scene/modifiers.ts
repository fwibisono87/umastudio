// Light modifiers as data. A modifier is an emitter shape and size, a beam, and a
// light loss; adding one is a table edit, not code.
//
// lossStops and beamAngleDeg are calibrated together with STROBE_LM_S_PER_WS
// (photometry.ts); change them as a set and re-run the calibration tests. The standard
// reflector's 80° half-power width is intentionally broader than some catalog beam
// ratings: this cosine-integrated smoothstep profile is calibrated to the common
// 500 Ws / f45-at-1m reference instead of treating the catalog angle as a hard cutoff.
// The 90×120 softbox and 90 cm octabox losses are 1.0 stop (from 1.6): with the
// revised strobe efficacy this places both within 1/3 stop of the 500 Ws / f11 test.

export type EmitterShape = 'point' | 'rect' | 'disc' | 'octagon';

export interface ModifierPreset {
  id: string;
  /** Display name, e.g. "Softbox 90×120". */
  name: string;
  /** Short label for the shot map, e.g. "SB 90×120". */
  shortName: string;
  category: 'bare' | 'reflector' | 'softbox' | 'octabox' | 'stripbox' | 'umbrella' | 'dish' | 'snoot';
  /** Shape of the light-emitting face. 'point' = effectively a point source. */
  shape: EmitterShape;
  /** Emitting face, metres (diameter for disc/octagon: width = height). */
  widthM: number;
  heightM: number;
  /** Full angle at which intensity drops to half of on-axis, degrees. */
  beamAngleDeg: number;
  /**
   * How the emitting face radiates: 'diffuse' faces are roughly Lambertian (softboxes,
   * shoot-through umbrellas), 'directed' ones throw a beam (reflectors, silver dishes).
   */
  emission: 'diffuse' | 'directed';
  /** Light lost to the modifier relative to the bare tube, stops. */
  lossStops: number;
  /** Depth from the flash tube to the emitting face, metres (for drawing and placement). */
  depthM: number;
  /** Whether a honeycomb grid can be fitted. */
  acceptsGrid: boolean;
  /** Whether barn doors can be fitted. */
  acceptsBarnDoors: boolean;
}

export const MODIFIERS: readonly ModifierPreset[] = [
  { id: 'bare', name: 'Bare bulb', shortName: 'Bare', category: 'bare', shape: 'point', widthM: 0.05, heightM: 0.05, beamAngleDeg: 180, emission: 'directed', lossStops: 0, depthM: 0.05, acceptsGrid: false, acceptsBarnDoors: false },
  { id: 'reflector-std', name: 'Standard reflector 18 cm', shortName: 'Refl 18', category: 'reflector', shape: 'disc', widthM: 0.18, heightM: 0.18, beamAngleDeg: 80, emission: 'directed', lossStops: 0.3, depthM: 0.12, acceptsGrid: true, acceptsBarnDoors: true },
  { id: 'reflector-wide', name: 'Wide-angle reflector', shortName: 'Refl wide', category: 'reflector', shape: 'disc', widthM: 0.26, heightM: 0.26, beamAngleDeg: 100, emission: 'directed', lossStops: 0.3, depthM: 0.1, acceptsGrid: true, acceptsBarnDoors: true },
  { id: 'softbox-60x90', name: 'Softbox 60×90', shortName: 'SB 60×90', category: 'softbox', shape: 'rect', widthM: 0.6, heightM: 0.9, beamAngleDeg: 110, emission: 'diffuse', lossStops: 1.5, depthM: 0.45, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'softbox-90x120', name: 'Softbox 90×120', shortName: 'SB 90×120', category: 'softbox', shape: 'rect', widthM: 0.9, heightM: 1.2, beamAngleDeg: 110, emission: 'diffuse', lossStops: 1, depthM: 0.55, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'octabox-90', name: 'Octabox 90', shortName: 'Octa 90', category: 'octabox', shape: 'octagon', widthM: 0.9, heightM: 0.9, beamAngleDeg: 110, emission: 'diffuse', lossStops: 1, depthM: 0.5, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'octabox-150', name: 'Octabox 150', shortName: 'Octa 150', category: 'octabox', shape: 'octagon', widthM: 1.5, heightM: 1.5, beamAngleDeg: 115, emission: 'diffuse', lossStops: 1.8, depthM: 0.7, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'stripbox-30x120', name: 'Stripbox 30×120', shortName: 'Strip 30×120', category: 'stripbox', shape: 'rect', widthM: 0.3, heightM: 1.2, beamAngleDeg: 105, emission: 'diffuse', lossStops: 1.7, depthM: 0.35, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'stripbox-30x180', name: 'Stripbox 30×180', shortName: 'Strip 30×180', category: 'stripbox', shape: 'rect', widthM: 0.3, heightM: 1.8, beamAngleDeg: 105, emission: 'diffuse', lossStops: 1.8, depthM: 0.35, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'umbrella-shoot-105', name: 'Shoot-through umbrella 105', shortName: 'Umb ST 105', category: 'umbrella', shape: 'disc', widthM: 1.05, heightM: 1.05, beamAngleDeg: 140, emission: 'diffuse', lossStops: 1.3, depthM: 0.6, acceptsGrid: false, acceptsBarnDoors: false },
  { id: 'umbrella-white-105', name: 'White umbrella 105', shortName: 'Umb W 105', category: 'umbrella', shape: 'disc', widthM: 1.05, heightM: 1.05, beamAngleDeg: 120, emission: 'diffuse', lossStops: 1.2, depthM: 0.6, acceptsGrid: false, acceptsBarnDoors: false },
  { id: 'umbrella-silver-105', name: 'Silver umbrella 105', shortName: 'Umb S 105', category: 'umbrella', shape: 'disc', widthM: 1.05, heightM: 1.05, beamAngleDeg: 90, emission: 'directed', lossStops: 0.8, depthM: 0.6, acceptsGrid: false, acceptsBarnDoors: false },
  { id: 'dish-white-55', name: 'Beauty dish white 55', shortName: 'Dish W 55', category: 'dish', shape: 'disc', widthM: 0.55, heightM: 0.55, beamAngleDeg: 80, emission: 'directed', lossStops: 0.9, depthM: 0.2, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'dish-silver-55', name: 'Beauty dish silver 55', shortName: 'Dish S 55', category: 'dish', shape: 'disc', widthM: 0.55, heightM: 0.55, beamAngleDeg: 65, emission: 'directed', lossStops: 0.6, depthM: 0.2, acceptsGrid: true, acceptsBarnDoors: false },
  { id: 'snoot', name: 'Snoot', shortName: 'Snoot', category: 'snoot', shape: 'disc', widthM: 0.06, heightM: 0.06, beamAngleDeg: 15, emission: 'directed', lossStops: 1.5, depthM: 0.25, acceptsGrid: true, acceptsBarnDoors: false },
];

/** Honeycomb grid options, full beam angle in degrees. */
export const GRID_ANGLES_DEG = [10, 20, 30, 40] as const;

export function getModifier(id: string): ModifierPreset {
  const m = MODIFIERS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown modifier: ${id}`);
  return m;
}
