import { describe, expect, it } from 'vitest';
import { APERTURE_STOPS, formatAperture, formatPowerStops, formatShutter, nearestStop, SHUTTER_STOPS } from './units';

describe('units', () => {
  it('formats shutter speeds', () => {
    expect(formatShutter(1 / 125)).toBe('1/125');
    expect(formatShutter(0.5)).toBe('0.5"');
    expect(formatShutter(2)).toBe('2"');
  });

  it('formats apertures and power', () => {
    expect(formatAperture(5.6)).toBe('f/5.6');
    expect(formatAperture(8)).toBe('f/8');
    expect(formatPowerStops(0)).toBe('1/1');
    expect(formatPowerStops(3)).toBe('1/8');
    expect(formatPowerStops(3.3)).toBe('1/8 −0.3');
  });

  it('snaps to the nearest stop', () => {
    expect(nearestStop(7.5, APERTURE_STOPS)).toBe(7.1);
    expect(nearestStop(0.0079, SHUTTER_STOPS)).toBe(1 / 125);
  });
});
