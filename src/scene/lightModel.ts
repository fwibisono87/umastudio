// Shared, renderer-independent light and incident-meter model. Directions passed to
// relativeIntensity point from the emitter toward the sample point.

import { getModifier } from './modifiers';
import { continuousLumens, incidentAperture, INCIDENT_METER_C, strobeLumenSeconds } from './photometry';
import type { CameraState, LightState, SceneDocument, Vec3 } from './types';

export type IntensityValue = { value: number; perSecond: boolean };
export type MeterMode = 'toward-camera' | 'toward-each-light';

export interface MeterLightReading {
  id: string;
  name: string;
  /** Lux·s for a strobe; lux × shutter for a continuous source. */
  luxSeconds: number;
}

export interface MeterReading {
  mode: MeterMode;
  lights: MeterLightReading[];
  ambientLuxSeconds: number;
  totalLuxSeconds: number;
  aperture: number;
  /** Positive means the current camera aperture would overexpose the reading. */
  stopsOver: number;
}

// About 71% grid transmission is a practical average for an open honeycomb cell field.
const GRID_LOSS_STOPS = 0.5;

/**
 * On-axis intensity after modifier and grid loss. Diffuse faces keep their
 * Lambertian I0 = Φ/π. Directed faces use the exact solid angle of our smoothstep
 * cone: it is flat on axis, reaches 1/2 at beamAngleDeg/2, then eases to zero.
 * Bare tubes are treated as isotropic emitters to preserve the lumen/(4π) reference.
 */
export function onAxisIntensity(light: LightState): IntensityValue {
  const modifier = getModifier(light.modifierId);
  const lumens =
    light.output.kind === 'strobe' ? strobeLumenSeconds(light.output) : continuousLumens(light.output);
  const gridLoss = !modifier.acceptsGrid || light.accessories.gridDeg === null ? 0 : GRID_LOSS_STOPS;
  const transmitted = lumens * 2 ** (-(modifier.lossStops + gridLoss));

  if (modifier.category === 'bare') return { value: transmitted / (4 * Math.PI), perSecond: light.output.kind === 'continuous' };
  if (modifier.emission === 'diffuse') return { value: transmitted / Math.PI, perSecond: light.output.kind === 'continuous' };

  const effectiveSolidAngle = smoothConeSolidAngle(effectiveBeamAngle(light));
  return { value: transmitted / effectiveSolidAngle, perSecond: light.output.kind === 'continuous' };
}

/** Beam and accessory transmission at a direction from the emitter (1 on axis). */
export function relativeIntensity(light: LightState, directionToPoint: Vec3): number {
  const modifier = getModifier(light.modifierId);
  if (modifier.category === 'bare') return 1;

  const axis = unit(sub(light.target, light.position));
  const direction = unit(directionToPoint);
  if (length(axis) === 0 || length(direction) === 0) return 0;

  const forward = dot(axis, direction);
  if (forward <= 0) return 0;

  const beamHalfAngle = effectiveBeamAngle(light) / 2;
  const outer = outerAngleForHalfPower(beamHalfAngle);
  const profile = smoothstep(Math.cos(outer), 1, forward);
  if (profile <= 0) return 0;
  if (!barnDoorPasses(light, axis, direction)) return 0;
  return profile;
}

/** Illuminance at a point in lux, or lux·s for a strobe. */
export function illuminanceAt(light: LightState, point: Vec3, normal?: Vec3): number {
  if (!light.enabled) return 0;
  const axisToSample = sub(point, light.position);
  const toEmitter = scale(axisToSample, -1);
  const d = Math.max(length(axisToSample), nearFieldClamp(light));
  const beam = relativeIntensity(light, axisToSample);
  if (beam <= 0) return 0;

  let cosine = 1;
  if (normal) cosine = Math.max(0, dot(unit(normal), unit(toEmitter)));
  const intensity = onAxisIntensity(light).value;
  return (intensity * beam * cosine) / (d * d);
}

/**
 * Incident dome reading at a point. Camera-facing mode applies the dome cosine once
 * to every source; toward-each-light mode independently points the dome at each source.
 * Continuous sources and ambient are integrated over shutter time, while flash energy
 * remains independent of shutter speed.
 */
