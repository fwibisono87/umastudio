import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePmx } from './pmx';

declare const process: { env: Record<string, string | undefined> };

class PmxWriter {
  private readonly data: number[] = [];

  bytes(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.data.push(values[i]!);
    return this;
  }

  u8(value: number): this { this.data.push(value & 0xff); return this; }
  i8(value: number): this { this.data.push(value & 0xff); return this; }

  u16(value: number): this {
    this.data.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  i32(value: number): this {
    this.data.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    return this;
  }

  f32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    return this.bytes(bytes);
  }

  vec2(x: number, y: number): this { return this.f32(x).f32(y); }
  vec3(x: number, y: number, z: number): this { return this.f32(x).f32(y).f32(z); }
  vec4(x: number, y: number, z: number, w: number): this { return this.f32(x).f32(y).f32(z).f32(w); }

  text(value: string): this {
    const encoded = new Uint8Array(value.length * 2);
    const view = new DataView(encoded.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
    return this.i32(encoded.length).bytes(encoded);
  }

  result(): Uint8Array { return new Uint8Array(this.data); }
}

function syntheticPmx(): Uint8Array {
  const w = new PmxWriter();
  w.bytes([0x50, 0x4d, 0x58, 0x20]).f32(2.0).u8(8).bytes([0, 0, 1, 1, 1, 1, 1, 1]);
  w.text('うま').text('Sample').text('comment').text('English comment');

  w.i32(3);
  for (const [position, uv] of [
    [[0, 0, 0], [0, 0]],
    [[1, 0, -1], [1, 0]],
    [[0, 1, -1], [0, 1]],
  ] as const) {
    w.vec3(position[0], position[1], position[2]).vec3(0, 0, 1).vec2(uv[0], uv[1]).u8(0).i8(0).f32(1);
  }
  w.i32(3).u8(0).u8(1).u8(2);
  w.i32(1).text('Texture2D/face.png');

  w.i32(1).text('face').text('face');
  w.vec4(0.8, 0.6, 0.5, 1).vec3(0.1, 0.1, 0.1).f32(8).vec3(0.2, 0.2, 0.2);
  w.u8(1).vec4(0, 0, 0, 1).f32(1).i8(0).i8(-1).u8(0).u8(1).u8(0).text('skin').i32(3);

  w.i32(2);
  w.text('センター').text('Position').vec3(0, 0, 0).i8(-1).i32(0).u16(0).vec3(0, 1, 0);
  w.text('頭').text('Head').vec3(0, 1, 0).i8(0).i32(0).u16(0).vec3(0, 0.2, 0);

  w.i32(1).text('Smile').text('Smile').u8(1).u8(1).i32(1).u8(1).vec3(0, 0.1, -0.2);
  w.i32(0); // display frames
  w.i32(0); // rigid bodies
  w.i32(0); // joints
  return w.result();
}

describe('parsePmx', () => {
  it('parses UTF-16LE model text, weights, materials, bones, and vertex morph offsets', () => {
    const pmx = parsePmx(syntheticPmx());
    expect(pmx.header).toMatchObject({ version: 2, textEncoding: 'utf-16le', additionalUvCount: 0 });
    expect(pmx.model).toMatchObject({ name: 'うま', englishName: 'Sample', comment: 'comment' });
    expect(pmx.vertices).toHaveLength(3);
    expect(pmx.vertices[0]!.weight).toEqual({ kind: 'BDEF1', boneIndices: [0], weights: [1] });
    expect(pmx.faces).toEqual([[0, 1, 2]]);
    expect(pmx.textures).toEqual(['Texture2D/face.png']);
    expect(pmx.materials[0]).toMatchObject({ name: 'face', textureIndex: 0, vertexCount: 3 });
    expect(pmx.materials[0]!.diffuse[0]).toBeCloseTo(0.8);
    expect(pmx.materials[0]!.diffuse[1]).toBeCloseTo(0.6);
    expect(pmx.bones.map((bone) => [bone.name, bone.parentIndex])).toEqual([['センター', -1], ['頭', 0]]);
    expect(pmx.morphs[0]).toMatchObject({ name: 'Smile', type: 1 });
    expect(pmx.morphs[0]!.vertexOffsets?.[0]!.vertexIndex).toBe(1);
    expect(pmx.morphs[0]!.vertexOffsets?.[0]!.offset[1]).toBeCloseTo(0.1);
    expect(pmx.morphs[0]!.vertexOffsets?.[0]!.offset[2]).toBeCloseTo(-0.2);
    expect(pmx.displayFrames).toEqual([]);
    expect(pmx.rigidBodies).toEqual([]);
    expect(pmx.joints).toEqual([]);
  });

  it('reports bad magic and unsupported versions clearly', () => {
    const invalidMagic = syntheticPmx().slice();
    invalidMagic[0] = 0;
    expect(() => parsePmx(invalidMagic)).toThrow('Invalid PMX file: expected "PMX " magic');

    const invalidVersion = syntheticPmx().slice();
    new DataView(invalidVersion.buffer).setFloat32(4, 1.0, true);
    expect(() => parsePmx(invalidVersion)).toThrow('Unsupported PMX version 1');
  });

  const testPath = process.env.UMASTUDIO_TEST_PMX ?? '/home/francis/Downloads/1060_Nice Nature.pmx';
  it.skipIf(!existsSync(testPath))('parses the Nice Nature UmaViewer export', () => {
    const pmx = parsePmx(readFileSync(testPath));
    expect(pmx.bones).toHaveLength(436);
    expect(pmx.vertices).toHaveLength(15_614);
    expect(pmx.faces).toHaveLength(30_016);
    expect(pmx.morphs.filter((morph) => morph.vertexOffsets !== undefined)).toHaveLength(240);
    expect(pmx.materials).toHaveLength(10);
    expect(pmx.textures).toHaveLength(22);
    expect(pmx.ikBoneCount).toBe(0);
    expect(pmx.rigidBodies).toHaveLength(0);
  });
});
