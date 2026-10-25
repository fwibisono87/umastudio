// Pure plan-view geometry for the shot map: mapping the world onto the diagram and the
// measurements the diagram and the settings table show. No DOM, so tests can run in node.
//
// Plan coordinates are metres with plan x = world x and plan y = world z, so +Z — where
// the camera usually stands — lands at the bottom of the page and the backdrop at the top.

import { getModifier } from '../../scene/modifiers';
import type { SceneDocument, Vec3 } from '../../scene/types';
import { RAD2DEG } from '../../scene/units';

export type PlanPoint = [number, number];

/** Axis-aligned bounding box in plan coordinates (plan y = world z), metres. */
export interface PlanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function toPlan(p: Vec3): PlanPoint {
  return [p[0], p[2]];
}

export function heightOf(p: Vec3): number {
  return p[1];
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function distance2(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Horizontal field of view of a lens, degrees: 2·atan(sensorWidth / (2·focal)). */
export function horizontalFovDeg(focalMm: number, sensorWidthMm: number): number {
  return 2 * Math.atan(sensorWidthMm / (2 * focalMm)) * RAD2DEG;
}

/**
 * Horizontal angle of `lightPos` seen from the subject, relative to the subject→camera
 * direction, in degrees. The sign follows the photographer: standing at the camera and
 * looking at the subject, negative is her left (camera-left) and positive her right
 * (camera-right), so the default key light at (1.5, 2, 1.5) with the camera on +Z reads
 * +45° / "camera-right". A light on the subject→camera axis reads 0.
 */
export function angleFromCameraAxisDeg(doc: SceneDocument, lightPos: Vec3): number {
  const [sx, , sz] = doc.subject.position;
  const [cx, , cz] = doc.camera.position;
  // Subject → camera in plan; the camera's right vector is this rotated a quarter turn
  // (right = forward × up with forward = camera → subject), so a light displaced toward
  // `right` reads positive.
  const alongX = cx - sx;
  const alongZ = cz - sz;
  const len = Math.hypot(alongX, alongZ);
  if (len < 1e-9) return 0;
  const rightX = alongZ;
  const rightZ = -alongX;
  const lx = lightPos[0] - sx;
  const lz = lightPos[2] - sz;
  return Math.atan2(lx * rightX + lz * rightZ, lx * alongX + lz * alongZ) * RAD2DEG;
}

/** Moves `p` `distanceM` metres away from `from` in plan, for label placement. */
export function away(from: PlanPoint, p: PlanPoint, distanceM: number): PlanPoint {
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [p[0], p[1] + distanceM];
  return [p[0] + (dx / len) * distanceM, p[1] + (dy / len) * distanceM];
}

/**
 * Bounding box of everything the diagram draws — subject, camera and its field-of-view
 * wedge, lights with their beams and label blocks, props, the backdrop sweep — padded by
 * 0.75 m. The subject and the camera are always inside.
 */
export function planBounds(doc: SceneDocument): PlanBounds {
  const subject = toPlan(doc.subject.position);
  const camera = toPlan(doc.camera.position);
  const points: PlanPoint[] = [subject, camera];

  // The camera wedge runs out to the target distance plus 1 m (see diagram.ts).
  const target = toPlan(doc.camera.target);
  const aimLen = distance2(camera, target);
  const far = aimLen + 1;
  if (aimLen > 1e-6) {
    points.push([camera[0] + ((target[0] - camera[0]) / aimLen) * far, camera[1] + ((target[1] - camera[1]) / aimLen) * far]);
  } else {
    points.push([camera[0], camera[1] + far]);
  }
  // The camera's settings label, offset away from the subject like the light labels.
  points.push(away(subject, camera, 1.4));

  for (const light of doc.lights) {
    const p = toPlan(light.position);
    points.push(p, toPlan(light.target));
    // Labels sit offset away from the subject and their text runs wider still.
    const reach = Math.max(getModifier(light.modifierId).widthM, 0.1) / 2 + 1.6;
    points.push(away(subject, p, reach));
  }

  for (const prop of doc.props) {
    const p = toPlan(prop.position);
    points.push(p, toPlan(prop.target), away(subject, p, 1.4));
  }

  // The backdrop sweep: 3.6 m wide, from z = -1.5 m back to the wall at z = -3 m
  // (buildSweepGeometry in src/core/studio.ts).
  points.push([-1.8, -3], [1.8, -3], [-1.8, -1.5], [1.8, -1.5]);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = 0.75;
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}
