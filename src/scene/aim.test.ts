import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { aimFromQuaternion, aimQuaternion, aimQuaternionForNegativeZ } from './aim';
import type { Vec3 } from './types';

function angleDifference(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

function closeVector(actual: readonly number[], expected: readonly number[], precision = 8): void {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, precision));
}

describe('shared aim orientation', () => {
  it('round-trips varied targets and rolls, including near-vertical aims', () => {
    let seed = 0x4a1d;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const cases: { position: Vec3; target: Vec3; rollDeg: number }[] = [];
    for (let i = 0; i < 180; i++) {
      const position: Vec3 = [random() * 12 - 6, random() * 8 - 4, random() * 12 - 6];
      const target: Vec3 = [random() * 8 - 4, random() * 6 - 3, random() * 8 - 4];
      cases.push({ position, target, rollDeg: random() * 720 - 360 });
    }
    for (const verticalSign of [-1, 1]) {
      for (const tilt of [0, 1e-5, 0.002]) {
        cases.push({
          position: [1.2, -0.4, 2.8],
          target: [1.2 + tilt, -0.4 + verticalSign * 3, 2.8 - tilt / 2],
          rollDeg: verticalSign * 127.5,
        });
      }
    }

    for (const { position, target, rollDeg } of cases) {
      const distance = new Vector3(...position).distanceTo(new Vector3(...target));
      const recovered = aimFromQuaternion(position, aimQuaternion(position, target, rollDeg), distance);
      closeVector(recovered.target, target);
      expect(Math.abs(angleDifference(recovered.rollDeg, rollDeg))).toBeLessThan(1e-7);
    }
  });

  it('defines positive roll as clockwise around the aim when seen from behind', () => {
    const q = aimQuaternion([0, 0, 0], [0, 0, 1], 90);
    const top = new Vector3(0, 1, 0).applyQuaternion(q);
    // Looking along +Z, screen-right is -X, so top rotating toward -X is clockwise.
    expect(top.x).toBeCloseTo(-1, 8);
    expect(top.y).toBeCloseTo(0, 8);
  });

  it('converts +Z aim frames to -Z forward without changing their up direction', () => {
    const position: Vec3 = [2, 1, 3];
    const target: Vec3 = [-1, 4, -2];
    const body = aimQuaternion(position, target, 38);
    const light = aimQuaternionForNegativeZ(position, target, 38);
    const expected = new Vector3(...target).sub(new Vector3(...position)).normalize();
    const actualForward = new Vector3(0, 0, -1).applyQuaternion(light);
    const bodyUp = new Vector3(0, 1, 0).applyQuaternion(body);
    const lightUp = new Vector3(0, 1, 0).applyQuaternion(light);
    expect(actualForward.distanceTo(expected)).toBeLessThan(1e-8);
    expect(lightUp.distanceTo(bodyUp)).toBeLessThan(1e-8);
  });

  it('matches Object3D.lookAt for ordinary +Z-forward aims at zero roll', () => {
    const poses: { position: Vec3; target: Vec3 }[] = [
      { position: [1.5, 2, 1.5], target: [0, 1.4, 0] },
      { position: [-2, 0.8, 4], target: [1, 2.1, -1] },
      { position: [3, 5, -2], target: [-1, -2, 6] },
    ];
    for (const { position, target } of poses) {
      const object = new Object3D();
      object.position.fromArray(position);
      object.lookAt(new Vector3(...target));
      expect(Math.abs(object.quaternion.dot(aimQuaternion(position, target, 0)))).toBeCloseTo(1, 8);
    }
  });

  it('matches the existing shot-camera lookAt and rotateZ(-roll) orientation', () => {
    const poses: { position: Vec3; target: Vec3; rollDeg: number }[] = [
      { position: [0, 1.45, 3.5], target: [0, 1.3, 0], rollDeg: 0 },
      { position: [-2.7, 3.1, 1.2], target: [0.4, 1.4, -0.3], rollDeg: 67 },
      { position: [1, 2, -3], target: [1.2, 2.1, 4], rollDeg: -112 },
    ];
    for (const { position, target, rollDeg } of poses) {
      const camera = new PerspectiveCamera();
      camera.position.fromArray(position);
      camera.up.set(0, 1, 0);
      camera.lookAt(new Vector3(...target));
      camera.rotateZ((-rollDeg * Math.PI) / 180);
      const expected = camera.quaternion.clone().normalize();
      const actual = aimQuaternionForNegativeZ(position, target, rollDeg);
      expect(Math.abs(expected.dot(actual))).toBeCloseTo(1, 8);
    }
  });

  it('supports a caller-provided output quaternion', () => {
    const out = new Quaternion();
    expect(aimQuaternion([0, 0, 0], [0, 1, 0], 25, out)).toBe(out);
    expect(out.length()).toBeCloseTo(1, 10);
  });
});
