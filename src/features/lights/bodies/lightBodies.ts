import {
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { getModifier, type ModifierPreset } from '../../../scene/modifiers';
import { kelvinToRgb } from '../../../scene/lightModel';
import type { LightState } from '../../../scene/types';
import { addRod, clearGroup, prepareHelper } from './common';

const HEAD_LENGTH = 0.24;
const HEAD_RADIUS = 0.055;
const DIFFUSER_LIP_Z = 0.025;

export interface LightBodyBuild {
  group: Group;
  /** Local point at the tilt yoke pivot, where the stand spigot meets the head. */
  mountPoint: Vector3;
}

const fabricMaterial = () => new MeshStandardMaterial({ color: 0x25282d, roughness: 0.88, metalness: 0.02, side: DoubleSide });
const seamMaterial = () => new MeshStandardMaterial({ color: 0x59616b, roughness: 0.48, metalness: 0.62 });
const blackMetalMaterial = () => new MeshStandardMaterial({ color: 0x252930, roughness: 0.52, metalness: 0.55, side: DoubleSide });
const silverMaterial = () => new MeshStandardMaterial({ color: 0xb9c1c8, roughness: 0.3, metalness: 0.86, side: DoubleSide });

/** Builds the visible modifier, monolight head, and the single photometric face. */
export function buildLightBody(root: Group, state: LightState): LightBodyBuild {
  const modifier = getModifier(state.modifierId);
  root.userData.lightSelected = false;
  const category = buildCategoryBody(state, modifier);
  root.add(category.group);
  addLightFace(root, state, modifier);
  if (state.accessories.gridDeg !== null && modifier.acceptsGrid) addGrid(root, modifier, state.accessories.gridDeg);
  if (state.accessories.barnDoors && modifier.acceptsBarnDoors) addBarnDoors(root, modifier, state.accessories.barnDoors);
  return category;
}

/** Adds or removes the selection ring and beam without rebuilding the equipment. */
export function setLightBodySelected(root: Group, state: LightState, selected: boolean): void {
  if (root.userData.lightSelected === selected) return;
  const previous = root.getObjectByName('Light selection overlay');
  if (previous) {
    root.remove(previous);
    clearGroup(previous as Group);
  }
  root.userData.lightSelected = selected;
  if (!selected) return;

  const modifier = getModifier(state.modifierId);
  const overlay = new Group();
  overlay.name = 'Light selection overlay';
  prepareHelper(overlay);
  const diameter = Math.max(modifier.widthM, modifier.heightM);
  const ring = new Mesh(
    new CircleGeometry(diameter / 2 + 0.07, 32),
    new MeshBasicMaterial({ color: 0xe8a33d, side: DoubleSide, transparent: true, opacity: 0.88 }),
  );
  ring.name = 'Light selection ring';
  ring.scale.set(modifier.widthM / diameter, modifier.heightM / diameter, 1);
  ring.position.z = 0.012;
  prepareHelper(ring);
  overlay.add(ring);

  const lengthM = 3;
  const halfAngle = Math.min(80, effectiveBeamAngle(state, modifier) / 2) * (Math.PI / 180);
  const cone = new Mesh(
    new CylinderGeometry(0.03, Math.max(0.03, lengthM * Math.tan(halfAngle)), lengthM, 32, 1, true),
    new MeshBasicMaterial({ color: 0xe8a33d, side: DoubleSide, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  cone.name = 'Light beam cone';
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = lengthM / 2;
  prepareHelper(cone);
  overlay.add(cone);
  root.add(overlay);
}

export function updateLightBodyColor(root: Group, state: LightState): void {
  const rgb = state.enabled ? kelvinToRgb(state.colorTempK) : [0.43, 0.45, 0.48] as const;
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.userData.lightFace) return;
    const material = object.material;
    if (material instanceof MeshBasicMaterial) material.color.setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
  });
}

function buildCategoryBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  switch (modifier.category) {
    case 'bare':
      return buildBareBody(state, modifier);
    case 'reflector':
      return buildReflectorBody(state, modifier);
    case 'softbox':
      return buildSoftboxBody(state, modifier, false);
    case 'stripbox':
      return buildSoftboxBody(state, modifier, true);
    case 'octabox':
      return buildOctaboxBody(state, modifier);
    case 'umbrella':
      return buildUmbrellaBody(state, modifier);
    case 'dish':
      return buildDishBody(state, modifier);
    case 'snoot':
      return buildSnootBody(state, modifier);
  }
}

function buildBareBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  const group = equipmentGroup('Bare bulb assembly');
  const centerZ = -modifier.depthM - HEAD_LENGTH / 2;
  buildStrobeHead(group, state, centerZ, 1);
  const dome = new Mesh(
    new SphereGeometry(0.027, 16, 10),
    new MeshPhysicalMaterial({ color: 0xfff5e5, roughness: 0.22, transmission: 0.2, thickness: 0.004, side: DoubleSide }),
  );
  dome.name = 'Frosted modelling lamp';
  dome.position.z = -0.006;
  prepareHelper(dome);
  group.add(dome);
  const flashTube = new Mesh(
    new TorusGeometry(0.031, 0.0027, 5, 32),
    new MeshStandardMaterial({ color: 0xdce7f1, roughness: 0.25, metalness: 0.72 }),
  );
  flashTube.name = 'Exposed flash tube';
  flashTube.position.z = 0.012;
  prepareHelper(flashTube);
  group.add(flashTube);
  const cap = new Mesh(new TorusGeometry(0.045, 0.004, 5, 32), blackMetalMaterial());
  cap.name = 'Protective bulb ring';
  cap.position.z = 0.017;
  prepareHelper(cap);
  group.add(cap);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function buildReflectorBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  const group = equipmentGroup('Reflector assembly');
  const depth = modifier.depthM;
  const radius = modifier.widthM / 2;
  addLatheShell(group, radius, depth, true, false);
  addTorus(group, radius, 0.006, 0.004, blackMetalMaterial(), 'Reflector mouth rim');
  const ring = new Mesh(new TorusGeometry(0.064, 0.006, 6, 32), seamMaterial());
  ring.name = 'Reflector speed ring';
  ring.position.z = -depth + 0.01;
  prepareHelper(ring);
  group.add(ring);
  const centerZ = -depth - HEAD_LENGTH / 2;
  buildStrobeHead(group, state, centerZ, 1);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function buildSoftboxBody(state: LightState, modifier: ModifierPreset, strip: boolean): LightBodyBuild {
  const group = equipmentGroup(strip ? 'Stripbox assembly' : 'Softbox assembly');
  const rearWidth = Math.min(0.14, modifier.widthM * 0.22);
  const rearHeight = Math.min(0.14, modifier.heightM * 0.22);
  const frontWidth = modifier.widthM + 0.045;
  const frontHeight = modifier.heightM + 0.045;
  const rearZ = -modifier.depthM + 0.012;
  const shell = createRectangularPyramid(rearWidth, rearHeight, rearZ, frontWidth, frontHeight, DIFFUSER_LIP_Z);
  const shellMesh = new Mesh(shell, fabricMaterial());
  shellMesh.name = strip ? 'Stripbox fabric shell' : 'Softbox fabric shell';
  prepareHelper(shellMesh);
  group.add(shellMesh);

  const seams = seamMaterial();
  const rearX = rearWidth / 2;
  const rearY = rearHeight / 2;
  const frontX = frontWidth / 2;
  const frontY = frontHeight / 2;
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      addRod(group, new Vector3(signX * rearX, signY * rearY, rearZ), new Vector3(signX * frontX, signY * frontY, DIFFUSER_LIP_Z), 0.0023, seams, 5);
    }
  }
  addRectangleFrame(group, frontWidth, frontHeight, DIFFUSER_LIP_Z, 0.003, seams);
  addRectangleFrame(group, rearWidth, rearHeight, rearZ, 0.005, silverMaterial());
  addRectangleLip(group, modifier.widthM, modifier.heightM, DIFFUSER_LIP_Z, 0.018, fabricMaterial());

  const centerZ = -modifier.depthM - HEAD_LENGTH / 2;
  buildStrobeHead(group, state, centerZ, 1);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function buildOctaboxBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  const group = equipmentGroup('Octabox assembly');
  const frontRadius = modifier.widthM / 2 + 0.02;
  const rearRadius = Math.min(0.075, frontRadius * 0.24);
  const rearZ = -modifier.depthM + 0.012;
  const shellMesh = new Mesh(createOctagonalPyramid(rearRadius, rearZ, frontRadius, DIFFUSER_LIP_Z), fabricMaterial());
  shellMesh.name = 'Octabox fabric shell';
  prepareHelper(shellMesh);
  group.add(shellMesh);
  const rearVertices = octagonVertices(rearRadius, rearZ);
  const frontVertices = octagonVertices(frontRadius, DIFFUSER_LIP_Z);
  for (let i = 0; i < 8; i++) {
    addRod(group, rearVertices[i]!, frontVertices[i]!, 0.0024, seamMaterial(), 5);
    addRod(group, frontVertices[i]!, frontVertices[(i + 1) % 8]!, 0.003, seamMaterial(), 5);
  }
  const rearFrame = octagonVertices(rearRadius * 0.98, rearZ);
  for (let i = 0; i < 8; i++) addRod(group, rearFrame[i]!, rearFrame[(i + 1) % 8]!, 0.004, silverMaterial(), 5);

  const centerZ = -modifier.depthM - HEAD_LENGTH / 2;
  buildStrobeHead(group, state, centerZ, 1);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function buildUmbrellaBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  const group = equipmentGroup('Umbrella assembly');
  const shootThrough = modifier.id.startsWith('umbrella-shoot');
  const radius = modifier.widthM / 2;
  const depth = modifier.depthM;
  const reverseHead = !shootThrough;
  const centerZ = reverseHead ? HEAD_LENGTH / 2 : -depth - HEAD_LENGTH / 2;
  addUmbrellaCanopy(group, radius, depth, shootThrough, modifier.id.includes('silver'));
  addUmbrellaRibs(group, radius, depth, shootThrough);

  const shaftLength = depth + 0.2;
  const shaft = new Mesh(new CylinderGeometry(0.006, 0.006, shaftLength, 8), seamMaterial());
  shaft.name = 'Umbrella shaft';
  shaft.rotation.x = (shootThrough ? Math.PI : 0) + Math.PI / 2;
  shaft.position.z = shootThrough ? -depth / 2 - 0.07 : -depth / 2 + 0.05;
  prepareHelper(shaft);
  group.add(shaft);
  const tipZ = shootThrough ? -0.035 : -depth;
  const ferrule = new Mesh(new SphereGeometry(0.018, 10, 8), silverMaterial());
  ferrule.name = 'Umbrella ferrule';
  ferrule.position.z = tipZ;
  prepareHelper(ferrule);
  group.add(ferrule);

  buildStrobeHead(group, state, centerZ, reverseHead ? -1 : 1);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function buildDishBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  const group = equipmentGroup('Beauty dish assembly');
  const depth = modifier.depthM;
  const radius = modifier.widthM / 2;
  const silver = modifier.id.includes('silver');
  addLatheShell(group, radius, depth, false, silver);
  addTorus(group, radius, 0.006, 0.004, blackMetalMaterial(), 'Beauty dish rolled rim');
  const deflector = new Mesh(
    new CircleGeometry(0.06, 20),
    silver ? silverMaterial() : new MeshStandardMaterial({ color: 0xe8e8e3, roughness: 0.53, metalness: 0.1, side: DoubleSide }),
  );
  deflector.name = 'Beauty dish deflector';
  deflector.position.z = -depth * 0.36;
  prepareHelper(deflector);
  group.add(deflector);
  const supportZ = -depth * 0.78;
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3;
    addRod(
      group,
      new Vector3(Math.cos(angle) * 0.075, Math.sin(angle) * 0.075, supportZ),
      new Vector3(Math.cos(angle) * 0.045, Math.sin(angle) * 0.045, deflector.position.z),
      0.002,
      seamMaterial(),
      5,
    );
  }
  const centerZ = -depth - HEAD_LENGTH / 2;
  buildStrobeHead(group, state, centerZ, 1);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function buildSnootBody(state: LightState, modifier: ModifierPreset): LightBodyBuild {
  const group = equipmentGroup('Snoot assembly');
  const depth = modifier.depthM;
  const tube = new Mesh(new CylinderGeometry(0.03, 0.095, depth, 18, 1, true), blackMetalMaterial());
  tube.name = 'Tapered snoot';
  tube.rotation.x = Math.PI / 2;
  tube.position.z = -depth / 2;
  prepareHelper(tube);
  group.add(tube);
  addTorus(group, 0.03, 0.003, 0.003, seamMaterial(), 'Snoot aperture rim');
  const mountRing = new Mesh(new TorusGeometry(0.07, 0.005, 5, 28), seamMaterial());
  mountRing.name = 'Snoot mount ring';
  mountRing.position.z = -depth + 0.01;
  prepareHelper(mountRing);
  group.add(mountRing);
  const centerZ = -depth - HEAD_LENGTH / 2;
  buildStrobeHead(group, state, centerZ, 1);
  return { group, mountPoint: new Vector3(0, -0.14, centerZ) };
}

