import { Vector3 } from 'three';

export type Point3 = readonly [number, number, number];

export interface TwoBoneSolution {
  /** Desired middle-joint position after respecting the supplied pole direction. */
  joint: [number, number, number];
  /** Reachable endpoint. Unreachable targets are clamped to full extension. */
  end: [number, number, number];
  distance: number;
  maxReach: number;
  minReach: number;
  clamped: boolean;
  bendDirection: [number, number, number];
}

/**
 * Analytic two-segment IK. `poleDirection` points from the root toward the desired
 * elbow/knee side of the bend plane. The current joint gives the fallback bend plane.
 */
export function solveTwoBoneIK(
  rootPoint: Point3,
  targetPoint: Point3,
  currentJointPoint: Point3,
  firstLength: number,
  secondLength: number,
  poleDirection: Point3,
): TwoBoneSolution {
  const root = vector(rootPoint);
  const target = vector(targetPoint);
  const currentJoint = vector(currentJointPoint);
  const l1 = Math.max(0, Number.isFinite(firstLength) ? firstLength : 0);
  const l2 = Math.max(0, Number.isFinite(secondLength) ? secondLength : 0);
  const maxReach = l1 + l2;
  const minReach = Math.abs(l1 - l2);

  if (maxReach < 1e-9) {
    const pole = vector(poleDirection);
    if (pole.lengthSq() < 1e-12) pole.set(0, 0, 1);
    pole.normalize();
    return { joint: tuple(root), end: tuple(root), distance: 0, maxReach, minReach, clamped: true, bendDirection: tuple(pole) };
  }

  const targetDelta = target.clone().sub(root);
  const requestedDistance = targetDelta.length();
  const direction = requestedDistance > 1e-9
    ? targetDelta.multiplyScalar(1 / requestedDistance)
    : vector(currentJointPoint).sub(root).normalize().setLength(1);
  if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);

  // Keep a small numerical margin from the folded singularity, but allow exact full extension.
  const epsilon = Math.min(1e-7, maxReach * 1e-7);
  const safeMin = Math.min(minReach + epsilon, maxReach);
  const reachableDistance = Math.max(safeMin, Math.min(maxReach, requestedDistance));
  const clamped = Math.abs(reachableDistance - requestedDistance) > 1e-7;
  const end = root.clone().addScaledVector(direction, reachableDistance);

  let bend = vector(poleDirection).addScaledVector(direction, -vector(poleDirection).dot(direction));
  if (bend.lengthSq() < 1e-10) {
    const current = currentJoint.clone().sub(root);
    bend = current.addScaledVector(direction, -current.dot(direction));
  }
  if (bend.lengthSq() < 1e-10) {
    const fallback = Math.abs(direction.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    bend = fallback.addScaledVector(direction, -fallback.dot(direction));
  }
  bend.normalize();

  const along = l1 === 0 ? 0 : (l1 * l1 + reachableDistance * reachableDistance - l2 * l2) / (2 * reachableDistance);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const joint = root.clone().addScaledVector(direction, along).addScaledVector(bend, height);

  return {
    joint: tuple(joint),
    end: tuple(end),
    distance: reachableDistance,
    maxReach,
    minReach,
    clamped,
    bendDirection: tuple(bend),
  };
}

function vector(point: Point3): Vector3 {
  return new Vector3(point[0], point[1], point[2]);
}

function tuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}
