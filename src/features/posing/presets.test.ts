import { existsSync, readFileSync } from 'node:fs';
import { Box3, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SubjectModel } from '../../core/context';
import { buildSubjectModel } from '../loader/build';
import { canonicalBoneName } from '../loader/boneMap';
import { parsePmx, type PmxDocument } from '../loader/pmx';
import { mirrorPoseOffsets, offsetToQuaternion } from './poseMath';
import { POSE_PRESETS, type PosePreset } from './presets';

declare const process: { env: Record<string, string | undefined> };

const testPath = process.env.UMASTUDIO_TEST_PMX ?? '/home/francis/Downloads/1060_Nice Nature.pmx';

interface FkFixture {
  pmx: PmxDocument;
  model: SubjectModel;
  materials: MeshBasicMaterial[];
  basePositions: Map<string, Vector3>;
}

interface JointPositions {
  Hip: Vector3;
  Waist: Vector3;
  Spine: Vector3;
  Chest: Vector3;
  Neck: Vector3;
  Head: Vector3;
  Arm_L: Vector3;
  Elbow_L: Vector3;
  Wrist_L: Vector3;
  Arm_R: Vector3;
  Elbow_R: Vector3;
  Wrist_R: Vector3;
  Thigh_L: Vector3;
  Knee_L: Vector3;
  Ankle_L: Vector3;
  Thigh_R: Vector3;
  Knee_R: Vector3;
  Ankle_R: Vector3;
}

function createFixture(): FkFixture {
  const pmx = parsePmx(readFileSync(testPath));
  const materials = pmx.materials.map(() => new MeshBasicMaterial());
  const model = buildSubjectModel(pmx, materials);
  return {
    pmx,
    model,
    materials,
    basePositions: new Map([...model.bones].map(([name, bone]) => [name, bone.position.clone()])),
  };
}

/** Apply the document pose using the same sparse rotations and root translation as posing/index.ts. */
function applyPreset(fixture: FkFixture, preset: Pick<PosePreset, 'bones' | 'rootOffset'>): void {
  const { model, basePositions } = fixture;
  for (const [name, bone] of model.bones) {
    const rest = model.restRotations.get(name) ?? new Quaternion();
    bone.quaternion.copy(offsetToQuaternion(rest, preset.bones[name] ?? [0, 0, 0]));
  }

  const rootBone = model.bones.get('Hip') ?? model.bones.get('Position');
  const basePosition = rootBone && basePositions.get(rootBone.name);
  if (rootBone && basePosition) {
    model.root.updateMatrixWorld(true);
    const rootWorld = model.root.getWorldQuaternion(new Quaternion());
    const parentWorld = rootBone.parent?.getWorldQuaternion(new Quaternion()) ?? rootWorld.clone();
    const parentInModel = rootWorld.clone().invert().multiply(parentWorld).normalize();
    const localOffset = new Vector3(...preset.rootOffset).applyQuaternion(parentInModel.invert());
    rootBone.position.copy(basePosition).add(localOffset);
  }
  model.root.updateMatrixWorld(true);
}

function joint(model: SubjectModel, name: string): Vector3 {
  const bone = model.bones.get(name);
  if (!bone) throw new Error(`Missing joint ${name}`);
  return bone.getWorldPosition(new Vector3());
}

function readJoints(model: SubjectModel): JointPositions {
  return {
    Hip: joint(model, 'Hip'), Waist: joint(model, 'Waist'), Spine: joint(model, 'Spine'),
    Chest: joint(model, 'Chest'), Neck: joint(model, 'Neck'), Head: joint(model, 'Head'),
    Arm_L: joint(model, 'Arm_L'), Elbow_L: joint(model, 'Elbow_L'), Wrist_L: joint(model, 'Wrist_L'),
    Arm_R: joint(model, 'Arm_R'), Elbow_R: joint(model, 'Elbow_R'), Wrist_R: joint(model, 'Wrist_R'),
    Thigh_L: joint(model, 'Thigh_L'), Knee_L: joint(model, 'Knee_L'), Ankle_L: joint(model, 'Ankle_L'),
    Thigh_R: joint(model, 'Thigh_R'), Knee_R: joint(model, 'Knee_R'), Ankle_R: joint(model, 'Ankle_R'),
  };
}

