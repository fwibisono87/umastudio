import type { CameraBody, Vec3 } from '../../scene/types';

export interface CameraBodyPreset extends CameraBody {
  readonly category: 'focal-plane' | 'leaf-shutter';
}

/** Camera bodies and sync limits used by the teaching presets. */
export const BODY_PRESETS: readonly CameraBodyPreset[] = [
  { name: 'Full frame', sensorWidthMm: 36, sensorHeightMm: 24, flashSyncS: 1 / 200, category: 'focal-plane' },
  { name: 'APS-C', sensorWidthMm: 23.5, sensorHeightMm: 15.6, flashSyncS: 1 / 200, category: 'focal-plane' },
  { name: 'Micro Four Thirds', sensorWidthMm: 17.3, sensorHeightMm: 13, flashSyncS: 1 / 250, category: 'focal-plane' },
  { name: 'Medium format', sensorWidthMm: 44, sensorHeightMm: 33, flashSyncS: 1 / 125, category: 'focal-plane' },
  { name: 'Medium format leaf shutter', sensorWidthMm: 44, sensorHeightMm: 33, flashSyncS: 1 / 2000, category: 'leaf-shutter' },
];

/** Camera white-balance presets, kelvin. */
export const WHITE_BALANCE_PRESETS = [
  { name: 'Tungsten', kelvin: 3200 },
  { name: 'Fluorescent', kelvin: 4000 },
  { name: 'Flash / daylight', kelvin: 5500 },
  { name: 'Cloudy', kelvin: 6500 },
  { name: 'Shade', kelvin: 7500 },
] as const;

export const COMMON_PRIMES_MM = [24, 35, 50, 85, 105, 135, 200] as const;

export interface CameraPlacement {
  /** Horizontal distance from the subject anchor, in metres. */
  distanceM: number;
  /** Camera height above the floor, in metres. */
  heightM: number;
  /** 0 is +Z; positive angles move toward +X, the photographer's right when looking down -Z. */
  angleDeg: number;
}

/** Converts camera XYZ to the orbit controls around the subject anchor. */
export function placementFromPosition(position: Vec3, subjectPosition: Vec3): CameraPlacement {
  const dx = position[0] - subjectPosition[0];
  const dz = position[2] - subjectPosition[2];
  return {
    distanceM: Math.hypot(dx, dz),
    heightM: position[1],
    angleDeg: (Math.atan2(dx, dz) * 180) / Math.PI,
  };
}

/** Converts orbit controls back to world XYZ. Positive angle is toward +X. */
export function positionFromPlacement(placement: CameraPlacement, subjectPosition: Vec3): Vec3 {
  const angle = (placement.angleDeg * Math.PI) / 180;
  return [
    subjectPosition[0] + Math.sin(angle) * placement.distanceM,
    placement.heightM,
    subjectPosition[2] + Math.cos(angle) * placement.distanceM,
  ];
}

/** Circle of confusion at the image plane, returned in millimetres. */
export function cocMm(focalMm: number, aperture: number, focusDistanceM: number, depthM: number): number {
  if (![focalMm, aperture, focusDistanceM, depthM].every(Number.isFinite)) return 0;
  if (focalMm <= 0 || aperture <= 0 || focusDistanceM <= 0 || depthM <= 0) return 0;
  const focusMm = focusDistanceM * 1000;
  const depthMm = depthM * 1000;
  // Distances closer than the focal length are outside a real lens' focusing range.
  const imageDistanceDenominator = Math.max(focusMm - focalMm, 1e-6);
  return ((focalMm * focalMm) / (aperture * imageDistanceDenominator)) * (Math.abs(depthMm - focusMm) / depthMm);
}

/** Hyperfocal distance in metres for a chosen acceptable circle of confusion. */
export function hyperfocalM(focalMm: number, aperture: number, acceptableCocMm: number): number {
  if (![focalMm, aperture, acceptableCocMm].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  if (focalMm <= 0 || aperture <= 0 || acceptableCocMm <= 0) return Number.POSITIVE_INFINITY;
  return ((focalMm * focalMm) / (aperture * acceptableCocMm) + focalMm) / 1000;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largest centered sensor-shaped rectangle that fits inside a viewport (CSS pixels). */
export function letterboxRect(viewWidth: number, viewHeight: number, sensorAspect: number): FrameRect {
  const width = Math.max(0, viewWidth);
  const height = Math.max(0, viewHeight);
  if (width === 0 || height === 0 || !Number.isFinite(sensorAspect) || sensorAspect <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const viewportAspect = width / height;
  const frameWidth = viewportAspect > sensorAspect ? height * sensorAspect : width;
  const frameHeight = frameWidth / sensorAspect;
  return {
    x: (width - frameWidth) / 2,
    y: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}
