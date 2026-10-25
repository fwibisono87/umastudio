import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from 'three';
import type { Material } from 'three';
import type { SubjectModel } from '../../core/context';
import { MMD_UNIT_M } from '../../scene/units';
import { canonicalBoneName } from './boneMap';
import type { PmxDocument, PmxVec3 } from './pmx';

/** Reflect PMX's left-handed Z axis, then scale model-space distances into metres. */
export function convertPmxPosition([x, y, z]: PmxVec3): PmxVec3 {
  return [x * MMD_UNIT_M, y * MMD_UNIT_M, -z * MMD_UNIT_M];
}

/** Normals are directions, so reflect Z without applying the distance scale. */
export function convertPmxNormal([x, y, z]: PmxVec3): PmxVec3 {
  return [x, y, -z];
}

/** Builds one rest-pose skinned mesh and its complete PMX bone hierarchy. */
export function buildSubjectModel(pmx: PmxDocument, materials: Material[]): SubjectModel {
  if (pmx.bones.length === 0) throw new Error('This PMX model has no bones and cannot be skinned');
  if (pmx.bones.length > 65_535) throw new Error('This PMX model has too many bones for a four-weight skin');
  const indexCount = pmx.faces.length * 3;
  const materialIndexCount = pmx.materials.reduce((sum, material) => sum + material.vertexCount, 0);
  if (materialIndexCount !== indexCount) {
    throw new Error(`PMX materials cover ${materialIndexCount} indices, but the model has ${indexCount}`);
  }
  for (const [faceIndex, face] of pmx.faces.entries()) {
    for (const vertexIndex of face) {
      if (vertexIndex < 0 || vertexIndex >= pmx.vertices.length) {
        throw new Error(`Face ${faceIndex} references missing vertex ${vertexIndex}`);
      }
    }
  }
  for (const [vertexIndex, vertex] of pmx.vertices.entries()) {
    for (let n = 0; n < vertex.weight.boneIndices.length; n++) {
      const boneIndex = vertex.weight.boneIndices[n]!;
      if (vertex.weight.weights[n]! > 0 && (boneIndex < 0 || boneIndex >= pmx.bones.length)) {
        throw new Error(`Vertex ${vertexIndex} references missing bone ${boneIndex}`);
      }
    }
  }
  for (const morph of pmx.morphs) {
    for (const { vertexIndex } of morph.vertexOffsets ?? []) {
      if (vertexIndex < 0 || vertexIndex >= pmx.vertices.length) {
        throw new Error(`Morph "${morph.name}" references missing vertex ${vertexIndex}`);
      }
    }
  }

  const root = new Group();
  root.name = pmx.model.englishName || pmx.model.name || 'PMX model';
  const geometry = new BufferGeometry();
  const positions = new Float32Array(pmx.vertices.length * 3);
  const normals = new Float32Array(pmx.vertices.length * 3);
  const uvs = new Float32Array(pmx.vertices.length * 2);
  const skinIndices = new Uint16Array(pmx.vertices.length * 4);
  const skinWeights = new Float32Array(pmx.vertices.length * 4);

  pmx.vertices.forEach((vertex, vertexIndex) => {
    const position = convertPmxPosition(vertex.position);
    const normal = convertPmxNormal(vertex.normal);
    const p = vertexIndex * 3;
    const uv = vertexIndex * 2;
    const skin = vertexIndex * 4;
    positions.set(position, p);
    normals.set(normal, p);
    uvs.set(vertex.uv, uv);
    for (let n = 0; n < vertex.weight.boneIndices.length; n++) {
      const boneIndex = vertex.weight.boneIndices[n]!;
      const weight = vertex.weight.weights[n]!;
      skinIndices[skin + n] = boneIndex >= 0 && boneIndex < pmx.bones.length ? boneIndex : 0;
      skinWeights[skin + n] = weight;
    }
  });

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));

  const indices = new Uint32Array(pmx.faces.length * 3);
  pmx.faces.forEach(([a, b, c], faceIndex) => {
    // The Z reflection changes handedness, so reverse each face to retain front sides.
    const start = faceIndex * 3;
    indices[start] = a;
    indices[start + 1] = c;
    indices[start + 2] = b;
  });
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));

  let groupStart = 0;
  for (const [materialIndex, material] of pmx.materials.entries()) {
    geometry.addGroup(groupStart, material.vertexCount, materialIndex);
    groupStart += material.vertexCount;
  }
  const morphNames: string[] = [];
  const positionMorphs: Float32BufferAttribute[] = [];
  for (const morph of pmx.morphs) {
    if (!morph.vertexOffsets) continue;
    const deltas = new Float32Array(pmx.vertices.length * 3);
    for (const { vertexIndex, offset } of morph.vertexOffsets) {
      const converted = convertPmxPosition(offset);
      const start = vertexIndex * 3;
      deltas[start] = deltas[start]! + converted[0];
      deltas[start + 1] = deltas[start + 1]! + converted[1];
      deltas[start + 2] = deltas[start + 2]! + converted[2];
    }
    const attribute = new Float32BufferAttribute(deltas, 3);
    attribute.name = morph.name;
    positionMorphs.push(attribute);
    morphNames.push(morph.name);
  }
  if (positionMorphs.length > 0) {
    geometry.morphAttributes.position = positionMorphs;
    geometry.morphTargetsRelative = true;
  }

  const bones = pmx.bones.map((pmxBone, index) => {
    const bone = new Bone();
    bone.name = canonicalBoneName(pmxBone.name || pmxBone.englishName);
    bone.userData.pmxName = pmxBone.name;
    bone.userData.pmxEnglishName = pmxBone.englishName;
    const position = convertPmxPosition(pmxBone.position);
    const parentIndex = pmxBone.parentIndex;
    if (parentIndex >= 0 && parentIndex < pmx.bones.length && parentIndex !== index) {
      const parent = convertPmxPosition(pmx.bones[parentIndex]!.position);
      bone.position.set(position[0] - parent[0], position[1] - parent[1], position[2] - parent[2]);
    } else {
      bone.position.set(...position);
    }
    bone.quaternion.identity();
    return bone;
  });

  const bonesByName = new Map<string, Bone>();
  const restRotations = new Map<string, import('three').Quaternion>();
  bones.forEach((bone, index) => {
    const parentIndex = pmx.bones[index]!.parentIndex;
    if (parentIndex >= 0 && parentIndex < bones.length && parentIndex !== index) {
      bones[parentIndex]!.add(bone);
    } else {
      root.add(bone);
    }
    // A Japanese alias can collide with an existing canonical name; keep the first bone
    // as the stable lookup target while preserving every Bone in the actual skeleton.
    if (!bonesByName.has(bone.name)) {
      bonesByName.set(bone.name, bone);
      restRotations.set(bone.name, bone.quaternion.clone());
    }
  });

  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = `${root.name} mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.normalizeSkinWeights();
  root.add(mesh);

  // Binding after the full hierarchy is parented computes inverse bind matrices from
  // these rest transforms, leaving every source vertex exactly where PMX placed it.
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  mesh.bind(skeleton);
  mesh.updateMorphTargets();
  if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);

  return { root, meshes: [mesh], bones: bonesByName, restRotations, morphNames };
}
