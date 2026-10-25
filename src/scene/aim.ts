// Shared orientation convention for every object stored as an Aimed value.
// The object's local +Z points from position to target and local +Y follows world up.
// Positive roll is a right-handed rotation about +Z: viewed from behind while looking
// along the aim, the object's top turns clockwise. Camera roll uses the same convention
// even though a three.js camera looks along local -Z.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3 } from './types';

type Point3 = Vector3 | Vec3;

const LOCAL_FORWARD = new Vector3(0, 0, 1);
const LOCAL_UP = new Vector3(0, 1, 0);
const WORLD_UP = new Vector3(0, 1, 0);
// World up cannot define a frame when aiming almost vertically. World +Z gives a
// deterministic reference on both sides of the pole instead of allowing lookAt to flip.
const VERTICAL_UP = new Vector3(0, 0, 1);
const NEGATIVE_Z_CONVERSION = new Quaternion().setFromAxisAngle(LOCAL_UP, Math.PI);
const ROLL_AXIS = new Vector3(0, 0, 1);

/** Orientation for an object whose local +Z faces `target` from `position`. */
export function aimQuaternion(position: Point3, target: Point3, rollDeg: number, out = new Quaternion()): Quaternion {
  const direction = readPoint(target, new Vector3()).sub(readPoint(position, new Vector3()));
  if (direction.lengthSq() < 1e-24) direction.copy(LOCAL_FORWARD);
  direction.normalize();

  const referenceUp = Math.abs(direction.dot(WORLD_UP)) > 0.9999 ? VERTICAL_UP : WORLD_UP;
  const right = new Vector3().crossVectors(referenceUp, direction).normalize();
  const up = new Vector3().crossVectors(direction, right).normalize();
  out.setFromRotationMatrix(new Matrix4().makeBasis(right, up, direction));
  if (rollDeg !== 0) {
    out.multiply(new Quaternion().setFromAxisAngle(ROLL_AXIS, (rollDeg * Math.PI) / 180));
  }
  return out;
}

/** Same aim frame for cameras and three.js lights, whose forward axis is local -Z. */
export function aimQuaternionForNegativeZ(
  position: Point3,
  target: Point3,
  rollDeg: number,
  out = new Quaternion(),
): Quaternion {
  aimQuaternion(position, target, rollDeg, out);
  return out.multiply(NEGATIVE_Z_CONVERSION);
}

/** Recover the target at `distanceM` and roll from a +Z-forward orientation. */
export function aimFromQuaternion(position: Point3, quaternion: Quaternion, distanceM: number): { target: Vec3; rollDeg: number } {
  const origin = readPoint(position, new Vector3());
  const forward = LOCAL_FORWARD.clone().applyQuaternion(quaternion).normalize();
  const target = origin.addScaledVector(forward, distanceM);
  const base = aimQuaternion(position, target, 0);
  const twist = base.invert().multiply(quaternion.clone().normalize()).normalize();
  const angle = 2 * Math.atan2(twist.z, twist.w);
  return { target: target.toArray(), rollDeg: wrapDegrees((angle * 180) / Math.PI) };
}

function readPoint(point: Point3, out: Vector3): Vector3 {
  if (point instanceof Vector3) return out.copy(point);
  return out.fromArray(point);
}

function wrapDegrees(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}
