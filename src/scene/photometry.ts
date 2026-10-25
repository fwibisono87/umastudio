// Shared photometric calibration: how real-world light output becomes pixels.
//
// Every feature that turns light into numbers (lights, camera, shot map, HQ render)
// goes through these functions, so the live view, the meter readouts and the path
// tracer agree.
//
// The chain:
//   strobe Ws ──STROBE_LM_S_PER_WS──▶ luminous energy (lm·s) ──modifier──▶ cd·s on axis
//   continuous W ──lm/W──▶ lumens ──modifier──▶ cd on axis
//   cd (or cd·s) at distance d ──inverse square──▶ lux (or lux·s) at the subject
//
// Rendering is "pre-exposed": light intensities handed to three.js (and the path
// tracer) are the physical values multiplied by exposureScale(camera). With the
// renderer's toneMappingExposure left at 1, an 18% grey card lit to a correct incident
// meter reading renders at linear 0.18. Pre-exposing keeps shader values near 1, which
// half-float render targets need (physical radiance under a strobe would overflow them).
//
// Strobes: a flash is far shorter than any shutter speed up to sync, so the exposure
// it contributes depends on aperture and ISO but not on shutter. To render a flash as a
// continuous three.js light we spread its energy over the shutter time:
//   intensity = (cd·s / shutterS) · exposureScale  =  cd·s · π·ISO / (C·N²)
// Faster than flash sync, the focal-plane shutter is a moving slit and only part of the
// frame sees the flash; see flashSyncCoverage().

import type { CameraState, ContinuousOutput, StrobeOutput } from './types';

/**
 * Incident-light meter calibration constant C (ISO 2720), lux·s for N² = E·t·S / C.
 * 250 is typical for a hemispherical (dome) receptor.
 */
export const INCIDENT_METER_C = 250;

/**
 * Luminous energy a studio strobe emits per watt-second of rated energy, bare tube.
 * Xenon tubes reach ~30-50 lm/W but capacitor-to-light losses and the rating
 * conventions of studio heads bring it down. Set to 18 lm·s/Ws (from 25) so the
 * calibrated modifier transmissions stay in a plausible range. Calibrated against two
 * setups (both ISO 100, incident meter at the subject):
 *   - 500 Ws in a ~90 cm softbox at 2 m → about f/11
 *   - 500 Ws in a standard 7" reflector at 2 m → about f/22
 * The modifier table's lossStops and beam angles are tuned alongside this constant;
 * see lightModel.test.ts.
 */
export const STROBE_LM_S_PER_WS = 18;

/** Energy actually released at the current power setting, Ws. */
export function strobeEnergyWs(output: StrobeOutput): number {
  return output.fullPowerWs / 2 ** output.powerStops;
}

/** Luminous energy of one flash, lumen-seconds, before any modifier. */
export function strobeLumenSeconds(output: StrobeOutput): number {
  return strobeEnergyWs(output) * STROBE_LM_S_PER_WS;
}

/** Luminous flux of a continuous light, lumens, before any modifier. */
export function continuousLumens(output: ContinuousOutput): number {
  return output.watts * output.lumensPerWatt;
}

/** Illuminance (or illuminance·time) at `distanceM` from a source of `intensity` cd (or cd·s). */
export function inverseSquare(intensity: number, distanceM: number): number {
  const d = Math.max(distanceM, 0.05);
  return intensity / (d * d);
}

/**
 * f-number an incident meter reads for an exposure of `luxSeconds` (illuminance ×
 * time; for a flash, its total lux·s) at `iso`.
 */
export function incidentAperture(luxSeconds: number, iso: number): number {
  return Math.sqrt((luxSeconds * iso) / INCIDENT_METER_C);
}

/** Exposure value referenced to ISO 100 for the camera's settings. */
export function ev100(aperture: number, shutterS: number, iso: number): number {
  return Math.log2((aperture * aperture) / shutterS) - Math.log2(iso / 100);
}

/**
 * Converts scene luminance (cd/m²) to a linear display value for these camera
 * settings, such that a correctly metered 18% grey card lands at 0.18.
 *
 * Derivation: the meter picks N²/t = E·S/C; an 18% Lambertian card has luminance
 * L = 0.18·E/π; we want k·L = 0.18, so k = π/E = π·S·t / (C·N²).
 */
export function exposureScale(aperture: number, shutterS: number, iso: number): number {
  return (Math.PI * iso * shutterS) / (INCIDENT_METER_C * aperture * aperture);
}

/** exposureScale() for a camera state. */
export function cameraExposureScale(camera: Pick<CameraState, 'aperture' | 'shutterS' | 'iso'>): number {
  return exposureScale(camera.aperture, camera.shutterS, camera.iso);
}

/**
 * Pre-exposed render intensity for a continuous source. `physical` is whatever unit
 * three.js expects for that light type (cd for point/spot, lux for directional,
 * cd/m² for rect-area); the result goes straight into `light.intensity`.
 */
export function renderIntensityContinuous(
  physical: number,
  camera: Pick<CameraState, 'aperture' | 'shutterS' | 'iso'>,
): number {
  return physical * cameraExposureScale(camera);
}

/**
 * Pre-exposed render intensity for a flash. `physicalSeconds` is the time-integrated
 * value in three.js units (cd·s, lux·s or cd·s/m²). Independent of shutter speed, as on
 * a real camera; flash-sync clipping is applied separately by the camera feature.
 */
export function renderIntensityStrobe(
  physicalSeconds: number,
  camera: Pick<CameraState, 'aperture' | 'shutterS' | 'iso'>,
): number {
  return (physicalSeconds / camera.shutterS) * cameraExposureScale(camera);
}

/**
 * Fraction of the frame height that receives the flash. 1 at or below sync speed;
 * faster than sync the two shutter curtains travel as a slit and the rest of the frame
 * is covered while the flash fires, which shows as a dark band.
 */
export function flashSyncCoverage(shutterS: number, flashSyncS: number): number {
  return Math.min(1, shutterS / flashSyncS);
}
