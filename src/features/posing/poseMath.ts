import { Euler, Quaternion } from 'three';
import type { Vec3 } from '../../scene/types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Document Euler XYZ offsets are post-multiplied onto the model's rest rotation. */
export function offsetToQuaternion(rest: Quaternion, offsetDeg: Vec3): Quaternion {
  const offset = new Quaternion().setFromEuler(new Euler(
    finite(offsetDeg[0]) * DEG2RAD,
    finite(offsetDeg[1]) * DEG2RAD,
    finite(offsetDeg[2]) * DEG2RAD,
    'XYZ',
  ));
  return rest.clone().multiply(offset).normalize();
}

/** Recover the document-space offset from a posed local bone quaternion. */
export function quaternionToOffset(rest: Quaternion, current: Quaternion): Vec3 {
  const relative = rest.clone().invert().multiply(current).normalize();
  const euler = new Euler().setFromQuaternion(relative, 'XYZ');
  return [euler.x * RAD2DEG, euler.y * RAD2DEG, euler.z * RAD2DEG];
}

/**
 * The loader leaves PMX bone frames unrotated: local X follows each limb segment.
 * Reflecting a rotation matrix across the body's YZ plane keeps X rotation and negates
 * Y/Z Euler angles in that shared local frame.
 */
export function reflectOffsetAcrossYZ(offset: Vec3): Vec3 {
  return [cleanZero(offset[0]), cleanZero(-offset[1]), cleanZero(-offset[2])];
}

/** Swap side tokens without changing words such as "Spine" or "Shoulder". */
export function oppositeSideBoneName(name: string): string {
  const swaps: Record<string, string> = {
    L: 'R', R: 'L', BL: 'BR', BR: 'BL', FL: 'FR', FR: 'FL',
    FLL: 'FRR', FRR: 'FLL', BLL: 'BRR', BRR: 'BLL',
  };
  return name.replace(/(^|_)(FLL|FRR|BLL|BRR|BL|BR|FL|FR|L|R)(?=_|$)/g, (_token, prefix: string, side: string) =>
    `${prefix}${swaps[side] ?? side}`,
  );
}

/** Mirror sparse pose data; a missing side remains the document's implicit rest pose. */
export function mirrorPoseOffsets(bones: Record<string, Vec3>): Record<string, Vec3> {
  const mirrored: Record<string, Vec3> = {};
  for (const [name, offset] of Object.entries(bones)) {
    mirrored[oppositeSideBoneName(name)] = reflectOffsetAcrossYZ(offset);
  }
  return mirrored;
}

/** Copy one side onto the other, resetting target-side bones whose source is at rest. */
export function copyPoseSide(
  bones: Record<string, Vec3>,
  sourceSide: 'L' | 'R',
  knownBoneNames: Iterable<string>,
): Record<string, Vec3> {
  const targetSide = sourceSide === 'L' ? 'R' : 'L';
  const out = { ...bones };
  for (const targetName of knownBoneNames) {
    if (!hasSideToken(targetName, targetSide)) continue;
    const sourceName = oppositeSideBoneName(targetName);
    const source = bones[sourceName];
    if (source) out[targetName] = reflectOffsetAcrossYZ(source);
    else delete out[targetName];
  }
  return out;
}

/** Compensate a child bone after its parent has moved, keeping its world orientation. */
export function localQuaternionForWorldOrientation(parentWorld: Quaternion, desiredWorld: Quaternion): Quaternion {
  return parentWorld.clone().invert().multiply(desiredWorld).normalize();
}

function hasSideToken(name: string, side: 'L' | 'R'): boolean {
  return new RegExp(`(^|_)${side}(?=_|$)`).test(name);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