function equipmentGroup(name: string): Group {
  const group = new Group();
  group.name = name;
  prepareHelper(group);
  return group;
}

function buildStrobeHead(root: Group, state: LightState, centerZ: number, forwardSign: 1 | -1): void {
  const continuous = state.output.kind === 'continuous';
  const shellMaterial = new MeshStandardMaterial({
    color: continuous ? 0x8c9299 : 0x252a31,
    roughness: continuous ? 0.62 : 0.5,
    metalness: continuous ? 0.28 : 0.25,
  });
  const barrel = new Mesh(new CylinderGeometry(HEAD_RADIUS, HEAD_RADIUS, HEAD_LENGTH, 20, 1), shellMaterial);
  barrel.name = continuous ? 'LED monolight body' : 'Strobe monolight body';
  barrel.rotation.x = forwardSign * Math.PI / 2;
  barrel.position.z = centerZ;
  prepareHelper(barrel);
  root.add(barrel);

  const frontZ = centerZ + forwardSign * (HEAD_LENGTH / 2);
  const bowens = new Mesh(new TorusGeometry(0.056, 0.0045, 6, 32), seamMaterial());
  bowens.name = 'Bowens mount ring';
  bowens.position.z = frontZ;
  prepareHelper(bowens);
  root.add(bowens);

  const rearZ = centerZ - forwardSign * (HEAD_LENGTH / 2 + 0.002);
  const rear = new Mesh(
    new CircleGeometry(0.042, 20),
    new MeshStandardMaterial({ color: continuous ? 0x363c43 : 0x5c626a, roughness: 0.72, metalness: 0.18, side: DoubleSide }),
  );
  rear.name = continuous ? 'LED rear panel' : 'Strobe control panel';
  rear.position.z = rearZ;
  prepareHelper(rear);
  root.add(rear);
  const display = new Mesh(
    new PlaneGeometry(0.028, 0.017),
    new MeshBasicMaterial({ color: continuous ? 0x9baeb7 : 0x222b31, side: DoubleSide }),
  );
  display.name = continuous ? 'LED status display' : 'Power display';
  display.position.set(0, 0.012, rearZ + (forwardSign > 0 ? -0.002 : 0.002));
  prepareHelper(display);
  root.add(display);
  for (const x of [-0.022, 0.022]) {
    const knob = new Mesh(new CylinderGeometry(0.006, 0.006, 0.005, 8), seamMaterial());
    knob.name = 'Rear control knob';
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, -0.013, rearZ + (forwardSign > 0 ? -0.004 : 0.004));
    prepareHelper(knob);
    root.add(knob);
  }

  const ventMaterial = new MeshStandardMaterial({ color: continuous ? 0x525960 : 0x13171c, roughness: 0.74, metalness: 0.25 });
  for (let i = 0; i < 5; i++) {
    const vent = new Mesh(new PlaneGeometry(0.036, 0.0025), ventMaterial.clone());
    vent.name = 'Head vent rib';
    vent.position.set(0, 0.028 - i * 0.008, centerZ - forwardSign * 0.045);
    prepareHelper(vent);
    root.add(vent);
  }

  const yoke = seamMaterial();
  for (const x of [-0.078, 0.078]) {
    const pivot = new Mesh(new CylinderGeometry(0.024, 0.024, 0.014, 12), blackMetalMaterial());
    pivot.name = 'Yoke tilt pivot';
    pivot.rotation.z = Math.PI / 2;
    pivot.position.set(x, -0.11, centerZ);
    prepareHelper(pivot);
    root.add(pivot);
    addRod(root, new Vector3(x, -0.11, centerZ), new Vector3(x, 0.06, centerZ + 0.02), 0.008, yoke, 7);
    addRod(root, new Vector3(x, 0.06, centerZ + 0.02), new Vector3(x, 0.06, centerZ - forwardSign * 0.09), 0.008, yoke, 7);
  }
  addRod(root, new Vector3(-0.078, 0.06, centerZ - forwardSign * 0.09), new Vector3(0.078, 0.06, centerZ - forwardSign * 0.09), 0.008, yoke, 7);
  addRod(root, new Vector3(-0.018, 0.085, rearZ), new Vector3(0.018, 0.085, rearZ), 0.004, yoke, 6);
}

