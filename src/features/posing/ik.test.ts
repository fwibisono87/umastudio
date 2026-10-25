import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK } from './ik';
import { localQuaternionForWorldOrientation } from './poseMath';

describe('analytic two-bone IK', () => {
  it('reaches a target within segment reach', () => {
    const solved = solveTwoBoneIK([0, 0, 0], [1, 0, 0], [0.5, 0, 0], 0.6, 0.6, [0, 0, 1]);
    expect(solved.clamped).toBe(false);
    expect(solved.end[0]).toBeCloseTo(1, 6);
    expect(distance(solved.joint, [0, 0, 0])).toBeCloseTo(0.6, 6);
    expect(distance(solved.joint, solved.end)).toBeCloseTo(0.6, 6);
  });

  it('clamps unreachable targets to full extension', () => {
    const solved = solveTwoBoneIK([0, 0, 0], [4, 0, 0], [0.5, 0, 0], 0.6, 0.4, [0, 0, 1]);
    expect(solved.clamped).toBe(true);
    expect(solved.distance).toBeCloseTo(1, 6);
    expect(solved.end).toEqual([1, 0, 0]);
  });

  it('bends toward the pole direction', () => {
    const solved = solveTwoBoneIK([0, 0, 0], [1, 0, 0], [0.5, 0, 0], 0.7, 0.7, [0, 0, -1]);
    expect(solved.joint[2]).toBeLessThan(0);
    expect(solved.bendDirection[2]).toBeLessThan(0);
  });

  it('preserves the end bone world orientation when its parent rotates', () => {
    const parentWorld = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7);
    const desiredWorld = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.45);
    const childLocal = localQuaternionForWorldOrientation(parentWorld, desiredWorld);
    const after = parentWorld.clone().multiply(childLocal);
    expect(after.angleTo(desiredWorld)).toBeLessThan(1e-6);
  });
});

function distance(a: readonly number[], b: readonly number[]): number {
  return new Vector3(a[0], a[1], a[2]).distanceTo(new Vector3(b[0], b[1], b[2]));
}