export function meterReading(doc: SceneDocument, point: Vec3, mode: MeterMode): MeterReading {
  const cameraNormal = unit(sub(doc.camera.position, point));
  const readings = doc.lights
    .filter((light) => light.enabled)
    .map((light) => {
      const normal = mode === 'toward-camera' ? cameraNormal : unit(sub(light.position, point));
      const value = illuminanceAt(light, point, normal);
      return {
        id: light.id,
        name: light.name,
        luxSeconds: light.output.kind === 'strobe' ? value : value * doc.camera.shutterS,
      };
    });

  const ambientLuxSeconds = doc.environment.ambientLux * doc.camera.shutterS;
  const totalLuxSeconds = readings.reduce((sum, reading) => sum + reading.luxSeconds, ambientLuxSeconds);
  const aperture = incidentAperture(totalLuxSeconds, doc.camera.iso);
  const stopsOver = totalLuxSeconds > 0 ? Math.log2(totalLuxSeconds / cameraMeterThreshold(doc.camera)) : -Infinity;
  return { mode, lights: readings, ambientLuxSeconds, totalLuxSeconds, aperture, stopsOver };
}

/** Kelvin to linear RGB, scaled so relative luminance Y is exactly 1. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const kelvinClamped = Math.min(40000, Math.max(1000, kelvin));
  const t = kelvinClamped / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue =
    t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const linear: [number, number, number] = [red, green, blue].map((v) => srgbToLinear(clamp(v / 255, 0, 1))) as [number, number, number];
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return linear.map((v) => v / luminance) as [number, number, number];
}

/** The half-power angle is full width; grids narrow it only when their angle is smaller. */
export function effectiveBeamAngle(light: LightState): number {
  const modifier = getModifier(light.modifierId);
  const grid = modifier.acceptsGrid ? light.accessories.gridDeg : null;
  return grid === null ? modifier.beamAngleDeg : Math.min(modifier.beamAngleDeg, grid);
}

/** SpotLight outer angle for a smoothstep cone whose half-power angle is `halfPowerDeg`. */
export function outerAngleForHalfPower(halfPowerDeg: number): number {
  // With a flat-top smoothstep from 1 to 0, solve cos(halfPower)=(1+cos(outer))/2.
  const half = Math.min(89.9, Math.max(0.05, halfPowerDeg)) * (Math.PI / 180);
  return Math.acos(clamp(2 * Math.cos(half) - 1, -1, 1));
}

/** The smoothstep profile's integrated forward solid angle, in steradians. */
export function smoothConeSolidAngle(beamAngleDeg: number): number {
  return Math.PI * (1 - Math.cos(outerAngleForHalfPower(beamAngleDeg / 2)));
}

function cameraMeterThreshold(camera: CameraState): number {
  return ((camera.aperture * camera.aperture) * INCIDENT_METER_C) / camera.iso;
}

function nearFieldClamp(light: LightState): number {
  const modifier = getModifier(light.modifierId);
  // A point-source inverse-square law diverges inside a large face. The face half diagonal
  // is a conservative effective minimum distance until a finite-area HQ integration runs.
  return Math.max(0.05, Math.hypot(modifier.widthM / 2, modifier.heightM / 2));
}

function barnDoorPasses(light: LightState, axis: Vec3, direction: Vec3): boolean {
  const doors = light.accessories.barnDoors;
  if (!doors) return true;
  const modifier = getModifier(light.modifierId);
  if (!modifier.acceptsBarnDoors) return true;

  // Each leaf is an independent angular half-plane; that is a simple clipping
  // approximation for the finite rectangle and its projected blade geometry.
  const reference: Vec3 = Math.abs(axis[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
  let right = unit(cross(reference, axis));
  let up = unit(cross(axis, right));
  const roll = (light.rollDeg * Math.PI) / 180;
  const originalRight = right;
  right = add(scale(originalRight, Math.cos(roll)), scale(up, Math.sin(roll)));
  up = add(scale(up, Math.cos(roll)), scale(originalRight, -Math.sin(roll)));

  const forward = dot(axis, direction);
  const horizontalDeg = (Math.atan2(dot(direction, right), forward) * 180) / Math.PI;
  const verticalDeg = (Math.atan2(dot(direction, up), forward) * 180) / Math.PI;
  return (
    horizontalDeg <= 90 - doors.right &&
    horizontalDeg >= -(90 - doors.left) &&
    verticalDeg <= 90 - doors.top &&
    verticalDeg >= -(90 - doors.bottom)
  );
}

function unit(v: Vec3): Vec3 {
  const n = length(v);
  return n > 1e-12 ? scale(v, 1 / n) : [0, 0, 0];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
