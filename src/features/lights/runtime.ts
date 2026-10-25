import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RectAreaLight,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { AppContext, EntityRef } from '../../core/context';
import { LAYER_HELPERS, LAYER_SCENE } from '../../core/context';
import { getModifier } from '../../scene/modifiers';
import { illuminanceAt, kelvinToRgb, lightColor, onAxisIntensity, outerAngleForHalfPower } from '../../scene/lightModel';
import { renderIntensityContinuous, renderIntensityStrobe } from '../../scene/photometry';
import type { LightState, PropState, SceneDocument, Vec3 } from '../../scene/types';
import { isLargeDiffuseSource, rectEffectiveArea, sourceDistance, splitSoftSource } from './renderMath';

const FORWARD = new Vector3(0, 0, 1);
// Bodies point +Z at their target, but three.js lights emit along their local -Z, so an
// area light copying a body's orientation needs a half turn to face the same way.
const FLIP_TO_LIGHT_AXIS = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const AREA_SHARE = 0.58;
let areaUniformsReady = false;
let gizmoCommitSerial = 0;

interface LightRuntime {
  body: Group;
  stand: Mesh;
  proxy: Object3D;
  spot: SpotLight | null;
  point: PointLight | null;
  target: Object3D | null;
  area: RectAreaLight | null;
  unregister: () => void;
  bodySignature: string;
  state: LightState;
  position: Vec3;
}

interface PropRuntime {
  body: Group;
  proxy: Object3D;
  surface: Mesh;
  bounce: RectAreaLight | null;
  unregister: () => void;
  signature: string;
  state: PropState;
  position: Vec3;
}