/** Rest mesh bounds for vertices mostly weighted to Hip through Chest, expressed from Hip. */
function restTorsoBounds(fixture: FkFixture): Box3 {
  const torsoNames = new Set(['Hip', 'Waist', 'Spine', 'Chest']);
  const torsoBoneIndices = new Set(fixture.pmx.bones.flatMap((bone, index) =>
    torsoNames.has(canonicalBoneName(bone.name || bone.englishName)) ? [index] : []));
  const mesh = fixture.model.meshes[0]!;
  const positions = mesh.geometry.getAttribute('position');
  const hip = joint(fixture.model, 'Hip');
  const chestY = joint(fixture.model, 'Chest').y;
  const bounds = new Box3();

  fixture.pmx.vertices.forEach((vertex, index) => {
    const trunkWeight = vertex.weight.boneIndices.reduce((sum, boneIndex, weightIndex) =>
      sum + (torsoBoneIndices.has(boneIndex) ? (vertex.weight.weights[weightIndex] ?? 0) : 0), 0);
    if (trunkWeight < 0.5) return;
    const point = mesh.applyBoneTransform(index, new Vector3().fromBufferAttribute(positions, index));
    if (point.y >= hip.y - 0.10 && point.y <= chestY + 0.03) bounds.expandByPoint(point);
  });
  return bounds.translate(hip.negate());
}

function torsoLocalPosition(model: SubjectModel, point: Vector3): Vector3 {
  const hip = model.bones.get('Hip');
  const chest = model.bones.get('Chest');
  if (!hip || !chest) throw new Error('Missing torso frame bones');
  const origin = hip.getWorldPosition(new Vector3());
  const inverseChestRotation = chest.getWorldQuaternion(new Quaternion()).invert();
  return point.clone().sub(origin).applyQuaternion(inverseChestRotation);
}

function kneeBendDeg(positions: JointPositions, side: 'L' | 'R'): number {
  const thigh = positions[`Thigh_${side}`];
  const knee = positions[`Knee_${side}`];
  const ankle = positions[`Ankle_${side}`];
  const angleDeg = thigh.clone().sub(knee).angleTo(ankle.clone().sub(knee)) * 180 / Math.PI;
  return Math.abs(180 - angleDeg);
}

function disposeFixture(fixture: FkFixture): void {
  fixture.model.meshes.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.skeleton.dispose();
  });
  fixture.materials.forEach((material) => material.dispose());
}

function isInsideTorso(model: SubjectModel, torso: Box3, wrist: Vector3): boolean {
  return torso.containsPoint(torsoLocalPosition(model, wrist));
}

function expectRelaxedArms(model: SubjectModel, torso: Box3, halfWidth: number, positions: JointPositions): void {
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1;
    const wrist = torsoLocalPosition(model, positions[`Wrist_${side}`]);
    const chest = torsoLocalPosition(model, positions.Chest);
    expect(wrist.y, `${side} wrist should hang below the hip`).toBeLessThan(torsoLocalPosition(model, positions.Hip).y);
    expect(sign * wrist.x, `${side} wrist should stay on its own side`).toBeGreaterThan(0);
    expect(Math.abs(wrist.x), `${side} wrist should stay close to the body`).toBeLessThan(0.25);
    expect(Math.abs(wrist.x), `${side} wrist should clear the torso side`).toBeGreaterThan(halfWidth);
    expect(wrist.z, `${side} wrist should be in front of the torso center`).toBeGreaterThan(chest.z - 0.03);
    expect(isInsideTorso(model, torso, positions[`Wrist_${side}`]), `${side} wrist should clear the torso`).toBe(false);
  }
}