function addLightFace(root: Group, state: LightState, modifier: ModifierPreset): void {
  let geometry;
  if (modifier.shape === 'rect') {
    geometry = new PlaneGeometry(modifier.widthM, modifier.heightM);
  } else if (modifier.shape === 'octagon') {
    geometry = octagonFaceGeometry(modifier.widthM, modifier.heightM);
  } else {
    geometry = new CircleGeometry(modifier.widthM / 2, 32);
  }
  const seeThrough = modifier.category === 'reflector' || modifier.category === 'dish' || modifier.category === 'umbrella';
  const color = state.enabled ? kelvinToRgb(state.colorTempK) : [0.43, 0.45, 0.48] as const;
  const face = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: 0xffffff,
      side: DoubleSide,
      transparent: seeThrough,
      opacity: seeThrough ? 0.2 : 1,
      depthWrite: !seeThrough,
    }),
  );
  face.name = 'Light emitting face';
  face.userData.lightFace = true;
  face.position.z = 0;
  prepareHelper(face);
  root.add(face);
  const material = face.material as MeshBasicMaterial;
  material.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
}

function addGrid(root: Group, modifier: ModifierPreset, gridDeg: number): void {
  const radius = Math.max(0.012, modifier.widthM * gridDeg / 240);
  const xStep = radius * 1.5;
  const yStep = Math.sqrt(3) * radius;
  const points: number[] = [];
  const rowLimit = Math.ceil(modifier.heightM / yStep) + 2;
  const columnLimit = Math.ceil(modifier.widthM / xStep) + 2;
  for (let row = -rowLimit; row <= rowLimit; row++) {
    const y = row * yStep;
    const offset = Math.abs(row % 2) * xStep / 2;
    for (let column = -columnLimit; column <= columnLimit; column++) {
      const x = column * xStep + offset;
      if (!insideFace(x, y, modifier)) continue;
      const corners = Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i;
        return new Vector2(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      });
      for (let i = 0; i < 6; i++) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 6]!;
        if (!insideFace(a.x, a.y, modifier) || !insideFace(b.x, b.y, modifier)) continue;
        points.push(a.x, a.y, 0.002, b.x, b.y, 0.002);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const grid = new LineSegments(geometry, new LineBasicMaterial({ color: 0x1b2026, transparent: true, opacity: 0.9, depthTest: true }));
  grid.name = `Honeycomb grid ${gridDeg}°`;
  prepareHelper(grid);
  root.add(grid);
}

