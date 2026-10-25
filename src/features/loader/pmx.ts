/** Typed PMX 2.0/2.1 reader. It deliberately has no three.js or browser dependency. */

export type PmxVec2 = [number, number];
export type PmxVec3 = [number, number, number];
export type PmxVec4 = [number, number, number, number];

export interface PmxHeader {
  version: number;
  textEncoding: 'utf-8' | 'utf-16le';
  additionalUvCount: number;
  vertexIndexSize: number;
  textureIndexSize: number;
  materialIndexSize: number;
  boneIndexSize: number;
  morphIndexSize: number;
  rigidBodyIndexSize: number;
}

export interface PmxModelInfo {
  name: string;
  englishName: string;
  comment: string;
  englishComment: string;
}

export type PmxWeight =
  | { kind: 'BDEF1'; boneIndices: [number]; weights: [1] }
  | { kind: 'BDEF2' | 'SDEF'; boneIndices: [number, number]; weights: [number, number] }
  | { kind: 'BDEF4' | 'QDEF'; boneIndices: [number, number, number, number]; weights: [number, number, number, number] };

export interface PmxVertex {
  position: PmxVec3;
  normal: PmxVec3;
  uv: PmxVec2;
  additionalUvs: PmxVec4[];
  weight: PmxWeight;
  edgeScale: number;
}

export interface PmxMaterial {
  name: string;
  englishName: string;
  diffuse: PmxVec4;
  specular: PmxVec3;
  specularPower: number;
  ambient: PmxVec3;
  flags: number;
  edgeColor: PmxVec4;
  edgeSize: number;
  textureIndex: number;
  sphereTextureIndex: number;
  sphereMode: number;
  toonTextureIndex: number;
  toonShared: boolean;
  memo: string;
  vertexCount: number;
}

export interface PmxBone {
  name: string;
  englishName: string;
  position: PmxVec3;
  parentIndex: number;
  flags: number;
}

export interface PmxVertexMorphOffset {
  vertexIndex: number;
  offset: PmxVec3;
}

export interface PmxMorph {
  name: string;
  englishName: string;
  panel: number;
  type: number;
  vertexOffsets?: PmxVertexMorphOffset[];
}

export interface PmxDisplayFrame {
  name: string;
  englishName: string;
  special: boolean;
  elements: { kind: 'bone' | 'morph'; index: number }[];
}

export interface PmxRigidBody {
  name: string;
  englishName: string;
  boneIndex: number;
  collisionGroup: number;
  shape: number;
}

export interface PmxJoint {
  name: string;
  englishName: string;
  type: number;
  rigidBodyA: number;
  rigidBodyB: number;
}

export interface PmxDocument {
  header: PmxHeader;
  model: PmxModelInfo;
  vertices: PmxVertex[];
  /** Each face is a triangle of vertex indices, already grouped by material order. */
  faces: [number, number, number][];
  textures: string[];
  materials: PmxMaterial[];
  bones: PmxBone[];
  morphs: PmxMorph[];
  displayFrames: PmxDisplayFrame[];
  rigidBodies: PmxRigidBody[];
  joints: PmxJoint[];
  ikBoneCount: number;
}

