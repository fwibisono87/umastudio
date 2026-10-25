import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { addRod, addVerticalCylinder, prepareHelper } from './common';

/** Builds the editor frame around a panel without changing its light-interaction surface. */
export function buildPropFrame(width: number, height: number, kind: 'bounce' | 'flag' | 'diffusion'): Group {
  const frame = new Group();
  frame.name = 'Prop panel frame';
  prepareHelper(frame);
  const flag = kind === 'flag';
  const material = new MeshStandardMaterial({
    color: flag ? 0x171a1e : 0x777f87,
    roughness: flag ? 0.7 : 0.42,
    metalness: flag ? 0.08 : 0.68,
  });
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  for (const x of [-halfWidth, halfWidth]) {
    addRod(frame, new Vector3(x, -halfHeight, 0.006), new Vector3(x, halfHeight, 0.006), 0.008, material, 7);
  }
  for (const y of [-halfHeight, halfHeight]) {
    addRod(frame, new Vector3(-halfWidth, y, 0.006), new Vector3(halfWidth, y, 0.006), 0.008, material, 7);
  }
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      const clamp = new Mesh(new SphereGeometry(0.013, 8, 6), material.clone());
      clamp.name = 'Prop frame corner clamp';
      clamp.position.set(x, y, 0.006);
      prepareHelper(clamp);
      frame.add(clamp);
    }
  }
  return frame;
}

/** Unit-height C-stand; runtime scales the riser to the panel centre and aims the arm. */
export function buildPropStand(): Group {
  const stand = new Group();
  stand.name = 'Prop C-stand';
  prepareHelper(stand);
  const metal = new MeshStandardMaterial({ color: 0x777f87, roughness: 0.42, metalness: 0.72 });
  const dark = new MeshStandardMaterial({ color: 0x292e34, roughness: 0.55, metalness: 0.45 });
  const feet = [
    new Vector3(0.38, 0.015, 0),
    new Vector3(-0.19, 0.015, 0.33),
    new Vector3(-0.19, 0.015, -0.33),
  ];
  for (const foot of feet) {
    const start = new Vector3(0, 0.11, 0);
    addRod(stand, start, new Vector3(foot.x, 0.028, foot.z), 0.014, metal, 7);
    const pad = new Mesh(new CylinderGeometry(0.022, 0.022, 0.018, 8), dark);
    pad.name = 'C-stand foot';
    pad.position.set(foot.x, 0.009, foot.z);
    prepareHelper(pad);
    stand.add(pad);
  }
  addVerticalCylinder(stand, 0.022, 0.027, 0.42, 0.23, metal);
  addVerticalCylinder(stand, 0.017, 0.02, 0.31, 0.595, metal);
  addVerticalCylinder(stand, 0.013, 0.016, 0.27, 0.87, metal);
  for (const y of [0.42, 0.72, 0.94]) addStandKnob(stand, y, dark);
  addVerticalCylinder(stand, 0.023, 0.023, 0.045, 0.98, dark);
  addRod(stand, new Vector3(0, 0.98, 0), new Vector3(0, 0.98, 0.42), 0.009, metal, 7);
  addRod(stand, new Vector3(0, 0.98, 0.42), new Vector3(0, 1, 0.42), 0.009, metal, 7);
  const grip = new Mesh(new SphereGeometry(0.035, 10, 8), dark);
  grip.name = 'C-stand grip head';
  grip.position.set(0, 0.98, 0.12);
  prepareHelper(grip);
  stand.add(grip);
  return stand;
}

function addStandKnob(parent: Group, y: number, material: MeshStandardMaterial): void {
  const knob = new Mesh(new CylinderGeometry(0.012, 0.012, 0.04, 8), material);
  knob.name = 'Stand locking knob';
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.026, y, 0);
  prepareHelper(knob);
  parent.add(knob);
}
