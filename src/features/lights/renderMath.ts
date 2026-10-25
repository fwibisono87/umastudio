import { getModifier } from '../../scene/modifiers';
import type { LightState } from '../../scene/types';

export const SOFT_SOURCE_AREA_SHARE = 0.58;

export interface SoftSourceSplit {
  /** Point/spot component in cd or cd·s. */
  spotIntensity: number;
  /** RectAreaLight component in cd/m² or cd·s/m². */
  areaLuminance: number;
  /** Integration area used to make the area and spot components sum on axis. */
  effectiveAreaM2: number;
}

/**
 * Split a diffuse source between a shadow-casting spot and a RectAreaLight. The area
 * term is a numerical Lambertian rectangle integral at the aimed point; this corrects
 * its finite-size on-axis falloff so both components reproduce the same point-source
 * illuminance as the shared model at that distance. The spot supplies the soft PCF
 * shadow, while the area light supplies wrap and the rectangular catchlight.
 */
export function splitSoftSource(
  onAxis: number,
  widthM: number,
  heightM: number,
  distanceM: number,
  areaShare = SOFT_SOURCE_AREA_SHARE,
): SoftSourceSplit {
  const effectiveAreaM2 = rectEffectiveArea(widthM, heightM, distanceM);
  return {
    spotIntensity: onAxis * (1 - areaShare),
    areaLuminance: (onAxis * areaShare) / effectiveAreaM2,
    effectiveAreaM2,
  };
}

/** Equivalent square metres of a Lambertian rectangle as seen on its normal axis. */
export function rectEffectiveArea(widthM: number, heightM: number, distanceM: number, steps = 32): number {
  const d = Math.max(0.05, distanceM);
  const dx = widthM / steps;
  const dy = heightM / steps;
  let sum = 0;
  for (let ix = 0; ix < steps; ix++) {
    const x = -widthM / 2 + (ix + 0.5) * dx;
    for (let iy = 0; iy < steps; iy++) {
      const y = -heightM / 2 + (iy + 0.5) * dy;
      const radiusSquared = d * d + x * x + y * y;
      sum += ((d ** 4) / (radiusSquared * radiusSquared)) * dx * dy;
    }
  }
  return sum;
}

export function isLargeDiffuseSource(light: LightState): boolean {
  const modifier = getModifier(light.modifierId);
  return modifier.emission === 'diffuse' && modifier.category !== 'bare' && Math.max(modifier.widthM, modifier.heightM) >= 0.25;
}

export function sourceDistance(light: LightState): number {
  const d = Math.hypot(
    light.target[0] - light.position[0],
    light.target[1] - light.position[1],
    light.target[2] - light.position[2],
  );
  const modifier = getModifier(light.modifierId);
  return Math.max(d, Math.hypot(modifier.widthM / 2, modifier.heightM / 2), 0.05);
}
