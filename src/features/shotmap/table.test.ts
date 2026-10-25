import { describe, expect, it } from 'vitest';
import { createDefaultScene, createLight } from '../../scene/document';
import type { LightRow, PairRow, PropRow } from './table';
import { settingsRows } from './table';

describe('shotmap settings table', () => {
  it('has one row per light and per prop', () => {
    const doc = createDefaultScene();
    doc.lights.push(createLight('rim', 'Rim', { position: [-1.5, 2, 1.5] }));
    doc.props.push({
      id: 'bounce-1',
      name: 'Bounce board',
      kind: 'bounce',
      position: [-1.2, 1, 0.8],
      target: [0, 1.3, 0],
      rollDeg: 0,
      widthM: 1.2,
      heightM: 2,
      color: '#ffffff',
      transmission: 0,
    });
    const rows = settingsRows(doc);
    expect(rows.filter((r) => r.kind === 'light')).toHaveLength(doc.lights.length);
    expect(rows.filter((r) => r.kind === 'prop')).toHaveLength(doc.props.length);
    expect(rows.some((r) => r.kind === 'pair' && r.section === 'Camera')).toBe(true);
    expect(rows.some((r) => r.kind === 'pair' && r.section === 'Environment')).toBe(true);
  });

  it('reads camera settings and distances', () => {
    const rows = settingsRows(createDefaultScene());
    const pair = (label: string): PairRow => {
      const row = rows.find((r) => r.kind === 'pair' && r.label === label);
      expect(row).toBeDefined();
      return row as PairRow;
    };
    expect(pair('Body').value).toBe('Full frame');
    expect(pair('Sensor').value).toBe('36 × 24 mm');
    expect(pair('Focal length').value).toBe('85 mm');
    expect(pair('Aperture').value).toBe('f/8');
    expect(pair('Shutter').value).toBe('1/125');
    expect(pair('ISO').value).toBe('100');
    expect(pair('Focus distance').value).toBe('3.5 m');
    // Camera at (0, 1.45, 3.5) to the subject at the origin.
    expect(pair('Distance to subject').value).toBe('3.8 m');
    expect(pair('Height').value).toBe('1.5 m');
  });

  it('formats each light: power, modifier, distance, height and angle', () => {
    const doc = createDefaultScene();
    doc.lights[0]!.accessories.gridDeg = 20;
    doc.lights.push(createLight('fill', 'Fill', { position: [-1.5, 2, 1.5] }));
    doc.lights.push(
      createLight('led', 'LED', {
        position: [0, 2, -1.5],
        output: { kind: 'continuous', watts: 200, lumensPerWatt: 100 },
        modifierId: 'bare',
      }),
    );
    const rows = settingsRows(doc).filter((r): r is LightRow => r.kind === 'light');

    expect(rows[0]!.name).toBe('Key');
    expect(rows[0]!.type).toBe('Strobe');
    expect(rows[0]!.output).toBe('500 Ws · 1/1');
    expect(rows[0]!.modifier).toBe('Softbox 90×120 + grid 20°');
    expect(rows[0]!.colorTemp).toBe('5500 K');
    // (1.5, 2, 1.5) to the origin, 3D.
    expect(rows[0]!.distanceM).toBe('2.9 m');
    expect(rows[0]!.heightM).toBe('2.0 m');
    expect(rows[0]!.angle).toBe('45° camera-right');

    expect(rows[1]!.angle).toBe('45° camera-left');

    expect(rows[2]!.type).toBe('Continuous');
    expect(rows[2]!.output).toBe('200 W');
    expect(rows[2]!.modifier).toBe('Bare bulb');
  });

  it('reports the environment with a backdrop swatch', () => {
    const rows = settingsRows(createDefaultScene());
    const backdrop = rows.find((r): r is PairRow => r.kind === 'pair' && r.label === 'Backdrop colour');
    expect(backdrop?.value).toBe('#8a8d91');
    expect(backdrop?.swatch).toBe('#8a8d91');
    const ambient = rows.find((r): r is PairRow => r.kind === 'pair' && r.label === 'Ambient');
    expect(ambient?.value).toBe('0 lux');
  });

  it('lists prop kind and size', () => {
    const doc = createDefaultScene();
    doc.props.push({
      id: 'flag-1',
      name: 'Flag',
      kind: 'flag',
      position: [1, 1, 1],
      target: [0, 1.3, 0],
      rollDeg: 0,
      widthM: 0.9,
      heightM: 1.2,
      color: '#000000',
      transmission: 0,
    });
    const row = settingsRows(doc).find((r): r is PropRow => r.kind === 'prop');
    expect(row?.name).toBe('Flag');
    expect(row?.propKind).toBe('Flag');
    expect(row?.size).toBe('0.9 × 1.2 m');
  });
});
