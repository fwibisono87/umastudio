import { describe, expect, it } from 'vitest';
import {
  ev100,
  exposureScale,
  flashSyncCoverage,
  incidentAperture,
  INCIDENT_METER_C,
  inverseSquare,
  renderIntensityStrobe,
  strobeEnergyWs,
} from './photometry';

describe('photometry', () => {
  it('halves strobe energy per stop', () => {
    expect(strobeEnergyWs({ kind: 'strobe', fullPowerWs: 500, powerStops: 0 })).toBe(500);
    expect(strobeEnergyWs({ kind: 'strobe', fullPowerWs: 500, powerStops: 3 })).toBe(62.5);
  });

  it('meters f/8 at ISO 100 for 160 lux·s', () => {
    expect(incidentAperture(160, 100)).toBeCloseTo(8, 5);
    // Each doubling of ISO opens one stop's worth (√2 in f-number).
    expect(incidentAperture(160, 200)).toBeCloseTo(8 * Math.SQRT2, 5);
  });

  it('computes EV100', () => {
    expect(ev100(8, 1 / 125, 100)).toBeCloseTo(12.97, 2);
    expect(ev100(8, 1 / 125, 200)).toBeCloseTo(11.97, 2);
  });

  it('maps a metered 18% grey card to 0.18', () => {
    // Pick an illuminance, meter it, render an 18% Lambertian card.
    const lux = 1000;
    const shutter = 1 / 60;
    const iso = 100;
    const n = incidentAperture(lux * shutter, iso);
    const luminance = (0.18 * lux) / Math.PI;
    expect(luminance * exposureScale(n, shutter, iso)).toBeCloseTo(0.18, 6);
  });

  it('makes flash exposure independent of shutter speed', () => {
    const cam = { aperture: 8, iso: 100 };
    const a = renderIntensityStrobe(1000, { ...cam, shutterS: 1 / 60 });
    const b = renderIntensityStrobe(1000, { ...cam, shutterS: 1 / 200 });
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo((1000 * Math.PI * 100) / (INCIDENT_METER_C * 64), 9);
  });

  it('applies inverse square', () => {
    expect(inverseSquare(400, 2)).toBe(100);
  });

  it('covers the whole frame at or below sync speed only', () => {
    expect(flashSyncCoverage(1 / 125, 1 / 200)).toBe(1);
    expect(flashSyncCoverage(1 / 400, 1 / 200)).toBeCloseTo(0.5, 9);
  });
});