describe('pose presets against the Nice Nature skeleton', () => {
  it.skipIf(!existsSync(testPath))('keeps every preset anatomically clear and mirrors its wrist geometry', () => {
    const fixture = createFixture();
    const { model } = fixture;
    const torso = restTorsoBounds(fixture);
    const halfWidth = Math.max(Math.abs(torso.min.x), Math.abs(torso.max.x));
    const restAnkles = readJoints(model);
    const measured = new Map<string, JointPositions>();

    expect(halfWidth).toBeGreaterThan(0.10);
    expect(halfWidth).toBeLessThan(0.18);
    for (const preset of POSE_PRESETS) {
      applyPreset(fixture, preset);
      const original = readJoints(model);
      measured.set(preset.name, original);
      for (const side of ['L', 'R'] as const) {
        const wristLocal = torsoLocalPosition(model, original[`Wrist_${side}`]);
        expect(isInsideTorso(model, torso, original[`Wrist_${side}`]), `${preset.name}: ${side} wrist ${wristLocal.toArray()} intersects torso`).toBe(false);
      }

      applyPreset(fixture, {
        bones: mirrorPoseOffsets(preset.bones),
        rootOffset: preset.rootOffset,
      });
      const mirrored = readJoints(model);
      for (const [side, opposite] of [['L', 'R'], ['R', 'L']] as const) {
        const expected = original[`Wrist_${opposite}`].clone();
        expected.x *= -1;
        expect(mirrored[`Wrist_${side}`].distanceTo(expected), `${preset.name}: mirrored ${side} wrist`).toBeLessThan(0.01);
      }
    }

    const relaxed = measured.get('Relaxed standing')!;
    applyPreset(fixture, POSE_PRESETS.find((preset) => preset.name === 'Relaxed standing')!);
    expectRelaxedArms(model, torso, halfWidth, relaxed);
    for (const side of ['L', 'R'] as const) {
      expect(relaxed[`Wrist_${side}`].y).toBeLessThan(relaxed.Hip.y);
      expect(Math.abs(relaxed[`Wrist_${side}`].x)).toBeLessThan(0.25);
    }

    const contrapposto = measured.get('Contrapposto')!;
    applyPreset(fixture, POSE_PRESETS.find((preset) => preset.name === 'Contrapposto')!);
    expectRelaxedArms(model, torso, halfWidth, contrapposto);
    expect(Math.abs(contrapposto.Thigh_L.y - contrapposto.Thigh_R.y)).toBeGreaterThan(0.005);
    expect(kneeBendDeg(contrapposto, 'R')).toBeLessThan(kneeBendDeg(contrapposto, 'L'));
    expect(Math.sign(contrapposto.Thigh_L.y - contrapposto.Thigh_R.y))
      .not.toBe(Math.sign(contrapposto.Arm_L.y - contrapposto.Arm_R.y));
    expect(Math.abs(contrapposto.Arm_L.y - contrapposto.Arm_R.y)).toBeGreaterThan(0.005);
    for (const side of ['L', 'R'] as const) {
      const ankle = contrapposto[`Ankle_${side}`];
      expect(ankle.y).toBeGreaterThanOrEqual(0);
      expect(Math.abs(ankle.y - restAnkles[`Ankle_${side}`].y)).toBeLessThanOrEqual(0.03);
    }

    const hips = measured.get('Hands on hips')!;
    applyPreset(fixture, POSE_PRESETS.find((preset) => preset.name === 'Hands on hips')!);
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      const wrist = torsoLocalPosition(model, hips[`Wrist_${side}`]);
      const elbow = torsoLocalPosition(model, hips[`Elbow_${side}`]);
      expect(sign * wrist.x).toBeGreaterThan(0);
      expect(Math.abs(Math.abs(wrist.x) - halfWidth)).toBeLessThan(0.10);
      expect(Math.abs(hips[`Wrist_${side}`].y - hips.Waist.y)).toBeLessThan(0.08);
      expect(Math.abs(elbow.x)).toBeGreaterThan(Math.abs(wrist.x) + 0.10);
      expect(hips[`Elbow_${side}`].y).toBeGreaterThanOrEqual(hips.Waist.y - 0.02);
      expect(wrist.z).toBeGreaterThan(torso.max.z);
    }

    const crossed = measured.get('Arms crossed')!;
    expect(crossed.Wrist_L.x).toBeLessThan(0);
    expect(crossed.Wrist_R.x).toBeGreaterThan(0);
    expect(crossed.Wrist_L.z).toBeGreaterThan(crossed.Chest.z + 0.05);
    expect(crossed.Wrist_R.z).toBeGreaterThan(crossed.Chest.z + 0.05);
    for (const side of ['L', 'R'] as const) {
      expect(Math.abs(crossed[`Wrist_${side}`].y - crossed[`Elbow_${side}`].y)).toBeLessThan(0.12);
      expect(crossed[`Elbow_${side}`].y).toBeGreaterThanOrEqual(crossed.Waist.y - 0.02);
      expect(crossed[`Elbow_${side}`].y).toBeLessThanOrEqual(crossed.Chest.y + 0.02);
    }
    expect(Math.abs(crossed.Wrist_L.y - crossed.Wrist_R.y)).toBeGreaterThan(0.03);
    const leftCrossing = crossingAtCenterX(crossed.Elbow_L, crossed.Wrist_L);
    const rightCrossing = crossingAtCenterX(crossed.Elbow_R, crossed.Wrist_R);
    expect(leftCrossing.distanceTo(rightCrossing)).toBeGreaterThan(0.02);

    const looking = measured.get('Looking over shoulder')!;
    applyPreset(fixture, POSE_PRESETS.find((preset) => preset.name === 'Looking over shoulder')!);
    const head = model.bones.get('Head')!;
    const hip = model.bones.get('Hip')!;
    const relativeHead = hip.getWorldQuaternion(new Quaternion()).invert()
      .multiply(head.getWorldQuaternion(new Quaternion())).normalize();
    const headForward = new Vector3(0, 0, 1).applyQuaternion(relativeHead);
    const headYawDeg = Math.atan2(headForward.x, headForward.z) * 180 / Math.PI;
    expect(headYawDeg).toBeGreaterThanOrEqual(50);
    expect(['Spine', 'Chest', 'Neck', 'Head'].every((name) =>
      (POSE_PRESETS.find((preset) => preset.name === 'Looking over shoulder')!.bones[name]?.[1] ?? 0) >= 8,
    )).toBe(true);
    for (const side of ['L', 'R'] as const) {
      expect(looking[`Wrist_${side}`].y).toBeLessThan(looking.Hip.y);
      expect(Math.abs(looking[`Wrist_${side}`].x)).toBeLessThan(0.25);
    }

    const chinPose = measured.get('Hand to chin')!;
    applyPreset(fixture, POSE_PRESETS.find((preset) => preset.name === 'Hand to chin')!);
    const headBone = model.bones.get('Head')!;
    const headForwardWorld = new Vector3(0, 0, 1).applyQuaternion(headBone.getWorldQuaternion(new Quaternion()));
    const chin = chinPose.Head.clone().addScaledVector(headForwardWorld, 0.06).add(new Vector3(0, -0.08, 0));
    expect(chin.y - chinPose.Wrist_L.y).toBeGreaterThan(0);
    expect(chin.y - chinPose.Wrist_L.y).toBeLessThan(0.10);
    expect(chinPose.Wrist_L.z).toBeGreaterThan(chin.z);
    expect(chinPose.Wrist_L.distanceTo(chin)).toBeLessThan(0.10);
    expect(chinPose.Elbow_L.y).toBeLessThan(chinPose.Wrist_L.y);
    expect(chinPose.Elbow_L.z).toBeGreaterThan(chinPose.Chest.z);
    expect(chinPose.Wrist_R.y).toBeLessThan(chinPose.Hip.y);
    expect(Math.abs(chinPose.Wrist_R.x)).toBeLessThan(0.25);

    disposeFixture(fixture);
  });

  it.skipIf(!existsSync(testPath))('verifies the crossed-arm hinge directions numerically', () => {
    const fixture = createFixture();
    applyPreset(fixture, {
      bones: {
        Arm_L: [-20, -90, -75], Elbow_L: [0, -110, 0],
        Arm_R: [-20, 90, 75], Elbow_R: [0, 110, 0],
      },
      rootOffset: [0, 0, 0],
    });
    const positions = readJoints(fixture.model);
    const leftUpperArm = positions.Elbow_L.clone().sub(positions.Arm_L);
    const leftForearm = positions.Wrist_L.clone().sub(positions.Elbow_L);
    const rightUpperArm = positions.Elbow_R.clone().sub(positions.Arm_R);
    const rightForearm = positions.Wrist_R.clone().sub(positions.Elbow_R);
    expect(leftUpperArm.y).toBeLessThan(-0.10);
    expect(leftUpperArm.z).toBeGreaterThan(0.05);
    expect(leftForearm.x).toBeLessThan(-0.15);
    expect(rightUpperArm.y).toBeLessThan(-0.10);
    expect(rightUpperArm.z).toBeGreaterThan(0.05);
    expect(rightForearm.x).toBeGreaterThan(0.15);
    expect(positions.Wrist_L.x).toBeLessThan(0);
    expect(positions.Wrist_R.x).toBeGreaterThan(0);
    expect(positions.Wrist_L.z).toBeGreaterThan(positions.Chest.z + 0.05);
    expect(positions.Wrist_R.z).toBeGreaterThan(positions.Chest.z + 0.05);
    disposeFixture(fixture);
  });
});

function crossingAtCenterX(start: Vector3, end: Vector3): Vector3 {
  const t = -start.x / (end.x - start.x);
  return start.clone().lerp(end, t);
}
