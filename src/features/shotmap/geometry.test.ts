import { describe, expect, it } from 'vitest';
import { createDefaultScene, createLight } from '../../scene/document';
import {
  angleFromCameraAxisDeg,
  away,
  distance2,
  distance3,
  heightOf,
  horizontalFovDeg,
  planBounds,
  toPlan,
} from './geometry';

describe('shotmap geometry', () => {
  it('computes the horizontal field of view', () => {
    expect(horizontalFovDeg(85, 36)).toBeCloseTo(23.9, 1);
    expect(horizontalFovDeg(36, 36)).toBeCloseTo(53.1, 1);
  });

  it('maps world positions to plan coordinates', () => {
    expect(toPlan([1.5, 2, -3])).toEqual([1.5, -3]);
    expect(heightOf([1.5, 2, -3])).toBe(2);
  });

  it('measures 3D and plan distances', () => {
    expect(distance3([0, 0, 0], [0, 3, 4])).toBeCloseTo(5);
    expect(distance2([0, 0], [3, 4])).toBeCloseTo(5);
  });

  it('angles lights from the subject relative to the camera axis', () => {
    const doc = createDefaultScene();
    // Key at (1.5, 2, 1.5), camera at (0, 1.45, 3.5) looking toward -Z: her right, +45°.
    expect(angleFromCameraAxisDeg(doc, [1.5, 2, 1.5])).toBeCloseTo(45, 5);
    expect(angleFromCameraAxisDeg(doc, [-1.5, 2, 1.5])).toBeCloseTo(-45, 5);
    // A light on the subject→camera axis reads zero.
    expect(angleFromCameraAxisDeg(doc, [0, 2, 2.5])).toBeCloseTo(0, 5);
  });

  it('moves label anchors away from the subject', () => {
    const p = away([0, 0], [3, 4], 2);
    expect(p[0]).toBeCloseTo(4.2);
    expect(p[1]).toBeCloseTo(5.6);
  });

  it('bounds the plan around the set, padded', () => {
    const doc = createDefaultScene();
    const b = planBounds(doc);
    // The backdrop wall at z = -3 with the 0.75 m pad.
    expect(b.minY).toBeCloseTo(-3.75, 5);
    // Subject and camera are always inside.
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(0);
    expect(b.maxY).toBeGreaterThanOrEqual(3.5 + 0.75);
    // A light further out grows the box.
    const wide = createDefaultScene();
    wide.lights.push(createLight('fill', 'Fill', { position: [-6, 2, 1.5] }));
    expect(planBounds(wide).minX).toBeLessThan(b.minX);
  });
});