function addBarnDoors(
  root: Group,
  modifier: ModifierPreset,
  doors: NonNullable<LightState['accessories']['barnDoors']>,
): void {
  const radius = modifier.widthM / 2;
  const width = modifier.widthM * 0.56;
  const material = new MeshStandardMaterial({ color: 0x292e35, roughness: 0.52, metalness: 0.5, side: DoubleSide });
  const configs = [
    { name: 'top', hinge: new Vector3(0, radius * 0.91, -0.012), width, height: radius * 0.72, axis: 'x', sign: -1, angle: doors.top },
    { name: 'bottom', hinge: new Vector3(0, -radius * 0.91, -0.012), width, height: radius * 0.72, axis: 'x', sign: 1, angle: doors.bottom },
    { name: 'left', hinge: new Vector3(-radius * 0.91, 0, -0.012), width: radius * 0.72, height: width, axis: 'y', sign: 1, angle: doors.left },
    { name: 'right', hinge: new Vector3(radius * 0.91, 0, -0.012), width: radius * 0.72, height: width, axis: 'y', sign: -1, angle: doors.right },
  ] as const;
  for (const config of configs) {
    const geometry = new PlaneGeometry(config.width, config.height);
    if (config.name === 'top') geometry.translate(0, config.height / 2, 0);
    if (config.name === 'bottom') geometry.translate(0, -config.height / 2, 0);
    if (config.name === 'left') geometry.translate(-config.width / 2, 0, 0);
    if (config.name === 'right') geometry.translate(config.width / 2, 0, 0);
    const leaf = new Mesh(geometry, material.clone());
    leaf.name = `Barn door ${config.name}`;
    leaf.userData.barnDoor = config.name;
    leaf.position.copy(config.hinge);
    const angle = (config.sign * config.angle * Math.PI) / 180;
    if (config.axis === 'x') leaf.rotation.x = angle;
    else leaf.rotation.y = angle;
    prepareHelper(leaf);
    root.add(leaf);
    const hinge = new Mesh(new CylinderGeometry(0.006, 0.006, width * 0.8, 8), seamMaterial());
    hinge.name = `Barn door ${config.name} hinge`;
    hinge.rotation.z = Math.PI / 2;
    hinge.position.copy(config.hinge);
    prepareHelper(hinge);
    root.add(hinge);
  }
}