/** Owns all live lights, prop meshes, their helper bodies, and the shared gizmo. */
export function createLightRuntime(ctx: AppContext): {
  sync(doc: SceneDocument): void;
  attachSelection(ref: EntityRef | null): void;
} {
  if (!areaUniformsReady) {
    RectAreaLightUniformsLib.init();
    areaUniformsReady = true;
  }

  const lights = new Map<string, LightRuntime>();
  const props = new Map<string, PropRuntime>();
  let activeProxy: Object3D | null = null;

  const createLight = (state: LightState): LightRuntime => {
    const body = new Group();
    body.userData.editorOnly = true;
    body.layers.set(LAYER_HELPERS);
    body.visible = ctx.views.mode === 'set';
    ctx.scene.add(body);
    const stand = new Mesh(new CylinderGeometry(0.025, 0.035, 1, 8), new MeshStandardMaterial({ color: 0x30343b, roughness: 0.7 }));
    prepareHelper(stand);
    stand.visible = ctx.views.mode === 'set';
    ctx.scene.add(stand);
    const proxy = new Object3D();
    proxy.userData.editorOnly = true;
    ctx.scene.add(proxy);

    const modifier = getModifier(state.modifierId);
    const zeroIntensity = state.output.kind === 'strobe'
      ? renderIntensityStrobe(0, ctx.store.doc.camera)
      : renderIntensityContinuous(0, ctx.store.doc.camera);
    let spot: SpotLight | null = null;
    let point: PointLight | null = null;
    let target: Object3D | null = null;
    if (modifier.category === 'bare') {
      point = new PointLight(0xffffff, zeroIntensity, 0, 2);
      point.castShadow = true;
      point.shadow.mapSize.set(1024, 1024);
      point.shadow.camera.near = 0.05;
      point.shadow.camera.far = 30;
      point.shadow.radius = 3;
      ctx.scene.add(point);
    } else {
      target = new Object3D();
      target.userData.editorOnly = true;
      ctx.scene.add(target);
      spot = new SpotLight(0xffffff, zeroIntensity, 0, 0.7, 1, 2);
      spot.castShadow = true;
      spot.shadow.mapSize.set(2048, 2048);
      spot.shadow.camera.near = 0.05;
      spot.shadow.bias = -0.00015;
      spot.shadow.normalBias = 0.015;
      spot.target = target;
      ctx.scene.add(spot);
    }

    const area = isLargeDiffuseSource(state)
      ? new RectAreaLight(0xffffff, zeroIntensity, modifier.widthM, modifier.heightM)
      : null;
    if (area) {
      area.userData.editorOnly = true;
      area.layers.set(LAYER_SCENE);
      ctx.scene.add(area);
    }

    const runtime: LightRuntime = {
      body,
      stand,
      proxy,
      spot,
      point,
      target,
      area,
      unregister: ctx.picking.register(body, { kind: 'light', id: state.id }),
      bodySignature: '',
      state,
      position: [...state.position],
    };
    lights.set(state.id, runtime);
    return runtime;
  };

  const createProp = (state: PropState): PropRuntime => {
    const body = new Group();
    body.layers.set(LAYER_SCENE);
    const surface = makePropSurface(state);
    body.add(surface);
    ctx.scene.add(body);
    const proxy = new Object3D();
    proxy.userData.editorOnly = true;
    ctx.scene.add(proxy);
    const bounce = state.kind === 'bounce'
      ? new RectAreaLight(0xffffff, renderIntensityContinuous(0, ctx.store.doc.camera), state.widthM, state.heightM)
      : null;
    if (bounce) {
      bounce.userData.editorOnly = true;
      bounce.layers.set(LAYER_SCENE);
      ctx.scene.add(bounce);
    }
    const runtime: PropRuntime = {
      body,
      proxy,
      surface,
      bounce,
      unregister: ctx.picking.register(body, { kind: 'prop', id: state.id }),
      signature: '',
      state,
      position: [...state.position],
    };
    props.set(state.id, runtime);
    return runtime;
  };

  const moveLight = (runtime: LightRuntime, state: LightState, doc: SceneDocument, position: Vec3) => {
    runtime.position = [...position];
    runtime.body.position.fromArray(position);
    runtime.proxy.position.fromArray(position);
    const posedState = position === state.position ? state : { ...state, position };
    const axis = new Vector3(...state.target).sub(new Vector3(...position)).normalize();
    orientForward(runtime.body, axis, state.rollDeg);
    runtime.stand.position.set(position[0], Math.max(0, position[1]) / 2, position[2]);
    runtime.stand.scale.y = Math.max(0.05, position[1]);
    if (runtime.spot && runtime.target) {
      runtime.spot.position.fromArray(position);
      runtime.target.position.fromArray(state.target);
      runtime.target.updateMatrixWorld(true);
      const outer = lightOuterAngle(state);
      runtime.spot.angle = outer;
      runtime.spot.penumbra = state.accessories.barnDoors ? 0.05 : 1;
      const distance = Math.max(0.05, new Vector3(...position).distanceTo(new Vector3(...state.target)));
      const face = getModifier(state.modifierId);
      const frustumWidth = Math.max(0.1, 2 * distance * Math.tan(outer));
      runtime.spot.shadow.radius = Math.min(128, Math.max(1, ((Math.hypot(face.widthM, face.heightM) / 2) / frustumWidth) * runtime.spot.shadow.mapSize.x));
      runtime.spot.shadow.camera.fov = Math.min(175, (2 * outer * 180) / Math.PI);
      runtime.spot.shadow.camera.far = Math.max(8, distance + 4);
      runtime.spot.shadow.camera.updateProjectionMatrix();
    }
    if (runtime.point) runtime.point.position.fromArray(position);
    const areaShare = runtime.area && state.accessories.gridDeg === null && !state.accessories.barnDoors ? AREA_SHARE : 0;
    if (runtime.area) {
      runtime.area.position.fromArray(position);
      runtime.area.quaternion.copy(runtime.body.quaternion).multiply(FLIP_TO_LIGHT_AXIS);
      const color = lightColor(state.colorTempK, doc.camera.whiteBalanceK);
      runtime.area.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
      const physical = onAxisIntensity(state);
      const face = getModifier(state.modifierId);
      const split = splitSoftSource(physical.value, face.widthM, face.heightM, sourceDistance(posedState), areaShare);
      setPhysicalIntensity(runtime.area, split.areaLuminance, physical.perSecond, doc);
    }

    const color = lightColor(state.colorTempK, doc.camera.whiteBalanceK);
    const physical = onAxisIntensity(state);
    if (runtime.spot) {
      runtime.spot.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
      const face = getModifier(state.modifierId);
      const spotValue = runtime.area
        ? splitSoftSource(physical.value, face.widthM, face.heightM, sourceDistance(posedState), areaShare).spotIntensity
        : physical.value;
      setPhysicalIntensity(runtime.spot, spotValue, physical.perSecond, doc);
      runtime.spot.visible = state.enabled;
    }
    if (runtime.point) {
      runtime.point.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
      setPhysicalIntensity(runtime.point, physical.value, physical.perSecond, doc);
      runtime.point.visible = state.enabled;
    }
    if (runtime.area) runtime.area.visible = state.enabled && areaShare > 0;
  };

  const moveProp = (runtime: PropRuntime, state: PropState, doc: SceneDocument, position: Vec3) => {
    runtime.position = [...position];
    runtime.body.position.fromArray(position);
    runtime.proxy.position.fromArray(position);
    const axis = new Vector3(...state.target).sub(new Vector3(...position)).normalize();
    orientForward(runtime.body, axis, state.rollDeg);
    if (runtime.bounce) {
      const faceNormal = axis.lengthSq() > 0 ? axis : new Vector3(0, 0, 1);
      runtime.bounce.position.copy(new Vector3(...position).addScaledVector(faceNormal, 0.015));
      runtime.bounce.quaternion.copy(runtime.body.quaternion).multiply(FLIP_TO_LIGHT_AXIS);
      const virtualScale = state.color === '#c8cdd2' ? 0.35 : 1;
      const width = Math.max(0.05, state.widthM * virtualScale);
      const height = Math.max(0.05, state.heightM * virtualScale);
      runtime.bounce.width = width;
      runtime.bounce.height = height;
      const reflectance = state.color === '#c8cdd2' ? 0.9 : state.color === '#d9aa38' ? 0.68 : 0.85;
      const sampleNormal = new Vector3(...position).sub(new Vector3(...state.target)).normalize();
      let reflectedLux = 0;
      for (const light of doc.lights) {
        if (!light.enabled) continue;
        const directionToSource = new Vector3(...light.position).sub(new Vector3(...position)).normalize();
        const panelCosine = Math.abs(sampleNormal.dot(directionToSource));
        const e = illuminanceAt(light, position);
        reflectedLux += (light.output.kind === 'strobe' ? e / doc.camera.shutterS : e) * panelCosine;
      }
      // One-bounce live approximation: the HQ render handles the actual panel BRDF and
      // occlusion. The preview keeps panel-received illuminance and reflectance in flux.
      const candela = (reflectedLux * reflectance * state.widthM * state.heightM) / Math.PI;
      const targetDistance = Math.max(0.1, new Vector3(...state.target).distanceTo(new Vector3(...position)));
      const effectiveArea = rectEffectiveArea(width, height, targetDistance);
      const rgb = bounceColor(state.color);
      runtime.bounce.color.setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
      setPhysicalIntensity(runtime.bounce, candela / effectiveArea, true, doc);
      runtime.bounce.visible = state.kind === 'bounce';
    }
  };

  const disposeLight = (id: string) => {
    const runtime = lights.get(id);
    if (!runtime) return;
    runtime.unregister();
    ctx.scene.remove(runtime.body, runtime.stand, runtime.proxy);
    disposeObject(runtime.body);
    disposeObject(runtime.stand);
    if (runtime.spot) {
      if (runtime.spot.shadow.map) runtime.spot.shadow.map.dispose();
      ctx.scene.remove(runtime.spot, runtime.target!);
    }
    if (runtime.point) {
      if (runtime.point.shadow.map) runtime.point.shadow.map.dispose();
      ctx.scene.remove(runtime.point);
    }
    if (runtime.area) ctx.scene.remove(runtime.area);
    if (ctx.gizmo.attached === runtime.proxy) ctx.gizmo.detach();
    if (activeProxy === runtime.proxy) activeProxy = null;
    lights.delete(id);
  };

  const disposeProp = (id: string) => {
    const runtime = props.get(id);
    if (!runtime) return;
    runtime.unregister();
    ctx.scene.remove(runtime.body, runtime.proxy);
    disposeObject(runtime.body);
    if (runtime.bounce) ctx.scene.remove(runtime.bounce);
    if (ctx.gizmo.attached === runtime.proxy) ctx.gizmo.detach();
    if (activeProxy === runtime.proxy) activeProxy = null;
    props.delete(id);
  };

  const sync = (doc: SceneDocument) => {
    const lightIds = new Set(doc.lights.map((light) => light.id));
    for (const id of lights.keys()) if (!lightIds.has(id)) disposeLight(id);
    for (const state of doc.lights) {
      let current = lights.get(state.id) ?? createLight(state);
      const wantsPoint = getModifier(state.modifierId).category === 'bare';
      if ((current.point !== null) !== wantsPoint) {
        disposeLight(state.id);
        current = createLight(state);
      }
      current.state = state;
      const signature = lightBodySignature(state, ctx.selection.current?.kind === 'light' && ctx.selection.current.id === state.id);
      if (current.bodySignature !== signature) {
        clearGroup(current.body);
        buildLightBody(current.body, state, ctx.selection.current?.kind === 'light' && ctx.selection.current.id === state.id);
        current.bodySignature = signature;
      } else {
        updateLightBodyColor(current.body, state);
      }
      const wantsArea = isLargeDiffuseSource(state);
      if (current.area && !wantsArea) {
        ctx.scene.remove(current.area);
        current.area = null;
      } else if (!current.area && wantsArea) {
        const modifier = getModifier(state.modifierId);
        const zeroIntensity = state.output.kind === 'strobe'
          ? renderIntensityStrobe(0, doc.camera)
          : renderIntensityContinuous(0, doc.camera);
        current.area = new RectAreaLight(0xffffff, zeroIntensity, modifier.widthM, modifier.heightM);
        current.area.userData.editorOnly = true;
        current.area.layers.set(LAYER_SCENE);
        ctx.scene.add(current.area);
      }
      if (current.area) {
        const modifier = getModifier(state.modifierId);
        current.area.width = modifier.widthM;
        current.area.height = modifier.heightM;
      }
      const dragging = ctx.gizmo.attached === current.proxy && ctx.gizmo.dragging;
      const position = dragging ? current.position : state.position;
      moveLight(current, state, doc, position);
    }

    const propIds = new Set(doc.props.map((prop) => prop.id));
    for (const id of props.keys()) if (!propIds.has(id)) disposeProp(id);
    for (const state of doc.props) {
      const runtime = props.get(state.id) ?? createProp(state);
      runtime.state = state;
      const signature = `${state.kind}|${state.widthM}|${state.heightM}|${state.color}|${state.transmission}`;
      if (signature !== runtime.signature) {
        runtime.body.remove(runtime.surface);
        disposeObject(runtime.surface);
        runtime.surface = makePropSurface(state);
        runtime.body.add(runtime.surface);
        runtime.signature = signature;
        if (state.kind === 'bounce' && !runtime.bounce) {
          runtime.bounce = new RectAreaLight(0xffffff, renderIntensityContinuous(0, doc.camera), state.widthM, state.heightM);
          runtime.bounce.userData.editorOnly = true;
          runtime.bounce.layers.set(LAYER_SCENE);
          ctx.scene.add(runtime.bounce);
        } else if (state.kind !== 'bounce' && runtime.bounce) {
          ctx.scene.remove(runtime.bounce);
          runtime.bounce = null;
        }
      }
      const dragging = ctx.gizmo.attached === runtime.proxy && ctx.gizmo.dragging;
      moveProp(runtime, state, doc, dragging ? runtime.position : state.position);
    }

    const selected = ctx.selection.current;
    if ((selected?.kind === 'light' && !lights.has(selected.id)) || (selected?.kind === 'prop' && !props.has(selected.id))) {
      ctx.selection.set(null);
    }
    updateSelectionHighlight(ctx.selection.current);
    attachSelection(ctx.selection.current);
  };

  const updateSelectionHighlight = (selected: EntityRef | null) => {
    for (const [id, runtime] of lights) {
      const signature = lightBodySignature(runtime.state, selected?.kind === 'light' && selected.id === id);
      if (runtime.bodySignature === signature) continue;
      clearGroup(runtime.body);
      buildLightBody(runtime.body, runtime.state, selected?.kind === 'light' && selected.id === id);
      runtime.bodySignature = signature;
    }
  };

  const attachSelection = (ref: EntityRef | null) => {
    if (ref?.kind === 'light') {
      const runtime = lights.get(ref.id);
      if (!runtime) return;
      if (runtime.proxy === activeProxy && ctx.gizmo.attached === runtime.proxy) return;
      activeProxy = runtime.proxy;
      ctx.gizmo.attach(runtime.proxy, {
        mode: 'translate',
        onChange: (object) => moveLight(runtime, runtime.state, ctx.store.doc as SceneDocument, object.position.toArray() as Vec3),
        onCommit: (object) => {
          const position = object.position.toArray() as Vec3;
          ctx.store.update((draft) => {
            const light = draft.lights.find((item) => item.id === ref.id);
            if (light) light.position = position;
          }, { label: `move light ${ref.id} drag ${gizmoCommitSerial++}` });
        },
      });
      return;
    }
    if (ref?.kind === 'prop') {
      const runtime = props.get(ref.id);
      if (!runtime) return;
      if (runtime.proxy === activeProxy && ctx.gizmo.attached === runtime.proxy) return;
      activeProxy = runtime.proxy;
      ctx.gizmo.attach(runtime.proxy, {
        mode: 'translate',
        onChange: (object) => moveProp(runtime, runtime.state, ctx.store.doc as SceneDocument, object.position.toArray() as Vec3),
        onCommit: (object) => {
          const position = object.position.toArray() as Vec3;
          ctx.store.update((draft) => {
            const prop = draft.props.find((item) => item.id === ref.id);
            if (prop) prop.position = position;
          }, { label: `move prop ${ref.id} drag ${gizmoCommitSerial++}` });
        },
      });
      return;
    }
    if (activeProxy && ctx.gizmo.attached === activeProxy) ctx.gizmo.detach();
    activeProxy = null;
  };

  ctx.store.subscribe((doc) => sync(doc));
  ctx.views.onChange((mode) => {
    for (const runtime of lights.values()) {
      runtime.body.visible = mode === 'set';
      runtime.stand.visible = mode === 'set';
    }
  });
  ctx.selection.onChange((ref) => {
    updateSelectionHighlight(ref);
    attachSelection(ref);
  });
  sync(ctx.store.doc as SceneDocument);
  attachSelection(ctx.selection.current);

  return { sync, attachSelection };
}

