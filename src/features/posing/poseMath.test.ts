import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../scene/types';
import {
  copyPoseSide,
  mirrorPoseOffsets,
  offsetToQuaternion,
  oppositeSideBoneName,
  quaternionToOffset,
  reflectOffsetAcrossYZ,
} from './poseMath';

describe('pose rotation conversion', () => {
  it('round-trips Euler XYZ offsets relative to any rest quaternion within 1e-6 degrees', () => {
    const rest = new Quaternion().setFromEuler(new Euler(0.27, -0.43, 0.16, 'XYZ'));
    const offset: Vec3 = [32.5, -71.25, 118.75];
    const recovered = quaternionToOffset(rest, offsetToQuaternion(rest, offset));
    recovered.forEach((value, axis) => expect(value).toBeCloseTo(offset[axis]!, 6));
  });

  it('maps a raised left arm to a raised right arm and mirrors twice exactly', () => {
    const original = { Arm_L: [0, 0, 90] as Vec3, Elbow_L: [8, 12, 24] as Vec3, Head: [2, 3, 4] as Vec3 };
    const mirrored = mirrorPoseOffsets(original);
    expect(mirrored.Arm_R).toEqual([0, 0, -90]);
    const leftRaised = new Vector3(1, 0, 0).applyQuaternion(offsetToQuaternion(new Quaternion(), original.Arm_L));
    const rightRaised = new Vector3(-1, 0, 0).applyQuaternion(offsetToQuaternion(new Quaternion(), mirrored.Arm_R!));
    expect(leftRaised.y).toBeCloseTo(1, 6);
    expect(rightRaised.y).toBeCloseTo(1, 6);
    expect(mirrorPoseOffsets(mirrored)).toEqual(original);
  });

  it('copies a source side with reflected local axes and resets an absent source bone', () => {
    const copied = copyPoseSide({ Arm_L: [10, 20, 30], Elbow_R: [9, 8, 7] }, 'L', ['Arm_L', 'Arm_R', 'Elbow_L', 'Elbow_R']);
    expect(copied.Arm_R).toEqual([10, -20, -30]);
    expect(copied.Elbow_R).toBeUndefined();
    expect(oppositeSideBoneName('Sp_Hi_Acc1_BL_00')).toBe('Sp_Hi_Acc1_BR_00');
    expect(reflectOffsetAcrossYZ([1, 2, 3])).toEqual([1, -2, -3]);
  });
});