class Reader {
  private readonly view: DataView;
  offset = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    if (data instanceof Uint8Array) {
      this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.view = new DataView(data);
    }
  }

  private ensure(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.view.byteLength) {
      throw new Error(`Unexpected end of PMX data at byte ${this.offset}`);
    }
  }

  bytes(size: number): Uint8Array {
    this.ensure(size);
    const value = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, size);
    this.offset += size;
    return value;
  }

  skip(size: number): void {
    this.ensure(size);
    this.offset += size;
  }

  u8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  i8(): number {
    this.ensure(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  index(size: number, unsigned = false): number {
    switch (size) {
      case 1:
        return unsigned ? this.u8() : this.i8();
      case 2:
        if (unsigned) {
          this.ensure(2);
          const value = this.view.getUint16(this.offset, true);
          this.offset += 2;
          return value;
        }
        this.ensure(2);
        {
          const value = this.view.getInt16(this.offset, true);
          this.offset += 2;
          return value;
        }
      case 4:
        return unsigned ? this.u32() : this.i32();
      default:
        throw new Error(`Unsupported PMX index size: ${size} bytes`);
    }
  }

  vec2(): PmxVec2 {
    return [this.f32(), this.f32()];
  }

  vec3(): PmxVec3 {
    return [this.f32(), this.f32(), this.f32()];
  }

  vec4(): PmxVec4 {
    return [this.f32(), this.f32(), this.f32(), this.f32()];
  }

  count(label: string): number {
    const count = this.i32();
    if (count < 0 || count > 10_000_000) throw new Error(`Invalid PMX ${label} count: ${count}`);
    return count;
  }
}

/** Parses a PMX model, with explicit bounds checks so corrupt files fail clearly. */
export function parsePmx(data: ArrayBuffer | Uint8Array): PmxDocument {
  const reader = new Reader(data);
  const magic = new TextDecoder('ascii').decode(reader.bytes(4));
  if (magic !== 'PMX ') throw new Error('Invalid PMX file: expected "PMX " magic');

  const version = reader.f32();
  if (!Number.isFinite(version) || (Math.abs(version - 2.0) > 0.01 && Math.abs(version - 2.1) > 0.01)) {
    throw new Error(`Unsupported PMX version ${version}; expected PMX 2.0 or 2.1`);
  }

  const headerLength = reader.u8();
  if (headerLength < 8) throw new Error(`Invalid PMX header: expected at least 8 settings, got ${headerLength}`);
  const settings = reader.bytes(headerLength);
  const encoding = settings[0] === 0 ? 'utf-16le' : 'utf-8';
  const header: PmxHeader = {
    version,
    textEncoding: encoding,
    additionalUvCount: settings[1] ?? 0,
    vertexIndexSize: settings[2] ?? 0,
    textureIndexSize: settings[3] ?? 0,
    materialIndexSize: settings[4] ?? 0,
    boneIndexSize: settings[5] ?? 0,
    morphIndexSize: settings[6] ?? 0,
    rigidBodyIndexSize: settings[7] ?? 0,
  };
  for (const [label, size] of Object.entries({
    vertex: header.vertexIndexSize,
    texture: header.textureIndexSize,
    material: header.materialIndexSize,
    bone: header.boneIndexSize,
    morph: header.morphIndexSize,
    rigidBody: header.rigidBodyIndexSize,
  })) {
    if (size !== 1 && size !== 2 && size !== 4) throw new Error(`Invalid PMX ${label} index size: ${size}`);
  }
  if (header.additionalUvCount > 4) throw new Error(`Invalid PMX additional UV count: ${header.additionalUvCount}`);

  // The string decoder is selected from the file header, not the PMX magic.
  const textReader = new TextReader(reader, encoding);
  const model: PmxModelInfo = {
    name: textReader.text(),
    englishName: textReader.text(),
    comment: textReader.text(),
    englishComment: textReader.text(),
  };

  const vertices: PmxVertex[] = [];
  for (let i = 0, count = textReader.count('vertex'); i < count; i++) {
    const position = textReader.vec3();
    const normal = textReader.vec3();
    const uv = textReader.vec2();
    const additionalUvs: PmxVec4[] = [];
    for (let uvIndex = 0; uvIndex < header.additionalUvCount; uvIndex++) additionalUvs.push(textReader.vec4());

    const weightType = textReader.u8();
    let weight: PmxWeight;
    switch (weightType) {
      case 0: {
        const boneIndex = textReader.index(header.boneIndexSize);
        weight = { kind: 'BDEF1', boneIndices: [boneIndex], weights: [1] };
        break;
      }
      case 1: {
        const first = textReader.index(header.boneIndexSize);
        const second = textReader.index(header.boneIndexSize);
        const firstWeight = textReader.f32();
        weight = { kind: 'BDEF2', boneIndices: [first, second], weights: [firstWeight, 1 - firstWeight] };
        break;
      }
      case 2:
      case 4: {
        const boneIndices = [0, 0, 0, 0] as [number, number, number, number];
        const weights = [0, 0, 0, 0] as [number, number, number, number];
        for (let n = 0; n < 4; n++) boneIndices[n] = textReader.index(header.boneIndexSize);
        for (let n = 0; n < 4; n++) weights[n] = textReader.f32();
        weight = { kind: weightType === 2 ? 'BDEF4' : 'QDEF', boneIndices, weights };
        break;
      }
      case 3: {
        const first = textReader.index(header.boneIndexSize);
        const second = textReader.index(header.boneIndexSize);
        const firstWeight = textReader.f32();
        textReader.skip(36); // SDEF C, R0 and R1; we skin these as BDEF2.
        weight = { kind: 'SDEF', boneIndices: [first, second], weights: [firstWeight, 1 - firstWeight] };
        break;
      }
      default:
        throw new Error(`Unsupported PMX vertex weight type ${weightType} at vertex ${i}`);
    }
    vertices.push({ position, normal, uv, additionalUvs, weight, edgeScale: textReader.f32() });
  }

  const indexCount = textReader.count('face index');
  if (indexCount % 3 !== 0) throw new Error(`Invalid PMX face index count ${indexCount}; faces must be triangles`);
  const faces: [number, number, number][] = [];
  for (let i = 0; i < indexCount; i += 3) {
    faces.push([
      textReader.index(header.vertexIndexSize, true),
      textReader.index(header.vertexIndexSize, true),
      textReader.index(header.vertexIndexSize, true),
    ]);
  }

  const textures = Array.from({ length: textReader.count('texture') }, () => textReader.text());
  const materials: PmxMaterial[] = [];
  for (let i = 0, count = textReader.count('material'); i < count; i++) {
    const name = textReader.text();
    const englishName = textReader.text();
    const diffuse = textReader.vec4();
    const specular = textReader.vec3();
    const specularPower = textReader.f32();
    const ambient = textReader.vec3();
    const flags = textReader.u8();
    const edgeColor = textReader.vec4();
    const edgeSize = textReader.f32();
    const textureIndex = textReader.index(header.textureIndexSize);
    const sphereTextureIndex = textReader.index(header.textureIndexSize);
    const sphereMode = textReader.u8();
    const toonShared = textReader.u8() !== 0;
    const toonTextureIndex = toonShared ? textReader.u8() : textReader.index(header.textureIndexSize);
    const memo = textReader.text();
    const vertexCount = textReader.count(`material ${i} index`);
    materials.push({
      name,
      englishName,
      diffuse,
      specular,
      specularPower,
      ambient,
      flags,
      edgeColor,
      edgeSize,
      textureIndex,
      sphereTextureIndex,
      sphereMode,
      toonTextureIndex,
      toonShared,
      memo,
      vertexCount,
    });
  }

  const bones: PmxBone[] = [];
  let ikBoneCount = 0;
  for (let i = 0, count = textReader.count('bone'); i < count; i++) {
    const name = textReader.text();
    const englishName = textReader.text();
    const position = textReader.vec3();
    const parentIndex = textReader.index(header.boneIndexSize);
    textReader.i32(); // transform layer
    const flags = textReader.u16();
    if (flags & 0x0001) textReader.index(header.boneIndexSize);
    else textReader.skip(12);
    if (flags & 0x0300) {
      textReader.index(header.boneIndexSize);
      textReader.f32();
    }
    if (flags & 0x0400) textReader.skip(12);
    if (flags & 0x0800) textReader.skip(24);
    if (flags & 0x2000) textReader.i32();
    if (flags & 0x0020) {
      ikBoneCount++;
      textReader.index(header.boneIndexSize);
      textReader.i32();
      textReader.f32();
      for (let linkIndex = 0, links = textReader.count(`bone ${i} IK link`); linkIndex < links; linkIndex++) {
        textReader.index(header.boneIndexSize);
        if (textReader.u8() !== 0) textReader.skip(24);
      }
    }
    bones.push({ name, englishName, position, parentIndex, flags });
  }

  const morphs: PmxMorph[] = [];
  for (let i = 0, count = textReader.count('morph'); i < count; i++) {
    const name = textReader.text();
    const englishName = textReader.text();
    const panel = textReader.u8();
    const type = textReader.u8();
    const offsetCount = textReader.count(`morph ${i} offset`);
    const morph: PmxMorph = { name, englishName, panel, type };
    if (type === 1) {
      const vertexOffsets: PmxVertexMorphOffset[] = [];
      for (let n = 0; n < offsetCount; n++) {
        vertexOffsets.push({
          vertexIndex: textReader.index(header.vertexIndexSize, true),
          offset: textReader.vec3(),
        });
      }
      morph.vertexOffsets = vertexOffsets;
    } else {
      for (let n = 0; n < offsetCount; n++) skipMorphOffset(textReader, type, header);
    }
    morphs.push(morph);
  }

  const displayFrames: PmxDisplayFrame[] = [];
  for (let i = 0, count = textReader.count('display frame'); i < count; i++) {
    const name = textReader.text();
    const englishName = textReader.text();
    const special = textReader.u8() !== 0;
    const elements: PmxDisplayFrame['elements'] = [];
    for (let n = 0, entries = textReader.count(`display frame ${i} element`); n < entries; n++) {
      const kind = textReader.u8();
      if (kind !== 0 && kind !== 1) throw new Error(`Invalid PMX display frame element type ${kind}`);
      elements.push({ kind: kind === 0 ? 'bone' : 'morph', index: textReader.index(kind === 0 ? header.boneIndexSize : header.morphIndexSize) });
    }
    displayFrames.push({ name, englishName, special, elements });
  }

  const rigidBodies: PmxRigidBody[] = [];
  for (let i = 0, count = textReader.count('rigid body'); i < count; i++) {
    const name = textReader.text();
    const englishName = textReader.text();
    const boneIndex = textReader.index(header.boneIndexSize);
    const collisionGroup = textReader.u8();
    textReader.u16(); // collision mask
    const shape = textReader.u8();
    textReader.skip(36 + 20 + 1); // shape, transform, physical properties and mode
    rigidBodies.push({ name, englishName, boneIndex, collisionGroup, shape });
  }

  const joints: PmxJoint[] = [];
  for (let i = 0, count = textReader.count('joint'); i < count; i++) {
    const name = textReader.text();
    const englishName = textReader.text();
    const type = textReader.u8();
    if (type < 0 || type > 5) throw new Error(`Unsupported PMX joint type ${type}`);
    const rigidBodyA = textReader.index(header.rigidBodyIndexSize);
    const rigidBodyB = textReader.index(header.rigidBodyIndexSize);
    textReader.skip(6 * 4 * 3); // position, rotation, and min/max translation/rotation
    textReader.skip(6 * 4); // spring translation and rotation
    joints.push({ name, englishName, type, rigidBodyA, rigidBodyB });
  }

  return { header, model, vertices, faces, textures, materials, bones, morphs, displayFrames, rigidBodies, joints, ikBoneCount };
}

function skipMorphOffset(reader: TextReader, type: number, header: PmxHeader): void {
  switch (type) {
    case 0: // group
    case 9: // flip
      reader.index(header.morphIndexSize);
      reader.f32();
      return;
    case 2: // bone
      reader.index(header.boneIndexSize);
      reader.skip(28);
      return;
    case 3:
    case 4:
    case 5:
    case 6:
    case 7: // UV and additional-UV offsets
      reader.index(header.vertexIndexSize, true);
      reader.skip(16);
      return;
    case 8: // material
      reader.index(header.materialIndexSize);
      reader.u8();
      reader.skip(112);
      return;
    case 10: // impulse
      reader.index(header.rigidBodyIndexSize);
      reader.u8();
      reader.skip(24);
      return;
    default:
      throw new Error(`Unsupported PMX morph type ${type}`);
  }
}

/** Reader facade that keeps the file-selected text encoding in one place. */
class TextReader {
  private readonly decoder: TextDecoder;

  constructor(private readonly reader: Reader, encoding: 'utf-8' | 'utf-16le') {
    this.decoder = new TextDecoder(encoding);
  }

  text(): string {
    const size = this.i32();
    if (size < 0) throw new Error(`Invalid PMX string length: ${size}`);
    return this.decoder.decode(this.bytes(size));
  }

  bytes(size: number): Uint8Array { return this.reader.bytes(size); }
  skip(size: number): void { this.reader.skip(size); }
  u8(): number { return this.reader.u8(); }
  u16(): number { return this.reader.u16(); }
  i32(): number { return this.reader.i32(); }
  f32(): number { return this.reader.f32(); }
  count(label: string): number { return this.reader.count(label); }
  index(size: number, unsigned = false): number { return this.reader.index(size, unsigned); }
  vec2(): PmxVec2 { return this.reader.vec2(); }
  vec3(): PmxVec3 { return this.reader.vec3(); }
  vec4(): PmxVec4 { return this.reader.vec4(); }
}