function setPhysicalIntensity(light: SpotLight | PointLight | RectAreaLight, value: number, perSecond: boolean, doc: SceneDocument): void {
  light.intensity = perSecond ? renderIntensityContinuous(value, doc.camera) : renderIntensityStrobe(value, doc.camera);
}

function beamAngle(state: LightState): number {
  const modifier = getModifier(state.modifierId);
  const grid = modifier.acceptsGrid ? state.accessories.gridDeg : null;
  return grid === null ? modifier.beamAngleDeg : Math.min(modifier.beamAngleDeg, grid);
}

function lightOuterAngle(state: LightState): number {
  let outer = outerAngleForHalfPower(beamAngle(state) / 2);
  const doors = state.accessories.barnDoors;
  if (doors && getModifier(state.modifierId).acceptsBarnDoors) {
    // A single SpotLight cannot crop four sides independently, so its live cone uses the
    // tightest leaf angle. The pure meter keeps the four asymmetric door limits.
    outer = Math.min(outer, ...Object.values(doors).map((closing) => ((90 - closing) * Math.PI) / 180));
  }
  return Math.min(Math.PI / 2 - 0.005, Math.max(0.01, outer));
}

function lightBodySignature(state: LightState, selected: boolean): string {
  return `${state.modifierId}|${state.accessories.gridDeg ?? ''}|${doorSignature(state)}|selected:${selected}`;
}

