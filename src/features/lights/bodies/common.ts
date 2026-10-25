import {
  CylinderGeometry,
  Group,
  Line,
  Mesh,
  Object3D,
  Vector3,
} from 'three';
import { LAYER_HELPERS } from '../../../core/context';

const UP = new Vector3(0, 1, 0);

/** Marks visible equipment as editor-only while leaving it raycastable in the set view. */
export function prepareHelper(object: Object3D): void {
  object.layers.set(LAYER_HELPERS);
  object.userData.editorOnly = true;
  if (object instanceof Mesh) {
    object.castShadow = false;
    object.receiveShadow = false;
  }
}

export function addRod(
  parent: Group,
  start: Vector3,
  end: Vector3,
  radius: number,
  material: Mesh['material'],
  radialSegments = 7,
): Mesh {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rod = new Mesh(new CylinderGeometry(radius, radius, length, radialSegments), material);
  rod.position.copy(start).add(end).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(UP, direction.normalize());
  prepareHelper(rod);
  parent.add(rod);
  return rod;
}

export function addVerticalCylinder(
  parent: Group,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  y: number,
  material: Mesh['material'],
  radialSegments = 10,
): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments), material);
  mesh.position.y = y;
  prepareHelper(mesh);
  parent.add(mesh);
  return mesh;
}

/** Disposes nested line and mesh resources when a helper is rebuilt or deleted. */
export function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh) && !(child instanceof Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

export function clearGroup(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}
