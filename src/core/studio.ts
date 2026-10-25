// The physical set: floor, a paper sweep behind the subject, room ambient, and the
// subject's anchor (with a stand-in mannequin until a model is loaded).

import {
  AmbientLight,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from 'three';
import type { Picking, SubjectModel, SubjectRuntime } from './context';
import type { SceneStore } from './store';
import { cameraExposureScale } from '../scene/photometry';
import type { SceneDocument } from '../scene/types';
import { DEG2RAD } from '../scene/units';

/** 18% grey, linear: the mannequin is a walking grey card. */
const GREY_CARD = 0.18;

export function createSubjectRuntime(store: SceneStore, scene: Scene, picking: Picking): SubjectRuntime {
  buildSet(store, scene);

  const anchor = new Group();
  anchor.name = 'subject-anchor';
  scene.add(anchor);
  picking.register(anchor, { kind: 'subject' });

  const mannequin = buildMannequin();
  anchor.add(mannequin);

  const syncAnchor = (doc: SceneDocument) => {
    anchor.position.fromArray(doc.subject.position);
    anchor.rotation.set(0, doc.subject.yawDeg * DEG2RAD, 0);
  };
  syncAnchor(store.doc);
  store.subscribe(syncAnchor);

  let model: SubjectModel | null = null;
  const listeners = new Set<(m: SubjectModel | null) => void>();

  return {
    anchor,
    get model() {
      return model;
    },
    setModel(next) {
      if (model && model.root !== next?.root) anchor.remove(model.root);
      model = next;
      if (model && model.root.parent !== anchor) anchor.add(model.root);
      mannequin.visible = model === null;
      listeners.forEach((l) => l(model));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function buildSet(store: SceneStore, scene: Scene): void {
  const floorMaterial = new MeshStandardMaterial({ roughness: 0.85 });
  const floor = new Mesh(new PlaneGeometry(30, 30), floorMaterial);
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const paperMaterial = new MeshStandardMaterial({ roughness: 0.95 });
  const paper = new Mesh(buildSweepGeometry(), paperMaterial);
  paper.name = 'backdrop';
  paper.receiveShadow = true;
  scene.add(paper);

  const ambient = new AmbientLight(0xffffff, 0);
  ambient.name = 'room-ambient';
  scene.add(ambient);

  const sync = (doc: SceneDocument) => {
    const r = doc.environment.floorReflectance;
    floorMaterial.color.setRGB(r, r, r, LinearSRGBColorSpace);
    paperMaterial.color = new Color(doc.environment.backdropColor);
    // AmbientLight intensity is irradiance in lux: a surface receives ambientLux from it.
    ambient.intensity = doc.environment.ambientLux * cameraExposureScale(doc.camera);
  };
  sync(store.doc);
  store.subscribe(sync);
}

/**
 * A seamless paper sweep: 3.6 m wide (a standard 3.55 m roll), starting on the floor
 * 1.5 m behind the subject, curving up with a 0.8 m radius cove into a 3.5 m wall at
 * z = -3.
 */
function buildSweepGeometry(): BufferGeometry {
  const width = 3.6;
  const wallZ = -3;
  const radius = 0.8;
  const floorStartZ = -1.5;
  const top = 3.5;

  // Profile in (z, y), front to back then up.
  const profile: [number, number][] = [[floorStartZ, 0.002]];
  const coveStartZ = wallZ + radius;
  profile.push([coveStartZ, 0.002]);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    profile.push([coveStartZ - Math.sin(a) * radius, radius - Math.cos(a) * radius + 0.002]);
  }
  profile.push([wallZ, top]);

  const positions: number[] = [];
  const indices: number[] = [];
  for (const [z, y] of profile) {
    positions.push(-width / 2, y, z, width / 2, y, z);
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A ~1.55 m grey stand-in, facing +Z (the nose cone shows which way). */
function buildMannequin(): Group {
  const material = new MeshStandardMaterial({ roughness: 0.9 });
  material.color.setRGB(GREY_CARD, GREY_CARD, GREY_CARD, LinearSRGBColorSpace);
  const part = (geometry: BufferGeometry, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const group = new Group();
  group.name = 'mannequin';
  group.add(
    part(new CapsuleGeometry(0.07, 0.68, 4, 12), -0.1, 0.41, 0),
    part(new CapsuleGeometry(0.07, 0.68, 4, 12), 0.1, 0.41, 0),
    part(new CapsuleGeometry(0.16, 0.38, 6, 16), 0, 1.04, 0),
    part(new CapsuleGeometry(0.045, 0.5, 4, 10), -0.24, 1.0, 0),
    part(new CapsuleGeometry(0.045, 0.5, 4, 10), 0.24, 1.0, 0),
    part(new SphereGeometry(0.11, 24, 16), 0, 1.42, 0),
  );
  const nose = part(new ConeGeometry(0.025, 0.06, 12), 0, 1.42, 0.12);
  nose.rotation.x = Math.PI / 2;
  group.add(nose);
  return group;
}