function addUmbrellaCanopy(root: Group, radius: number, depth: number, shootThrough: boolean, silver: boolean): void {
  const profile = Array.from({ length: 9 }, (_, index) => {
    const t = index / 8;
    const r = radius * t;
    const z = shootThrough ? -0.035 - (depth - 0.035) * t * t : -depth + (depth - 0.035) * t * t;
    return new Vector2(r, z);
  });
  const canopy = new Mesh(
    new LatheGeometry(profile, 16),
    new MeshStandardMaterial({
      color: silver ? 0xb7bec5 : 0xe5e6e2,
      roughness: silver ? 0.26 : 0.62,
      metalness: silver ? 0.8 : 0.08,
      side: DoubleSide,
      transparent: true,
      opacity: shootThrough ? 0.26 : 0.86,
      depthWrite: !shootThrough,
    }),
  );
  canopy.name = shootThrough ? 'Shoot-through umbrella canopy' : silver ? 'Silver umbrella reflector' : 'White umbrella reflector';
  canopy.rotation.x = Math.PI / 2;
  prepareHelper(canopy);
  root.add(canopy);
}

function addUmbrellaRibs(root: Group, radius: number, depth: number, shootThrough: boolean): void {
  const material = seamMaterial();
  const steps = 5;
  for (let rib = 0; rib < 8; rib++) {
    const angle = (rib * Math.PI) / 4;
    for (let step = 0; step < steps; step++) {
      const a = step / steps;
      const b = (step + 1) / steps;
      const za = shootThrough ? -0.035 - (depth - 0.035) * a * a : -depth + (depth - 0.035) * a * a;
      const zb = shootThrough ? -0.035 - (depth - 0.035) * b * b : -depth + (depth - 0.035) * b * b;
      addRod(
        root,
        new Vector3(Math.cos(angle) * radius * a, Math.sin(angle) * radius * a, za),
        new Vector3(Math.cos(angle) * radius * b, Math.sin(angle) * radius * b, zb),
        0.0017,
        material,
        5,
      );
    }
  }
}