function doorSignature(state: LightState): string {
  const doors = state.accessories.barnDoors;
  return doors ? `${doors.top},${doors.bottom},${doors.left},${doors.right}` : '';
}

function orientForward(object: Object3D, axis: Vector3, rollDeg: number): void {
  const forward = axis.lengthSq() > 1e-12 ? axis.clone().normalize() : FORWARD;
  object.quaternion.setFromUnitVectors(FORWARD, forward);
  if (rollDeg !== 0) object.quaternion.multiply(new Quaternion().setFromAxisAngle(FORWARD, (rollDeg * Math.PI) / 180));
}

function buildLightBody(root: Group, state: LightState, selected: boolean): void {
  const modifier = getModifier(state.modifierId);
  const dark = new MeshStandardMaterial({ color: 0x242933, roughness: 0.45, metalness: 0.15, side: DoubleSide });
  let shell: Mesh;
  switch (modifier.category) {
    case 'bare':
      shell = new Mesh(new SphereGeometry(0.065, 14, 10), new MeshBasicMaterial({ color: 0xfff3dd }));
      break;
    case 'softbox':
    case 'stripbox':
      shell = new Mesh(new BoxGeometry(modifier.widthM, modifier.heightM, modifier.depthM), dark);
      shell.position.z = -modifier.depthM / 2;
      break;
    case 'octabox':
      shell = new Mesh(new CylinderGeometry(modifier.widthM / 2, modifier.widthM / 2, modifier.depthM, 8), dark);
      shell.rotation.x = Math.PI / 2;
      shell.position.z = -modifier.depthM / 2;
      break;
    case 'umbrella':
      shell = new Mesh(new SphereGeometry(modifier.widthM / 2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
      shell.rotation.x = Math.PI / 2;
      shell.position.z = -modifier.depthM / 2;
      break;
    case 'reflector':
    case 'dish':
      shell = new Mesh(new CylinderGeometry(modifier.widthM / 2, Math.min(0.06, modifier.widthM / 4), modifier.depthM, 24, 1, true), dark);
      shell.rotation.x = Math.PI / 2;
      shell.position.z = -modifier.depthM / 2;
      break;
    case 'snoot':
      shell = new Mesh(new CylinderGeometry(0.03, modifier.widthM / 2, modifier.depthM, 16, 1, true), dark);
      shell.rotation.x = Math.PI / 2;
      shell.position.z = -modifier.depthM / 2;
      break;
  }
  prepareHelper(shell);
  root.add(shell);
  if (modifier.category === 'umbrella') {
    const shaft = new Mesh(new CylinderGeometry(0.008, 0.008, modifier.depthM * 1.8, 8), new MeshStandardMaterial({ color: 0x838b97, metalness: 0.75, roughness: 0.35 }));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -modifier.depthM * 0.35;
    prepareHelper(shaft);
    root.add(shaft);
  }

  const faceGeometry = modifier.shape === 'rect'
    ? new PlaneGeometry(modifier.widthM, modifier.heightM)
    : new CircleGeometry(modifier.widthM / 2, modifier.shape === 'octagon' ? 8 : 24);
  const faceMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const face = new Mesh(faceGeometry, faceMaterial);
  face.userData.lightFace = true;
  face.position.z = 0.006;
  prepareHelper(face);
  root.add(face);

  const color = kelvinToRgb(state.colorTempK);
  faceMaterial.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
  if (selected) {
    const ring = new Mesh(
      new CircleGeometry(Math.max(modifier.widthM, modifier.heightM) / 2 + 0.07, 32),
      new MeshBasicMaterial({ color: 0xffc45b, side: DoubleSide, transparent: true, opacity: 0.88 }),
    );
    ring.scale.set(modifier.widthM / Math.max(modifier.widthM, modifier.heightM), modifier.heightM / Math.max(modifier.widthM, modifier.heightM), 1);
    ring.position.z = 0.012;
    prepareHelper(ring);
    root.add(ring);

    const lengthM = 3;
    const half = Math.min(80, beamAngle(state) / 2) * (Math.PI / 180);
    const cone = new Mesh(
      new CylinderGeometry(0.03, Math.max(0.03, lengthM * Math.tan(half)), lengthM, 32, 1, true),
      new MeshBasicMaterial({ color: 0xffd77a, side: DoubleSide, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = lengthM / 2;
    prepareHelper(cone);
    root.add(cone);
  }
}

function updateLightBodyColor(root: Group, state: LightState): void {
  const color = kelvinToRgb(state.colorTempK);
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.userData.lightFace) return;
    const material = object.material;
    if (material instanceof MeshBasicMaterial) material.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
  });
}

function makePropSurface(state: PropState): Mesh {
  // A diffusion scrim remains a visible transmissive set mesh in live view; the HQ
  // renderer integrates its transmission along light paths rather than replacing the source.
  const material = new MeshPhysicalMaterial({
    color: state.color,
    side: DoubleSide,
    roughness: state.kind === 'bounce' && state.color === '#c8cdd2' ? 0.22 : 0.86,
    metalness: state.kind === 'bounce' && state.color === '#c8cdd2' ? 0.78 : 0,
    transparent: state.kind === 'diffusion',
    opacity: state.kind === 'diffusion' ? 0.25 + (1 - state.transmission) * 0.35 : 1,
    transmission: state.kind === 'diffusion' ? state.transmission * 0.35 : 0,
    thickness: 0.001,
  });
  const mesh = new Mesh(new PlaneGeometry(state.widthM, state.heightM), material);
  mesh.castShadow = state.kind === 'flag';
  mesh.receiveShadow = true;
  mesh.userData.editorProp = state.id;
  mesh.layers.set(LAYER_SCENE);
  return mesh;
}

function bounceColor(hex: string): [number, number, number] {
  if (hex === '#d9aa38') return [1.22, 0.86, 0.42];
  if (hex === '#c8cdd2') return [1, 1, 1];
  return [1, 1, 1];
}

function prepareHelper(object: Object3D): void {
  object.layers.set(LAYER_HELPERS);
  object.userData.editorOnly = true;
  if (object instanceof Mesh) {
    object.castShadow = false;
    object.receiveShadow = false;
  }
}

function clearGroup(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
