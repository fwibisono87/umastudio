import { describe, expect, it } from 'vitest';
import { createDefaultScene, createLight } from './document';
import { incidentAperture, STROBE_LM_S_PER_WS } from './photometry';
import { illuminanceAt, kelvinToRgb, lightColor, meterReading, onAxisIntensity, relativeIntensity } from './lightModel';
import type { LightState, SceneDocument } from './types';

function calibratedLight(modifierId: string): LightState {
  return createLight('test', 'Test', {
    position: [0, 0, 0],
    target: [0, 0, 1],
    modifierId,
  });
}

function apertureAt2m(light: LightState, normal: [number, number, number] = [0, 0, -1]): number {
  return incidentAperture(illuminanceAt(light, [0, 0, 2], normal), 100);
}

function stopDistance(a: number, b: number): number {
  return Math.abs(2 * Math.log2(a / b));
}

function withLight(light: LightState): SceneDocument {
  const doc = createDefaultScene();
  doc.lights = [light];
  return doc;
}

describe('shared light model', () => {
  it('calibrates 500 Ws softbox and octabox to f/11 at 2 m', () => {
    for (const id of ['softbox-90x120', 'octabox-90']) {
      expect(stopDistance(apertureAt2m(calibratedLight(id)), 11)).toBeLessThanOrEqual(1 / 3);
    }
  });

  it('calibrates a 500 Ws standard reflector to f/22 at 2 m', () => {
    expect(stopDistance(apertureAt2m(calibratedLight('reflector-std')), 22)).toBeLessThanOrEqual(1 / 3);
  });

  it('keeps the bare-tube reading tied to lumen-seconds over 4π', () => {
    const light = calibratedLight('bare');
    const expected = Math.sqrt(((500 * STROBE_LM_S_PER_WS) / (4 * Math.PI) / 4) * (100 / 250));
    expect(apertureAt2m(light)).toBeCloseTo(expected, 8);
  });

  it('changes exactly one stop with half power and two stops when distance doubles', () => {
    const full = calibratedLight('softbox-90x120');
    const half = { ...full, output: { ...full.output, powerStops: 1 } } as LightState;
    const oneMetre = illuminanceAt(full, [0, 0, 2], [0, 0, -1]);
    const halfPower = illuminanceAt(half, [0, 0, 2], [0, 0, -1]);
    const twoMetres = illuminanceAt(full, [0, 0, 4], [0, 0, -1]);
    expect(Math.log2(oneMetre / halfPower)).toBeCloseTo(1, 10);
    expect(Math.log2(oneMetre / twoMetres)).toBeCloseTo(2, 10);
  });

  it('models a 200 W, 120 lm/W LED in a 60×90 softbox at ISO 800 and 1/60 s', () => {
    const light = createLight('led', 'LED', {
      position: [0, 0, 0],
      target: [0, 0, 1],
      modifierId: 'softbox-60x90',
      output: { kind: 'continuous', watts: 200, lumensPerWatt: 120 },
    });
    const doc = withLight(light);
    doc.camera.iso = 800;
    doc.camera.shutterS = 1 / 60;
    const reading = meterReading(doc, [0, 0, 1.5], 'toward-each-light');
    // This is the literal lumen/second result of 24,000 lm and the current 1.5-stop box loss.
    expect(reading.aperture).toBeCloseTo(8, 1);
    expect(reading.lights[0]?.luxSeconds).toBeCloseTo(20, 1);
  });

  it('narrows a fitted grid and applies the hard-ish forward cutoff', () => {
    const light = calibratedLight('softbox-90x120');
    const grid = { ...light, accessories: { gridDeg: 10, barnDoors: null } };
    const direction = (degrees: number): [number, number, number] => {
      const r = (degrees * Math.PI) / 180;
      return [Math.sin(r), 0, Math.cos(r)];
    };
    expect(relativeIntensity(light, direction(15))).toBeGreaterThan(0);
    expect(relativeIntensity(grid, direction(15))).toBe(0);
    expect(onAxisIntensity(grid).value).toBeCloseTo(onAxisIntensity(light).value / 2 ** 0.5, 9);
  });

  it('limits barn doors per side in the source-local frame', () => {
    const light = {
      ...calibratedLight('reflector-std'),
      accessories: { gridDeg: null, barnDoors: { top: 40, bottom: 0, left: 0, right: 0 } },
    };
    const angle = (degrees: number, vertical: boolean): [number, number, number] => {
      const r = (degrees * Math.PI) / 180;
      return vertical ? [0, Math.sin(r), Math.cos(r)] : [Math.sin(r), 0, Math.cos(r)];
    };
    expect(relativeIntensity(light, angle(55, true))).toBe(0);
    expect(relativeIntensity(light, angle(55, false))).toBeGreaterThan(0);
  });

  it('adds light contributions and reports camera exposure difference', () => {
    const doc = createDefaultScene();
    const reading = meterReading(doc, [0, 1.35, 0], 'toward-each-light');
    expect(reading.lights).toHaveLength(1);
    expect(reading.totalLuxSeconds).toBeCloseTo(reading.lights[0]!.luxSeconds, 9);
    expect(reading.stopsOver).toBeCloseTo(2 * Math.log2(reading.aperture / doc.camera.aperture), 9);
  });

  it('keeps the default key near f/11 and about one stop over f/8 at the face', () => {
    const doc = createDefaultScene();
    const reading = meterReading(doc, [0, 1.35, 0], 'toward-each-light');
    expect(reading.aperture).toBeCloseTo(10.8, 1);
    expect(reading.stopsOver).toBeCloseTo(0.9, 1);
  });

  it('integrates continuous light over shutter time but leaves flash energy unchanged', () => {
    const continuous = createLight('led', 'LED', {
      position: [0, 0, 0],
      target: [0, 0, 1],
      output: { kind: 'continuous', watts: 100, lumensPerWatt: 100 },
    });
    const flash = createLight('flash', 'Flash', { position: [0, 0, 0], target: [0, 0, 1] });
    const doc = withLight(continuous);
    const short = meterReading(doc, [0, 0, 2], 'toward-each-light');
    doc.camera.shutterS *= 2;
    const long = meterReading(doc, [0, 0, 2], 'toward-each-light');
    expect(long.totalLuxSeconds).toBeCloseTo(short.totalLuxSeconds * 2, 10);

    doc.lights = [flash];
    const flashShort = meterReading(doc, [0, 0, 2], 'toward-each-light');
    doc.camera.shutterS *= 2;
    const flashLong = meterReading(doc, [0, 0, 2], 'toward-each-light');
    expect(flashLong.totalLuxSeconds).toBeCloseTo(flashShort.totalLuxSeconds, 10);
  });

  it('normalizes Kelvin colour to unit photometric luminance', () => {
    for (const kelvin of [2200, 3200, 5500, 9000]) {
      const [r, g, b] = kelvinToRgb(kelvin);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 10);
    }
  });

  it('renders a light at the white-balance temperature as neutral', () => {
    const [r, g, b] = lightColor(5500, 5500);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(1, 6);
    const [tr, , tb] = lightColor(3200, 5500);
    expect(tr).toBeGreaterThan(tb);
  });
});
