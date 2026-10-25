import { cameraExposureScale, renderIntensityContinuous, renderIntensityStrobe } from '../../scene/photometry';
import { effectiveBeamAngle, onAxisIntensity, outerAngleForHalfPower } from '../../scene/lightModel';
import { getModifier } from '../../scene/modifiers';
import type { CameraState, LightState } from '../../scene/types';

export type EmitterPlan =
  | {
      kind: 'area';
      shape: 'rect' | 'circle';
      widthM: number;
      heightM: number;
      areaM2: number;
      physicalIntensity: number;
      intensity: number;
      perSecond: boolean;
    }
  | {
      kind: 'spot' | 'point';
      radiusM: number;
      angleRad: number;
      physicalIntensity: number;
      intensity: number;
      perSecond: boolean;
    };

/**
 * Converts the shared light-meter intensity into the units read by the path tracer.
 * RectAreaLight intensity is luminance (nits); its shader multiplies that by the
 * sampled face area. Spot and point intensities are candela and the path-tracer shader
 * applies inverse-square attenuation. See three-gpu-pathtracer 0.0.27:
 * `LightsInfoUniformStruct.updateFrom` stores `l.intensity` unchanged (`floatArray[ baseIndex + ( index ++ ) ] = l.intensity;`).
 * The shader samples area faces with `lightRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );`
 * and emits `lightRec.emission = light.color * light.intensity;`. For spots it uses
 * `float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), EPSILON );`.
 * These conventions make area intensity radiance and spot/point intensity candela.
 */
export function planEmitter(light: LightState, camera: CameraState): EmitterPlan {
  const modifier = getModifier(light.modifierId);
  const source = onAxisIntensity(light);
  // Area lights in the path tracer have only a cosine face profile. A grid narrows
  // that profile, so approximate a gridded diffuse modifier with a finite-radius spot.
  const hasGrid = modifier.acceptsGrid && light.accessories.gridDeg !== null;
  const areaShape = modifier.emission === 'diffuse' && !hasGrid;

  if (areaShape) {
    // three-gpu-pathtracer 0.0.27 supports circular shaped area lights, but no
    // octagonal face. Approximate the octagon with an equal-area square.
    const octagonScale = Math.sqrt(Math.SQRT1_2);
    const scale = modifier.shape === 'octagon' ? octagonScale : 1;
    const widthM = modifier.widthM * scale;
    const heightM = modifier.heightM * scale;
    const shape = modifier.shape === 'disc' ? 'circle' : 'rect';
    const areaM2 = shape === 'circle' ? (Math.PI * widthM * heightM) / 4 : widthM * heightM;
    const physicalIntensity = source.value / areaM2;
    return {
      kind: 'area',
      shape,
      widthM,
      heightM,
      areaM2,
      physicalIntensity,
      intensity: preExpose(physicalIntensity, source.perSecond, camera),
      perSecond: source.perSecond,
    };
  }

  const beamAngleDeg = effectiveBeamAngle(light);
  // The full outer angle is chosen so the path tracer's smoothstep spot profile has
  // its half-power point at effectiveBeamAngle / 2, matching relativeIntensity().
  let angleRad = outerAngleForHalfPower(beamAngleDeg / 2);
  const doors = light.accessories.barnDoors;
  if (doors && modifier.acceptsBarnDoors) {
    // The spot model is circular. Like the live preview, use the tightest door angle
    // as a compact approximation for the four independent barn-door planes.
    angleRad = Math.min(angleRad, ...Object.values(doors).map((closing) => ((90 - closing) * Math.PI) / 180));
  }
  angleRad = Math.min(Math.PI / 2 - 0.005, Math.max(0.01, angleRad));

  const radiusM = modifier.category === 'bare'
    ? 0
    : modifier.shape === 'rect'
      ? Math.hypot(modifier.widthM / 2, modifier.heightM / 2)
      : Math.max(modifier.widthM, modifier.heightM) / 2;
  const physicalIntensity = source.value;
  return {
    kind: modifier.category === 'bare' ? 'point' : 'spot',
    radiusM,
    angleRad,
    physicalIntensity,
    intensity: preExpose(physicalIntensity, source.perSecond, camera),
    perSecond: source.perSecond,
  };
}

/** Long edge in pixels, preserving the physical sensor aspect ratio. */
export function renderResolution(longEdgePx: number, sensorWidthMm: number, sensorHeightMm: number): { width: number; height: number } {
  const longestSensorEdge = Math.max(sensorWidthMm, sensorHeightMm);
  const scale = longEdgePx / longestSensorEdge;
  return {
    width: Math.max(1, Math.round(sensorWidthMm * scale)),
    height: Math.max(1, Math.round(sensorHeightMm * scale)),
  };
}

/** `PhysicalCamera.bokehSize` is in mm; its shader converts half of it to scene metres. */
export function cameraBokehSizeMm(focalLengthMm: number, fStop: number): number {
  return focalLengthMm / fStop;
}

/** Entrance-pupil diameter in metres, f / N with the focal length converted from mm. */
export function entrancePupilDiameterM(focalLengthMm: number, fStop: number): number {
  return cameraBokehSizeMm(focalLengthMm, fStop) / 1000;
}

/** Pre-exposed radiance for a uniform room environment with the requested incident lux. */
export function preExposedAmbientRadiance(ambientLux: number, camera: CameraState): number {
  return (ambientLux * cameraExposureScale(camera)) / Math.PI;
}

export interface RenderObjectFlags {
  layersMask: number;
  editorOnly: boolean;
  isLight: boolean;
}

/** Pure layer/ownership filter used before cloning live geometry into the render snapshot. */
export function isRenderSceneObject(flags: RenderObjectFlags): boolean {
  return !flags.editorOnly && !flags.isLight && (flags.layersMask & 1) !== 0;
}

/**
 * Expected physical on-axis illuminance at distance d for the units above. This lets
 * calibration tests compare the renderer conversion directly with illuminanceAt().
 */
export function predictedIlluminance(plan: EmitterPlan, distanceM: number): number {
  const distanceSq = distanceM * distanceM;
  return ((plan.kind === 'area' ? plan.physicalIntensity * plan.areaM2 : plan.physicalIntensity) / distanceSq);
}

function preExpose(value: number, perSecond: boolean, camera: CameraState): number {
  return perSecond ? renderIntensityContinuous(value, camera) : renderIntensityStrobe(value, camera);
}