function addLatheShell(root: Group, radius: number, depth: number, reflector: boolean, silverInside: boolean): void {
  const dishProfile = reflector
    ? [[0.045, -depth], [0.07, -depth * 0.82], [radius * 0.74, -depth * 0.43], [radius, -0.004]]
    : [[0.025, -depth], [radius * 0.38, -depth * 0.82], [radius * 0.72, -depth * 0.52], [radius * 0.92, -depth * 0.22], [radius, -0.004]];
  const innerProfile = dishProfile.map(([r, z]) => new Vector2(r!, z! + 0.002));
  const outerProfile = dishProfile.map(([r, z]) => new Vector2(r! + 0.005, z!));
  const interior = new Mesh(
    new LatheGeometry(innerProfile, reflector ? 20 : 24),
    new MeshStandardMaterial({
      color: silverInside ? 0xb8c0c9 : reflector ? 0xaeb4bb : 0xe4e4df,
      roughness: silverInside ? 0.28 : reflector ? 0.34 : 0.52,
      metalness: silverInside || reflector ? 0.78 : 0.08,
      side: DoubleSide,
    }),
  );
  interior.name = reflector ? 'Reflector brushed interior' : silverInside ? 'Beauty dish silver interior' : 'Beauty dish white interior';
  interior.rotation.x = Math.PI / 2;
  prepareHelper(interior);
  root.add(interior);

  const exterior = new Mesh(
    new LatheGeometry(outerProfile, reflector ? 20 : 24),
    new MeshStandardMaterial({ color: 0x252a30, roughness: 0.58, metalness: 0.42, side: DoubleSide }),
  );
  exterior.name = reflector ? 'Reflector dark exterior' : 'Beauty dish dark exterior';
  exterior.rotation.x = Math.PI / 2;
  prepareHelper(exterior);
  root.add(exterior);
}

function addTorus(
  root: Group,
  radius: number,
  tube: number,
  z: number,
  material: Mesh['material'],
  name: string,
): void {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 6, 32), material);
  mesh.name = name;
  mesh.position.z = z;
  prepareHelper(mesh);
  root.add(mesh);
}

function createRectangularPyramid(
  backWidth: number,
  backHeight: number,
  backZ: number,
  frontWidth: number,
  frontHeight: number,
  frontZ: number,
): BufferGeometry {
  const back = [
    [-backWidth / 2, -backHeight / 2, backZ], [backWidth / 2, -backHeight / 2, backZ],
    [backWidth / 2, backHeight / 2, backZ], [-backWidth / 2, backHeight / 2, backZ],
  ];
  const front = [
    [-frontWidth / 2, -frontHeight / 2, frontZ], [frontWidth / 2, -frontHeight / 2, frontZ],
    [frontWidth / 2, frontHeight / 2, frontZ], [-frontWidth / 2, frontHeight / 2, frontZ],
  ];
  return quadRingGeometry(back, front);
}

