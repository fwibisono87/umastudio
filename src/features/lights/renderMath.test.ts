import { describe, expect, it } from 'vitest';
import { createLight } from '../../scene/document';
import { illuminanceAt, onAxisIntensity } from '../../scene/lightModel';
import { renderIntensityContinuous, renderIntensityStrobe } from '../../scene/photometry';
import { rectEffectiveArea, sourceDistance, splitSoftSource } from './renderMath';

describe('live source intensity mapping', () => {
  it('makes the pre-exposed spot plus RectAreaLight equal the shared meter at several distances', () => {
    const light = createLight('key', 'Key', { modifierId: 'softbox-90x120', position: [0, 0, 0], target: [0, 0, 1] });
    const physical = onAxisIntensity(light).value;
    const camera = { aperture: 8, shutterS: 1 / 125, iso: 100 };
    for (const distance of [1.5, 2, 4]) {
      const split = splitSoftSource(physical, 0.9, 1.2, distance);
      const equivalentCandela = split.spotIntensity + split.areaLuminance * rectEffectiveArea(0.9, 1.2, distance);
      expect(equivalentCandela).toBeCloseTo(physical, 10);
      const renderedSpot = renderIntensityStrobe(split.spotIntensity, camera) / distance ** 2;
      const renderedArea = renderIntensityStrobe(split.areaLuminance, camera) * rectEffectiveArea(0.9, 1.2, distance) / distance ** 2;
      const renderedModel = renderIntensityStrobe(illuminanceAt(light, [0, 0, distance], [0, 0, -1]), camera);
      expect(renderedSpot + renderedArea).toBeCloseTo(renderedModel, 10);
    }
  });

  it('uses a finite-distance correction for a soft source split', () => {
    const light = createLight('key', 'Key', { modifierId: 'softbox-90x120', position: [0, 0, 0], target: [0, 0, 1] });
    const split = splitSoftSource(onAxisIntensity(light).value, 0.9, 1.2, sourceDistance(light));
    expect(split.effectiveAreaM2).toBeLessThan(0.9 * 1.2);
    expect(split.areaLuminance).toBeGreaterThan(0);
  });

  it('pre-exposes a continuous soft source through the same candela split', () => {
    const light = createLight('led', 'LED', {
      modifierId: 'softbox-90x120',
      position: [0, 0, 0],
      target: [0, 0, 1],
      output: { kind: 'continuous', watts: 200, lumensPerWatt: 120 },
    });
    const camera = { aperture: 5.6, shutterS: 1 / 60, iso: 800 };
    const physical = onAxisIntensity(light).value;
    for (const distance of [1, 2, 3.5]) {
      const split = splitSoftSource(physical, 0.9, 1.2, distance);
      const area = rectEffectiveArea(0.9, 1.2, distance);
      const rendered = renderIntensityContinuous(split.spotIntensity, camera) / distance ** 2
        + (renderIntensityContinuous(split.areaLuminance, camera) * area) / distance ** 2;
      const expected = renderIntensityContinuous(illuminanceAt(light, [0, 0, distance], [0, 0, -1]), camera);
      expect(rendered).toBeCloseTo(expected, 10);
    }
  });
});
