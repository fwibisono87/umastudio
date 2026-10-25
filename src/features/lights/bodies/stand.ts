import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { addRod, addVerticalCylinder, prepareHelper } from './common';

const BOOM_REACH_M = 1.05;

export type StandVariant = 'stand' | 'boom' | 'floor';

export interface LightStandPlan {
  variant: StandVariant;
  basePosition: Vector3;
  yawRadians: number;
  heightM: number;
  reachM: number;
}

/** Chooses a floor stand, regular stand, or counterweighted boom from the live aim. */
export function planLightStand(mountPoint: Vector3, aimDirection: Vector3, lightHeightM: number): LightStandPlan {
  const direction = aimDirection.clone().setY(0);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
  else direction.normalize();

  const variant: StandVariant = lightHeightM < 0.4
    ? 'floor'
    : mountPoint.y > 2.4 || aimDirection.y < -Math.sin((55 * Math.PI) / 180)
      ? 'boom'
      : 'stand';
  const reachM = variant === 'boom' ? BOOM_REACH_M : 0;
  const basePosition = mountPoint.clone();
  basePosition.y = 0;
  if (variant === 'boom') basePosition.addScaledVector(direction, -reachM);
  return {
    variant,
    basePosition,
    yawRadians: Math.atan2(direction.x, direction.z),
    heightM: Math.max(0.08, mountPoint.y),
    reachM,
  };
}

/** Builds a floor-anchored stand in local +Z; runtime aims its boom at the yoke. */
export function buildLightStand(variant: StandVariant): Group {
  const stand = new Group();
  stand.name = variant === 'boom' ? 'Light stand with boom' : variant === 'floor' ? 'Low floor stand' : 'Light stand';
  stand.userData.standVariant = variant;
  stand.userData.baseHeightM = variant === 'floor' ? 0.25 : 1;
  prepareHelper(stand);

  const steel = new MeshStandardMaterial({ color: 0x737b84, roughness: 0.42, metalness: 0.76 });
  const darkSteel = new MeshStandardMaterial({ color: 0x292e35, roughness: 0.52, metalness: 0.58 });
  const rubber = new MeshStandardMaterial({ color: 0x16191d, roughness: 0.82, metalness: 0.02 });

  if (variant === 'floor') {
    addLegs(stand, 0.29, 0.11, steel, darkSteel, rubber);
    addVerticalCylinder(stand, 0.021, 0.026, 0.19, 0.13, steel);
    addVerticalCylinder(stand, 0.018, 0.018, 0.06, 0.22, darkSteel);
    addVerticalCylinder(stand, 0.012, 0.012, 0.06, 0.25, steel);
    return stand;
  }

  addLegs(stand, 0.45, 0.15, steel, darkSteel, rubber);
  addVerticalCylinder(stand, 0.023, 0.029, 0.40, 0.24, steel);
  addVerticalCylinder(stand, 0.018, 0.022, 0.34, 0.58, steel);
  addVerticalCylinder(stand, 0.014, 0.017, 0.28, 0.85, steel);
  addLockingCollar(stand, 0.43, darkSteel);
  addLockingCollar(stand, 0.73, darkSteel);
  addLockingCollar(stand, 0.93, darkSteel);

  if (variant === 'boom') {
    addVerticalCylinder(stand, 0.029, 0.029, 0.07, 0.91, darkSteel);
    addRod(stand, new Vector3(0, 0.94, -0.29), new Vector3(0, 0.94, 1.01), 0.012, steel, 8);
    addCounterweight(stand, -0.23, darkSteel);
    addRod(stand, new Vector3(0, 0.94, 1.01), new Vector3(0, 1, 1.01), 0.011, darkSteel, 8);
    addVerticalCylinder(stand, 0.014, 0.014, 0.06, 0.97, steel).position.z = 1.01;
  } else {
    addVerticalCylinder(stand, 0.023, 0.023, 0.06, 0.94, darkSteel);
    addVerticalCylinder(stand, 0.012, 0.012, 0.06, 0.97, steel);
  }
  return stand;
}

function addLegs(
  parent: Group,
  footprintRadius: number,
  centerHeight: number,
  steel: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  rubber: MeshStandardMaterial,
): void {
  const ends = [
    new Vector3(footprintRadius, 0.03, 0),
    new Vector3(-footprintRadius / 2, 0.03, footprintRadius * 0.866),
    new Vector3(-footprintRadius / 2, 0.03, -footprintRadius * 0.866),
  ];
  for (const end of ends) {
    addRod(parent, new Vector3(0, centerHeight, 0), end, 0.014, steel, 7);
    const foot = new Mesh(new CylinderGeometry(0.028, 0.028, 0.03, 8), rubber);
    foot.name = 'Stand rubber foot';
    foot.position.set(end.x, 0.015, end.z);
    prepareHelper(foot);
    parent.add(foot);
  }
  addVerticalCylinder(parent, 0.034, 0.04, 0.06, centerHeight * 0.52, dark);
}

function addLockingCollar(parent: Group, y: number, material: MeshStandardMaterial): void {
  addVerticalCylinder(parent, 0.025, 0.025, 0.035, y, material);
  const knob = new Mesh(new CylinderGeometry(0.009, 0.009, 0.035, 8), material);
  knob.name = 'Stand section lock';
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.03, y, 0);
  prepareHelper(knob);
  parent.add(knob);
}

function addCounterweight(parent: Group, z: number, material: MeshStandardMaterial): void {
  const weight = new Mesh(new CylinderGeometry(0.052, 0.052, 0.19, 12), material);
  weight.name = 'Boom counterweight';
  weight.rotation.x = Math.PI / 2;
  weight.position.set(0, 0.94, z);
  prepareHelper(weight);
  parent.add(weight);
}