function createOctagonalPyramid(backRadius: number, backZ: number, frontRadius: number, frontZ: number): BufferGeometry {
  const back = octagonVertices(backRadius, backZ).map((point) => point.toArray());
  const front = octagonVertices(frontRadius, frontZ).map((point) => point.toArray());
  return quadRingGeometry(back, front);
}

function quadRingGeometry(back: number[][], front: number[][]): BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const count = back.length;
  for (const point of [...back, ...front]) vertices.push(point[0]!, point[1]!, point[2]!);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const a = i;
    const b = next;
    const c = count + next;
    const d = count + i;
    indices.push(a, b, d, b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function octagonVertices(radius: number, z: number): Vector3[] {
  const correctedRadius = radius / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, index) => {
    const angle = Math.PI / 8 + (index * Math.PI) / 4;
    return new Vector3(Math.cos(angle) * correctedRadius, Math.sin(angle) * correctedRadius, z);
  });
}

function octagonFaceGeometry(width: number, height: number): ShapeGeometry {
  const shape = new Shape();
  for (let index = 0; index < 8; index++) {
    const angle = Math.PI / 8 + (index * Math.PI) / 4;
    const x = (width / 2) * (Math.cos(angle) / Math.cos(Math.PI / 8));
    const y = (height / 2) * (Math.sin(angle) / Math.cos(Math.PI / 8));
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new ShapeGeometry(shape);
}

function addRectangleFrame(parent: Group, width: number, height: number, z: number, radius: number, material: Mesh['material']): void {
  const x = width / 2;
  const y = height / 2;
  addRod(parent, new Vector3(-x, -y, z), new Vector3(x, -y, z), radius, material, 5);
  addRod(parent, new Vector3(x, -y, z), new Vector3(x, y, z), radius, material, 5);
  addRod(parent, new Vector3(x, y, z), new Vector3(-x, y, z), radius, material, 5);
  addRod(parent, new Vector3(-x, y, z), new Vector3(-x, -y, z), radius, material, 5);
}

function addRectangleLip(parent: Group, width: number, height: number, z: number, thickness: number, material: Material): void {
  const sides = [
    { width: width + thickness * 2, height: thickness, x: 0, y: height / 2 + thickness / 2 },
    { width: width + thickness * 2, height: thickness, x: 0, y: -height / 2 - thickness / 2 },
    { width: thickness, height, x: width / 2 + thickness / 2, y: 0 },
    { width: thickness, height, x: -width / 2 - thickness / 2, y: 0 },
  ];
  for (const side of sides) {
    const lip = new Mesh(new PlaneGeometry(side.width, side.height), material.clone());
    lip.name = 'Softbox diffuser lip';
    lip.position.set(side.x, side.y, z);
    prepareHelper(lip);
    parent.add(lip);
  }
}

function insideFace(x: number, y: number, modifier: ModifierPreset): boolean {
  if (modifier.shape === 'rect') return Math.abs(x) <= modifier.widthM / 2 && Math.abs(y) <= modifier.heightM / 2;
  if (modifier.shape === 'octagon') {
    return Math.abs(x) <= modifier.widthM / 2 && Math.abs(y) <= modifier.heightM / 2
      && Math.abs(x) + Math.abs(y) <= modifier.widthM * 0.96;
  }
  return Math.hypot(x, y) <= modifier.widthM / 2;
}

function effectiveBeamAngle(state: LightState, modifier: ModifierPreset): number {
  const grid = modifier.acceptsGrid ? state.accessories.gridDeg : null;
  return grid === null ? modifier.beamAngleDeg : Math.min(modifier.beamAngleDeg, grid);
}
