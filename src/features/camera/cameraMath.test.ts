import { describe, expect, it } from 'vitest';
import {
  BODY_PRESETS,
  cocMm,
  hyperfocalM,
  letterboxRect,
  placementFromPosition,
  positionFromPlacement,
} from './cameraMath';

describe('camera placement', () => {
  it('round-trips world position around an offset subject anchor', () => {
    const subject: [number, number, number] = [1.25, 0, -2];
    const position: [number, number, number] = [-0.5, 1.62, 3.4];
    const placement = placementFromPosition(position, subject);
    const roundTrip = positionFromPlacement(placement, subject);
    expect(roundTrip[0]).toBeCloseTo(position[0], 10);
    expect(roundTrip[1]).toBeCloseTo(position[1], 10);
    expect(roundTrip[2]).toBeCloseTo(position[2], 10);
  });

  it('uses positive orbit angles for camera-left', () => {
    expect(positionFromPlacement({ distanceM: 4, heightM: 1.5, angleDeg: 90 }, [0, 0, 0])[0]).toBeCloseTo(4);
  });
});

describe('camera optics math', () => {
  it('computes the requested 85 mm f/2 circle of confusion', () => {
    const exact = (85 ** 2 / (2 * (3000 - 85))) * (1000 / 4000);
    expect(cocMm(85, 2, 3, 4)).toBeCloseTo(exact, 12);
    expect(exact).toBeCloseTo(0.30982, 5);
  });

  it('has a plausible 50 mm f/8 hyperfocal distance', () => {
    expect(hyperfocalM(50, 8, 0.03)).toBeCloseTo(10.4667, 3);
  });
});

describe('sensor framing', () => {
  it('centers a 3:2 frame in wide and tall viewports', () => {
    expect(letterboxRect(1200, 800, 3 / 2)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(letterboxRect(1200, 1000, 3 / 2)).toEqual({ x: 0, y: 100, width: 1200, height: 800 });
    const tall = letterboxRect(800, 1200, 3 / 2);
    expect(tall.x).toBe(0);
    expect(tall.y).toBeCloseTo(1200 / 2 - (800 / (3 / 2)) / 2, 10);
    expect(tall.width).toBe(800);
    expect(tall.height).toBeCloseTo(800 / (3 / 2), 10);
  });

  it('fits 4:3 and wider medium-format sensors inside a viewport', () => {
    const fourThree = letterboxRect(1200, 800, 4 / 3);
    expect(fourThree.x).toBeCloseTo((1200 - 800 * (4 / 3)) / 2, 10);
    expect(fourThree.y).toBeCloseTo(0, 10);
    expect(fourThree.height).toBeCloseTo(800, 10);
    const rect = letterboxRect(1000, 700, 44 / 33);
    expect(rect.width / rect.height).toBeCloseTo(44 / 33, 12);
    expect(rect.x).toBeGreaterThan(0);
  });
});

describe('body presets', () => {
  it('contains valid sensor dimensions, sync speeds, and aperture scale values', () => {
    expect(BODY_PRESETS).toHaveLength(5);
    for (const body of BODY_PRESETS) {
      expect(body.name.length).toBeGreaterThan(0);
      expect(body.sensorWidthMm).toBeGreaterThan(0);
      expect(body.sensorHeightMm).toBeGreaterThan(0);
      expect(body.flashSyncS).toBeGreaterThan(0);
    }
    expect(BODY_PRESETS.find((body) => body.name === 'Full frame')).toMatchObject({ sensorWidthMm: 36, sensorHeightMm: 24, flashSyncS: 1 / 200 });
    expect(BODY_PRESETS.find((body) => body.name === 'APS-C')).toMatchObject({ sensorWidthMm: 23.5, sensorHeightMm: 15.6, flashSyncS: 1 / 200 });
    expect(BODY_PRESETS.find((body) => body.name === 'Micro Four Thirds')).toMatchObject({ sensorWidthMm: 17.3, sensorHeightMm: 13, flashSyncS: 1 / 250 });
    expect(BODY_PRESETS.find((body) => body.name === 'Medium format')).toMatchObject({ sensorWidthMm: 44, sensorHeightMm: 33, flashSyncS: 1 / 125 });
    expect(BODY_PRESETS.find((body) => body.category === 'leaf-shutter')?.flashSyncS).toBe(1 / 2000);
  });
});
