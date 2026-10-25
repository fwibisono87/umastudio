import { LinearSRGBColorSpace, PointLight, Vector3 } from 'three';
import type { Light, Object3D } from 'three';
import { PhysicalSpotLight, ShapedAreaLight } from 'three-gpu-pathtracer';
import { aimQuaternionForNegativeZ } from '../../scene/aim';
import { lightColor } from '../../scene/lightModel';
import type { CameraState, LightState } from '../../scene/types';
import { planEmitter } from './renderMath';

export interface RenderEmitter {
  light: Light;
  /** SpotLight direction is read from its target matrix by the path tracer. */
  target: Object3D | null;
}

/** Build one path-tracer light and its optional target for a document light. */
export function createRenderEmitter(state: LightState, camera: CameraState): RenderEmitter {
  const plan = planEmitter(state, camera);
  const rgb = lightColor(state.colorTempK, camera.whiteBalanceK);
  const target = new Vector3(...state.target);
  let light: Light;
  let targetObject: Object3D | null = null;

  if (plan.kind === 'area') {
    const area = new ShapedAreaLight(0xffffff, plan.intensity, plan.widthM, plan.heightM);
    area.isCircular = plan.shape === 'circle';
    light = area;
  } else if (plan.kind === 'spot') {
    const spot = new PhysicalSpotLight(0xffffff, plan.intensity, 0, plan.angleRad, 1, 2);
    spot.radius = plan.radiusM;
    targetObject = spot.target;
    targetObject.position.copy(target);
    const facePosition = new Vector3(...state.position);
    const awayFromTarget = facePosition.clone().sub(target).normalize();
    const samplePlaneOffset = plan.radiusM / Math.max(Math.tan(plan.angleRad), 1e-6);
    // PhysicalSpotLight samples a disk `radius / tan(angle)` in front of its virtual
    // cone origin. Move that origin back so the sampled face remains at the document's
    // emitter position and keeps the light model's source-to-subject distance.
    spot.position.copy(facePosition).addScaledVector(awayFromTarget, samplePlaneOffset);
    light = spot;
  } else {
    light = new PointLight(0xffffff, plan.intensity, 0, 2);
  }

  if (plan.kind !== 'spot') light.position.fromArray(state.position);
  light.color.setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
  if (plan.kind !== 'point') {
    light.quaternion.copy(renderEmitterQuaternion(state.position, state.target, state.rollDeg));
  }

  return { light, target: targetObject };
}

/** World orientation for a render light whose emitted direction is local -Z. */
export function renderEmitterQuaternion(position: LightState['position'], target: LightState['target'], rollDeg: number) {
  return aimQuaternionForNegativeZ(position, target, rollDeg);
}
