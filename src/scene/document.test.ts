import { describe, expect, it } from 'vitest';
import { createDefaultScene, nextId, parseScene } from './document';
import { MODIFIERS } from './modifiers';

describe('scene document', () => {
  it('round-trips through JSON', () => {
    const doc = createDefaultScene();
    expect(parseScene(JSON.stringify(doc))).toEqual(doc);
  });

  it('fills fields missing from older files', () => {
    const doc = createDefaultScene() as unknown as Record<string, unknown>;
    delete doc.props;
    const env = doc.environment as Record<string, unknown>;
    delete env.ambientLux;
    const parsed = parseScene(doc);
    expect(parsed.props).toEqual([]);
    expect(parsed.environment.ambientLux).toBe(0);
  });

  it('rejects non-scenes and newer versions', () => {
    expect(() => parseScene('{"hello":1}')).toThrow(/Not a umastudio scene/);
    expect(() => parseScene({ ...createDefaultScene(), version: 99 })).toThrow(/newer/);
  });

  it('hands out unused ids', () => {
    const doc = createDefaultScene();
    doc.lights[0]!.id = 'light-1';
    expect(nextId(doc, 'light')).toBe('light-2');
  });

  it('references only known modifiers by default', () => {
    const ids = new Set(MODIFIERS.map((m) => m.id));
    expect(ids.size).toBe(MODIFIERS.length);
    for (const l of createDefaultScene().lights) expect(ids.has(l.modifierId)).toBe(true);
  });
});
