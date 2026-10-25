import {
  Bone,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { AppContext, SubjectModel } from '../../core/context';
import { LAYER_HELPERS } from '../../core/context';
import type { Control } from '../../ui/controls';
import { button, buttonRow, checkbox, group, numberField } from '../../ui/controls';
import { el } from '../../ui/dom';
import type { PoseState, Vec3 } from '../../scene/types';
import { DEG2RAD } from '../../scene/units';
import { solveTwoBoneIK, type Point3 } from './ik';
import { copyPoseSide, localQuaternionForWorldOrientation, mirrorPoseOffsets, offsetToQuaternion, quaternionToOffset } from './poseMath';
import { buildExpressionPresets, POSE_PRESETS } from './presets';

type LimbKind = 'arm' | 'leg';
interface LimbDefinition {
  targetName: string;
  kind: LimbKind;
  side: 'L' | 'R';
  upperName: string;
  lowerName: string;
  endName: string;
}
interface LimbDrag {
  limb: LimbDefinition;
  poleWorld: Vector3;
  endWorldOrientation: Quaternion;
}
interface FootPlant {
  limb: LimbDefinition;
  target: Vector3;
  poleWorld: Vector3;
  endWorldOrientation: Quaternion;
}
interface HipDrag {
  startOffset: Vec3;
  startHipInModel: Vector3;
  plants: FootPlant[];
  latestOffset: Vec3;
}
interface HelperHandle {
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  unregister: () => void;
  swing: boolean;
}
interface TargetProxy {
  object: Group;
  limb: LimbDefinition;
}

const LIMBS: readonly LimbDefinition[] = [
  { targetName: 'Wrist_L', kind: 'arm', side: 'L', upperName: 'Arm_L', lowerName: 'Elbow_L', endName: 'Wrist_L' },
  { targetName: 'Wrist_R', kind: 'arm', side: 'R', upperName: 'Arm_R', lowerName: 'Elbow_R', endName: 'Wrist_R' },
  { targetName: 'Ankle_L', kind: 'leg', side: 'L', upperName: 'Thigh_L', lowerName: 'Knee_L', endName: 'Ankle_L' },
  { targetName: 'Ankle_R', kind: 'leg', side: 'R', upperName: 'Thigh_R', lowerName: 'Knee_R', endName: 'Ankle_R' },
];
const AXES = ['X', 'Y', 'Z'] as const;
const AXIS_INDEX = { X: 0, Y: 1, Z: 2 } as const;
const IK_PREFIX = 'IK:';

/** FK controls, analytic limb IK, pose/expression presets, and floor placement. */
export function install(ctx: AppContext): void {
  addPoseStyles();

  let model: SubjectModel | null = null;
  let basePositions = new Map<string, Vector3>();
  let rootBone: Bone | null = null;
  let poseMode = false;
  let showSwing = false;
  let feetStayPlanted = true;
  let activeLimbDrag: LimbDrag | null = null;
  let activeHipDrag: HipDrag | null = null;
  let helperHandles: HelperHandle[] = [];
  const ownedBoneTargets = new Set<Bone>();
  const placeProxy = new Group();
  placeProxy.name = 'subject-placement-proxy';
  placeProxy.userData.editorOnly = true;
  placeProxy.layers.set(LAYER_HELPERS);
  ctx.scene.add(placeProxy);
  const hipProxy = createProxyGroup('hip-move-proxy');
  ctx.scene.add(hipProxy);
  const targetProxies = new Map<string, TargetProxy>();
  const helperGeometry = new SphereGeometry(1, 10, 8);
  const mainMaterial = new MeshBasicMaterial({ color: 0x70d7ff, depthTest: false, depthWrite: false });
  const swingMaterial = new MeshBasicMaterial({ color: 0xb87dff, depthTest: false, depthWrite: false });
  const ikMaterial = new MeshBasicMaterial({ color: 0xffc857, depthTest: false, depthWrite: false });
  const hipMaterial = new MeshBasicMaterial({ color: 0xff8c62, depthTest: false, depthWrite: false });

  for (const limb of LIMBS) {
    const object = createProxyGroup(`ik-target-${limb.targetName}`);
    const marker = createHandleMesh(0.038, ikMaterial);
    object.add(marker);
    object.visible = false;
    ctx.scene.add(object);
    ctx.picking.register(object, { kind: 'bone', name: `${IK_PREFIX}${limb.targetName}` });
    targetProxies.set(limb.targetName, { object, limb });
  }
  const hipMarker = createHandleMesh(0.045, hipMaterial);
  hipProxy.add(hipMarker);
  ctx.picking.register(hipProxy, { kind: 'bone', name: `${IK_PREFIX}Hip` });

  const subjectPanel = ctx.ui.addPanel({ id: 'pose', title: 'Pose', order: 120, collapsed: true });
  const positionX = numberField({
    label: 'Position X', unit: 'm', min: -10, max: 10, step: 0.01, precision: 2,
    get: () => ctx.store.doc.subject.position[0],
    set: (value) => ctx.store.update((doc) => { doc.subject.position[0] = value; doc.subject.position[1] = 0; }, { label: 'subject position X' }),
  });
  const positionZ = numberField({
    label: 'Position Z', unit: 'm', min: -10, max: 10, step: 0.01, precision: 2,
    get: () => ctx.store.doc.subject.position[2],
    set: (value) => ctx.store.update((doc) => { doc.subject.position[2] = value; doc.subject.position[1] = 0; }, { label: 'subject position Z' }),
  });
  const facing = makeRangeControl(
    'Facing', -180, 180, 1, () => ctx.store.doc.subject.yawDeg,
    (value) => ctx.subject.anchor.rotation.set(0, value * DEG2RAD, 0),
    (value) => ctx.store.update((doc) => { doc.subject.yawDeg = value; }, { label: 'subject facing' }),
    (value) => `${Math.round(value)}°`,
  );
  const subjectControls: Control[] = [positionX, positionZ, facing];
  subjectPanel.replaceChildren(group('Subject', subjectControls));

  const poseToggle = checkbox({
    label: 'Pose mode',
    get: () => poseMode,
    set: (value) => {
      poseMode = value;
      activeLimbDrag = null;
      activeHipDrag = null;
      updateHandleVisibility();
      updateSelectionGizmo();
    },
  });
  const swingToggle = checkbox({
    label: 'Show hair & swing handles',
    get: () => showSwing,
    set: (value) => { showSwing = value; updateHandleVisibility(); },
  });
  const plantedToggle = checkbox({
    label: 'Feet stay planted',
    get: () => feetStayPlanted,
    set: (value) => { feetStayPlanted = value; },
  });
  const poseOptions = el('div', { class: 'pose-options' }, [poseToggle.element, swingToggle.element, plantedToggle.element]);
  subjectPanel.append(poseOptions);

  const presetButtons = buttonRow([], 2);
  for (const preset of POSE_PRESETS) {
    presetButtons.append(button(preset.name, () => {
      ctx.store.update((doc) => {
        doc.subject.pose.bones = structuredClone(preset.bones);
        doc.subject.pose.rootOffset = [...preset.rootOffset];
      }, { label: `pose preset ${preset.name}` });
    }));
  }
  subjectPanel.append(group('Pose presets', [presetButtons]));

  const poseActions = buttonRow([
    button('Mirror pose', () => {
      ctx.store.update((doc) => {
        doc.subject.pose.bones = mirrorPoseOffsets(doc.subject.pose.bones);
        const [x, y, z] = doc.subject.pose.rootOffset;
        doc.subject.pose.rootOffset = [-x, y, z];
      }, { label: 'mirror pose' });
    }),
    button('Copy left → right', () => copySide('L')),
    button('Copy right → left', () => copySide('R')),
    button('Reset pose', resetPose),
  ], 2);
  subjectPanel.append(group('Pose tools', [poseActions]));

  const boneSearch = el('input', { type: 'search', class: 'posing-search', placeholder: 'Search bones…', 'aria-label': 'Search bones' });
  const boneList = el('div', { class: 'posing-bone-list' });
  const selectedBoneControls = el('div', { class: 'posing-selected-bone' });
  const selectedRanges: Control[] = [];
  const boneSection = el('div', { class: 'posing-bone-section' }, [boneSearch, boneList, selectedBoneControls]);
  subjectPanel.append(group('Bones', [boneSection]));
  boneSearch.addEventListener('input', () => renderBoneList());

  const expressionPanel = ctx.ui.addPanel({ id: 'expressions', title: 'Expression', order: 125, collapsed: true });
  const expressionSearch = el('input', { type: 'search', class: 'posing-search', placeholder: 'Search expressions…', 'aria-label': 'Search expressions' });
  const expressionList = el('div', { class: 'posing-expression-list' });
  const expressionPresetButtons = buttonRow([], 2);
  const resetExpressionButton = button('Reset expression', () => {
    ctx.store.update((doc) => { doc.subject.morphs = {}; }, { label: 'reset expression' });
  });
  expressionPanel.append(group('Expression presets', [expressionPresetButtons, resetExpressionButton]));
  expressionPanel.append(group('Morphs', [expressionSearch, expressionList]));
  expressionSearch.addEventListener('input', () => filterExpressionList());

  const selectedBoneTitle = el('div', { class: 'posing-selected-title' });
  const storeControls = [...subjectControls];

  function copySide(sourceSide: 'L' | 'R'): void {
    const names = model?.bones.keys() ?? [];
    ctx.store.update((doc) => {
      doc.subject.pose.bones = copyPoseSide(doc.subject.pose.bones, sourceSide, names);
    }, { label: `copy pose ${sourceSide} to ${sourceSide === 'L' ? 'R' : 'L'}` });
  }

  function resetPose(): void {
    ctx.store.update((doc) => {
      doc.subject.pose.bones = {};
      doc.subject.pose.rootOffset = [0, 0, 0];
    }, { label: 'reset pose' });
  }

  function detachIfOwned(): void {
    const attached = ctx.gizmo.attached;
    if (attached === placeProxy || attached === hipProxy || [...targetProxies.values()].some((p) => p.object === attached) ||
      (attached instanceof Bone && ownedBoneTargets.has(attached))) {
      ctx.gizmo.detach();
      activeLimbDrag = null;
      activeHipDrag = null;
    }
  }

  function updateSelectionGizmo(): void {
    const selected = ctx.selection.current;
    if (!selected) { detachIfOwned(); return; }
    if (selected.kind === 'subject') {
      detachIfOwned();
      syncPlacementProxy();
      ctx.gizmo.attach(placeProxy, {
        mode: 'translate',
        space: 'world',
        onChange: (object) => {
          object.position.y = 0;
          ctx.subject.anchor.position.copy(object.position);
          ctx.subject.anchor.position.y = 0;
        },
        onCommit: (object) => {
          const [x, , z] = object.position.toArray();
          ctx.store.update((doc) => { doc.subject.position = [x, 0, z]; }, { label: 'move subject' });
        },
      });
      return;
    }
    if (selected.kind !== 'bone') { detachIfOwned(); return; }
    if (!poseMode || !model) { detachIfOwned(); return; }

    if (selected.name === `${IK_PREFIX}Hip`) {
      const hip = rootBone;
      if (!hip) { detachIfOwned(); return; }
      beginHipDrag();
      ctx.gizmo.attach(hipProxy, {
        mode: 'translate',
        space: 'world',
        onChange: () => previewHipMove(),
        onCommit: () => commitHipMove(),
      });
      return;
    }

    const targetProxy = targetProxies.get(selected.name.startsWith(IK_PREFIX) ? selected.name.slice(IK_PREFIX.length) : '');
    if (targetProxy) {
      beginLimbDrag(targetProxy.limb);
      ctx.gizmo.attach(targetProxy.object, {
        mode: 'translate',
        space: 'world',
        onChange: () => previewLimbTarget(targetProxy),
        onCommit: () => commitLimbTarget(targetProxy.limb),
      });
      return;
    }

    const bone = model.bones.get(selected.name);
    if (!bone) { detachIfOwned(); return; }
    activeLimbDrag = null;
    activeHipDrag = null;
    ownedBoneTargets.add(bone);
    ctx.gizmo.attach(bone, {
      mode: 'rotate',
      space: 'local',
      onCommit: (object) => {
        if (object !== bone || !model) return;
        const rest = model.restRotations.get(selected.name) ?? new Quaternion();
        const offset = quaternionToOffset(rest, bone.quaternion);
        ctx.store.update((doc) => { doc.subject.pose.bones[selected.name] = offset; }, { label: `pose bone ${selected.name}` });
      },
    });
  }

  function syncPlacementProxy(): void {
    if (ctx.gizmo.attached === placeProxy && ctx.gizmo.dragging) return;
    placeProxy.position.copy(ctx.subject.anchor.position);
    placeProxy.position.y = 0;
    placeProxy.rotation.set(0, 0, 0);
    placeProxy.updateMatrixWorld(true);
  }

  function beginLimbDrag(limb: LimbDefinition): void {
    if (!model) return;
    const upper = model.bones.get(limb.upperName);
    const lower = model.bones.get(limb.lowerName);
    const end = model.bones.get(limb.endName);
    if (!upper || !lower || !end) { activeLimbDrag = null; return; }
    model.root.updateMatrixWorld(true);
    const poleWorld = naturalPoleDirection(limb, upper, lower, end);
    const endOrientation = end.getWorldQuaternion(new Quaternion());
    const proxy = targetProxies.get(limb.targetName)?.object;
    end.getWorldPosition(proxy ? proxy.position : new Vector3());
    proxy?.updateMatrixWorld(true);
    activeLimbDrag = { limb, poleWorld, endWorldOrientation: endOrientation };
  }

  function previewLimbTarget(proxy: TargetProxy): void {
    if (!activeLimbDrag || activeLimbDrag.limb.targetName !== proxy.limb.targetName) beginLimbDrag(proxy.limb);
    if (!activeLimbDrag) return;
    const target = proxy.object.getWorldPosition(new Vector3());
    solveLimb(activeLimbDrag, target);
  }

  function commitLimbTarget(limb: LimbDefinition): void {
    if (!model) { activeLimbDrag = null; return; }
    const names = [limb.upperName, limb.lowerName, limb.endName];
    ctx.store.update((doc) => writeBoneOffsets(doc.subject.pose, model!, names), { label: `IK ${limb.kind} ${limb.side}` });
    activeLimbDrag = null;
    refreshTargetProxies();
  }

  function beginHipDrag(): void {
    if (!model || !rootBone) { activeHipDrag = null; return; }
    model.root.updateMatrixWorld(true);
    const hipWorld = rootBone.getWorldPosition(new Vector3());
    const startHipInModel = model.root.worldToLocal(hipWorld.clone());
    const offset = [...ctx.store.doc.subject.pose.rootOffset] as Vec3;
    const plants = feetStayPlanted ? LIMBS.filter((limb) => limb.kind === 'leg').flatMap((limb) => {
      const state = captureFootPlant(limb);
      return state ? [state] : [];
    }) : [];
    hipProxy.position.copy(hipWorld);
    hipProxy.updateMatrixWorld(true);
    activeHipDrag = { startOffset: offset, startHipInModel, plants, latestOffset: [...offset] };
  }

  function previewHipMove(): void {
    if (!model || !activeHipDrag) return;
    model.root.updateMatrixWorld(true);
    const desired = model.root.worldToLocal(hipProxy.position.clone());
    const delta = desired.sub(activeHipDrag.startHipInModel);
    const next: Vec3 = [
      activeHipDrag.startOffset[0] + delta.x,
      activeHipDrag.startOffset[1] + delta.y,
      activeHipDrag.startOffset[2] + delta.z,
    ];
    activeHipDrag.latestOffset = next;
    applyRootOffset(model, rootBone, basePositions, next);
    model.root.updateMatrixWorld(true);
    for (const plant of activeHipDrag.plants) solveLimb(plant, plant.target);
  }

  function commitHipMove(): void {
    if (!model || !activeHipDrag) { activeHipDrag = null; return; }
    const drag = activeHipDrag;
    ctx.store.update((doc) => {
      doc.subject.pose.rootOffset = [...drag.latestOffset];
      for (const plant of drag.plants) {
        writeBoneOffsets(doc.subject.pose, model!, [plant.limb.upperName, plant.limb.lowerName, plant.limb.endName]);
      }
    }, { label: 'move hips' });
    activeHipDrag = null;
    refreshTargetProxies();
  }

  function captureFootPlant(limb: LimbDefinition): FootPlant | null {
    if (!model) return null;
    const upper = model.bones.get(limb.upperName);
    const lower = model.bones.get(limb.lowerName);
    const end = model.bones.get(limb.endName);
    if (!upper || !lower || !end) return null;
    model.root.updateMatrixWorld(true);
    return {
      limb,
      target: end.getWorldPosition(new Vector3()),
      poleWorld: naturalPoleDirection(limb, upper, lower, end),
      endWorldOrientation: end.getWorldQuaternion(new Quaternion()),
    };
  }

  function naturalPoleDirection(limb: LimbDefinition, upper: Bone, lower: Bone, end: Bone): Vector3 {
    const root = upper.getWorldPosition(new Vector3());
    const joint = lower.getWorldPosition(new Vector3());
    const endpoint = end.getWorldPosition(new Vector3());
    const axis = endpoint.sub(root);
    if (axis.lengthSq() > 1e-10) {
      axis.normalize();
      const existing = joint.sub(root).addScaledVector(axis, -joint.clone().sub(root).dot(axis));
      if (existing.lengthSq() > 1e-7) return existing.normalize();
    }

    // The source skeleton's limb segments are straight in the rest pose, so use an
    // anatomical pole in the model frame until a pose supplies a more useful bend plane.
    const local = limb.kind === 'arm' ? new Vector3(0, -0.3, -1) : new Vector3(0, 0, 1);
    return local.normalize().applyQuaternion(ctx.subject.anchor.getWorldQuaternion(new Quaternion())).normalize();
  }

  function solveLimb(drag: LimbDrag | FootPlant, target: Vector3): void {
    if (!model) return;
    const upper = model.bones.get(drag.limb.upperName);
    const lower = model.bones.get(drag.limb.lowerName);
    const end = model.bones.get(drag.limb.endName);
    if (!upper || !lower || !end) return;
    model.root.updateMatrixWorld(true);
    const rootPoint = upper.getWorldPosition(new Vector3());
    const jointPoint = lower.getWorldPosition(new Vector3());
    const endPoint = end.getWorldPosition(new Vector3());
    const firstLength = rootPoint.distanceTo(jointPoint);
    const secondLength = jointPoint.distanceTo(endPoint);
    if (firstLength < 1e-8 || secondLength < 1e-8) return;
    const result = solveTwoBoneIK(
      asPoint(rootPoint), asPoint(target), asPoint(jointPoint), firstLength, secondLength, asPoint(drag.poleWorld),
    );
    rotateBoneSegmentTo(upper, rootPoint, jointPoint, rootPoint, vector(result.joint));
    model.root.updateMatrixWorld(true);
    const currentJoint = lower.getWorldPosition(new Vector3());
    const currentEnd = end.getWorldPosition(new Vector3());
    rotateBoneSegmentTo(lower, currentJoint, currentEnd, vector(result.joint), vector(result.end));
    model.root.updateMatrixWorld(true);
    const parent = end.parent;
    if (parent) {
      const parentWorld = parent.getWorldQuaternion(new Quaternion());
      end.quaternion.copy(localQuaternionForWorldOrientation(parentWorld, drag.endWorldOrientation));
      model.root.updateMatrixWorld(true);
    }
  }

  function rotateBoneSegmentTo(bone: Bone, currentStart: Vector3, currentEnd: Vector3, desiredStart: Vector3, desiredEnd: Vector3): void {
    const currentDirection = currentEnd.clone().sub(currentStart);
    const desiredDirection = desiredEnd.clone().sub(desiredStart);
    if (currentDirection.lengthSq() < 1e-12 || desiredDirection.lengthSq() < 1e-12 || !bone.parent) return;
    currentDirection.normalize();
    desiredDirection.normalize();
    const currentWorld = bone.getWorldQuaternion(new Quaternion());
    const delta = new Quaternion().setFromUnitVectors(currentDirection, desiredDirection);
    const desiredWorld = delta.multiply(currentWorld);
    const parentWorld = bone.parent.getWorldQuaternion(new Quaternion());
    bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld).normalize());
  }

  function writeBoneOffsets(pose: PoseState, subjectModel: SubjectModel, names: readonly string[]): void {
    for (const name of names) {
      const bone = subjectModel.bones.get(name);
      if (!bone) continue;
      const rest = subjectModel.restRotations.get(name) ?? new Quaternion();
      pose.bones[name] = quaternionToOffset(rest, bone.quaternion);
    }
  }

  function applyPose(doc = ctx.store.doc): void {
    if (!model) return;
    for (const [name, bone] of model.bones) {
      const rest = model.restRotations.get(name) ?? new Quaternion();
      bone.quaternion.copy(offsetToQuaternion(rest, doc.subject.pose.bones[name] ?? [0, 0, 0]));
    }
    applyRootOffset(model, rootBone, basePositions, doc.subject.pose.rootOffset);
    for (const mesh of model.meshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const [name, index] of Object.entries(dictionary)) {
        influences[index] = clamp(doc.subject.morphs[name] ?? 0, 0, 1);
      }
    }
    model.root.updateMatrixWorld(true);
  }

  function applyRootOffset(subjectModel: SubjectModel, bone: Bone | null, bases: Map<string, Vector3>, offset: Vec3): void {
    if (!bone) return;
    const base = bases.get(bone.name);
    if (!base) return;
    subjectModel.root.updateMatrixWorld(true);
    const rootWorld = subjectModel.root.getWorldQuaternion(new Quaternion());
    const parentWorld = bone.parent?.getWorldQuaternion(new Quaternion()) ?? rootWorld.clone();
    const parentInModel = rootWorld.clone().invert().multiply(parentWorld).normalize();
    const localOffset = new Vector3(...offset).applyQuaternion(parentInModel.invert());
    bone.position.copy(base).add(localOffset);
  }

  function syncDocument(): void {
    applyPose();
    refreshTargetProxies();
    syncPlacementProxy();
    storeControls.forEach((control) => control.refresh());
    selectedRanges.forEach((control) => control.refresh());
    expressionControls.forEach((control) => control.refresh());
  }

  function refreshTargetProxies(): void {
    if (!model) return;
    model.root.updateMatrixWorld(true);
    for (const proxy of targetProxies.values()) {
      if (ctx.gizmo.attached === proxy.object && ctx.gizmo.dragging) continue;
      const end = model.bones.get(proxy.limb.endName);
      if (end) end.getWorldPosition(proxy.object.position);
      proxy.object.updateMatrixWorld(true);
    }
    if (rootBone && !(ctx.gizmo.attached === hipProxy && ctx.gizmo.dragging)) {
      rootBone.getWorldPosition(hipProxy.position);
      hipProxy.updateMatrixWorld(true);
    }
  }

  function rebuildBoneHandles(): void {
    clearBoneHandles();
    if (!model) { updateHandleVisibility(); return; }
    for (const [name, bone] of model.bones) {
      const swing = name.startsWith('Sp_') && !name.endsWith('_Handle');
      if (!swing && !isMainHandleBone(name)) continue;
      if (name === 'Hip') continue; // The hip's visible handle is the translate target below.
      const mesh = createHandleMesh(swing ? 0.014 : 0.024, swing ? swingMaterial : mainMaterial);
      bone.add(mesh);
      const unregister = ctx.picking.register(mesh, { kind: 'bone', name });
      helperHandles.push({ mesh, unregister, swing });
    }
    updateHandleVisibility();
  }

  function clearBoneHandles(): void {
    for (const handle of helperHandles) {
      handle.unregister();
      handle.mesh.removeFromParent();
    }
    helperHandles = [];
  }

  function updateHandleVisibility(): void {
    const setView = ctx.views.mode === 'set';
    const hasModel = model !== null;
    for (const handle of helperHandles) {
      handle.mesh.visible = poseMode && setView && hasModel && (!handle.swing || showSwing);
    }
    hipProxy.visible = poseMode && setView && hasModel && rootBone !== null;
    for (const proxy of targetProxies.values()) proxy.object.visible = poseMode && setView && hasModel && model!.bones.has(proxy.limb.endName);
  }

  function renderBoneList(): void {
    boneList.replaceChildren();
    if (!model) {
      boneList.append(el('div', { class: 'posing-empty-state' }, ['Load a model to pose her.']));
      renderSelectedBoneControls();
      return;
    }
    const filter = boneSearch.value.trim().toLowerCase();
    const entries = [...model.bones.keys()].filter((name) => !name.endsWith('_Handle') && name.toLowerCase().includes(filter));
    const categories = new Map<string, string[]>();
    for (const name of entries) {
      const category = boneCategory(name);
      const list = categories.get(category) ?? [];
      list.push(name);
      categories.set(category, list);
    }
    for (const title of BONE_GROUPS) {
      const names = categories.get(title);
      if (!names?.length) continue;
      names.sort((a, b) => a.localeCompare(b));
      const details = el('details', { class: 'posing-bone-group' });
      details.open = filter.length > 0 || ['Body', 'Head & neck', 'Left arm', 'Right arm'].includes(title);
      details.append(el('summary', {}, [`${title} · ${names.length}`]));
      const buttons = el('div', { class: 'posing-bone-options' });
      for (const name of names) {
        const selected = ctx.selection.current?.kind === 'bone' && ctx.selection.current.name === name;
        const item = button(name, () => ctx.selection.set({ kind: 'bone', name }));
        item.classList.add('pose-bone-option');
        if (selected) item.classList.add('selected');
        buttons.append(item);
      }
      details.append(buttons);
      boneList.append(details);
    }
    renderSelectedBoneControls();
  }

  function renderSelectedBoneControls(): void {
    selectedRanges.splice(0, selectedRanges.length);
    selectedBoneControls.replaceChildren();
    const selected = ctx.selection.current;
    if (!model) {
      selectedBoneControls.append(el('div', { class: 'posing-empty-state' }, ['Load a model to pose her.']));
      return;
    }
    if (selected?.kind !== 'bone' || selected.name.startsWith(IK_PREFIX) || !model.bones.has(selected.name)) {
      selectedBoneControls.append(el('div', { class: 'posing-empty-state' }, ['Select a bone in the list or on the model.']));
      return;
    }
    const name = selected.name;
    selectedBoneTitle.textContent = name;
    selectedBoneControls.append(selectedBoneTitle);
    for (const axis of AXES) {
      const index = AXIS_INDEX[axis];
      const control = makeRangeControl(
        axis, -180, 180, 1,
        () => ctx.store.doc.subject.pose.bones[name]?.[index] ?? 0,
        (value) => {
          const bone = model?.bones.get(name);
          if (!bone || !model) return;
          const offset = [...(ctx.store.doc.subject.pose.bones[name] ?? [0, 0, 0])] as Vec3;
          offset[index] = value;
          bone.quaternion.copy(offsetToQuaternion(model.restRotations.get(name) ?? new Quaternion(), offset));
        },
        (value) => {
          const offset = [...(ctx.store.doc.subject.pose.bones[name] ?? [0, 0, 0])] as Vec3;
          offset[index] = value;
          ctx.store.update((doc) => { doc.subject.pose.bones[name] = offset; }, { label: `pose bone ${name}` });
        },
        (value) => `${Math.round(value)}°`,
      );
      selectedRanges.push(control);
      selectedBoneControls.append(control.element);
    }
    selectedBoneControls.append(buttonRow([
      button('Reset bone', () => ctx.store.update((doc) => { delete doc.subject.pose.bones[name]; }, { label: `reset bone ${name}` })),
      button('Reset pose', resetPose),
    ], 2));
    selectedRanges.forEach((control) => control.refresh());
  }

  function renderExpressions(): void {
    expressionList.replaceChildren();
    expressionPresetButtons.replaceChildren();
    expressionControls.splice(0, expressionControls.length);
    if (!model) {
      expressionPresetButtons.append(el('div', { class: 'posing-empty-state' }, ['Load a model to pose her.']));
      expressionList.append(el('div', { class: 'posing-empty-state' }, ['Load a model to pose her.']));
      return;
    }
    const names = model.morphNames;
    for (const preset of buildExpressionPresets(names)) {
      expressionPresetButtons.append(button(preset.name, () => {
        ctx.store.update((doc) => { doc.subject.morphs = { ...preset.weights }; }, { label: `expression preset ${preset.name}` });
      }));
    }
    const groups = new Map<string, Map<string, string[]>>();
    for (const name of names) {
      const prefix = name.split('_', 1)[0] || 'Other';
      const expression = name.match(/\(([^)]+)\)/)?.[1] ?? 'Other';
      const byExpression = groups.get(prefix) ?? new Map<string, string[]>();
      const list = byExpression.get(expression) ?? [];
      list.push(name);
      byExpression.set(expression, list);
      groups.set(prefix, byExpression);
    }
    const searchableRows: Array<{ row: HTMLElement; haystack: string; groups: HTMLDetailsElement[] }> = [];
    for (const prefix of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const outer = el('details', { class: 'posing-expression-group' });
      outer.append(el('summary', {}, [`${prefix} · ${[...groups.get(prefix)!.values()].reduce((n, list) => n + list.length, 0)}`]));
      const childGroups = groups.get(prefix)!;
      for (const expression of [...childGroups.keys()].sort((a, b) => a.localeCompare(b))) {
        const inner = el('details', { class: 'posing-expression-group' });
        inner.append(el('summary', {}, [`${expression} · ${childGroups.get(expression)!.length}`]));
        const rows = el('div', { class: 'posing-morph-rows' });
        for (const name of childGroups.get(expression)!) {
          const control = makeMorphControl(name);
          expressionControls.push(control);
          rows.append(control.element);
          searchableRows.push({ row: control.element, haystack: `${prefix} ${expression} ${name}`.toLowerCase(), groups: [outer, inner] });
        }
        inner.append(rows);
        outer.append(inner);
      }
      expressionList.append(outer);
    }
    expressionRows = searchableRows;
    filterExpressionList();
  }

  let expressionRows: Array<{ row: HTMLElement; haystack: string; groups: HTMLDetailsElement[] }> = [];
  const expressionControls: Control[] = [];

  function makeMorphControl(name: string): Control {
    return makeRangeControl(
      name, 0, 1, 0.01,
      () => ctx.store.doc.subject.morphs[name] ?? 0,
      (value) => setMorphRuntime(name, value),
      (value) => ctx.store.update((doc) => { doc.subject.morphs[name] = value; }, { label: `expression ${name}` }),
      (value) => value.toFixed(2),
      'pose-morph-row',
    );
  }

  function setMorphRuntime(name: string, value: number): void {
    if (!model) return;
    for (const mesh of model.meshes) {
      const index = mesh.morphTargetDictionary?.[name];
      if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = clamp(value, 0, 1);
    }
  }

  function filterExpressionList(): void {
    const query = expressionSearch.value.trim().toLowerCase();
    for (const entry of expressionRows) {
      const visible = !query || entry.haystack.includes(query);
      entry.row.hidden = !visible;
      if (visible && query) entry.groups.forEach((details) => { details.open = true; });
    }
    for (const details of expressionList.querySelectorAll('details')) {
      details.hidden = details.querySelector('.pose-morph-row:not([hidden])') === null;
    }
  }

  function makeRangeControl(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    preview: (value: number) => void,
    commit: (value: number) => void,
    format: (value: number) => string,
    rowClass = 'pose-range-row',
  ): Control {
    const input = el('input', { type: 'range', class: 'control-slider' });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const valueText = el('span', { class: 'control-readout' });
    const refresh = () => {
      if (document.activeElement === input) return;
      const value = clamp(get(), min, max);
      input.value = String(value);
      valueText.textContent = format(value);
    };
    input.addEventListener('input', () => {
      const value = clamp(input.valueAsNumber, min, max);
      valueText.textContent = format(value);
      preview(value);
    });
    input.addEventListener('change', () => {
      const value = clamp(input.valueAsNumber, min, max);
      if (Math.abs(value - get()) < 1e-9) return;
      commit(value);
    });
    refresh();
    const controlRow = el('label', { class: `control-row ${rowClass}`, title: label }, [
      el('span', { class: 'control-label' }, [label]), input, valueText,
    ]);
    return { element: controlRow, refresh };
  }

  function syncModel(next: SubjectModel | null): void {
    detachIfOwned();
    ownedBoneTargets.clear();
    activeLimbDrag = null;
    activeHipDrag = null;
    clearBoneHandles();
    model = next;
    basePositions = new Map();
    rootBone = null;
    if (model) {
      for (const [name, bone] of model.bones) basePositions.set(name, bone.position.clone());
      rootBone = model.bones.get('Hip') ?? model.bones.get('Position') ?? null;
      applyPose();
      rebuildBoneHandles();
      refreshTargetProxies();
    } else {
      updateHandleVisibility();
    }
    renderBoneList();
    renderExpressions();
    updateSelectionGizmo();
  }

  function onStoreChange(): void {
    syncDocument();
    if (ctx.selection.current?.kind === 'bone') renderSelectedBoneControls();
  }

  ctx.store.subscribe(onStoreChange);
  ctx.subject.onChange(syncModel);
  ctx.selection.onChange(() => {
    renderBoneList();
    updateSelectionGizmo();
    updateHandleVisibility();
  });
  ctx.views.onChange(() => {
    updateHandleVisibility();
    if (ctx.views.mode === 'set') refreshTargetProxies();
  });

  syncModel(ctx.subject.model);
  syncPlacementProxy();

  function asPoint(point: Vector3): Point3 {
    return [point.x, point.y, point.z];
  }

  function vector(point: Point3): Vector3 {
    return new Vector3(point[0], point[1], point[2]);
  }

  function createProxyGroup(name: string): Group {
    const group = new Group();
    group.name = name;
    group.userData.editorOnly = true;
    group.layers.set(LAYER_HELPERS);
    return group;
  }

  function createHandleMesh(size: number, material: MeshBasicMaterial): Mesh<SphereGeometry, MeshBasicMaterial> {
    const mesh = new Mesh(helperGeometry, material);
    mesh.scale.setScalar(size);
    mesh.userData.editorOnly = true;
    mesh.layers.set(LAYER_HELPERS);
    mesh.renderOrder = 1000;
    return mesh;
  }
}

const BONE_GROUPS = ['Body', 'Head & neck', 'Left arm', 'Right arm', 'Left hand', 'Right hand', 'Left leg', 'Right leg', 'Hair & accessories'];

function isMainHandleBone(name: string): boolean {
  if (name.endsWith('_Handle') || name.includes('_IK_')) return false;
  return /^(Position|Hip|Waist|Spine|Chest|Neck|Head|Shoulder_[LR]|Arm_[LR]|Elbow_[LR]|Thigh_[LR]|Knee_[LR])$/.test(name);
}

function boneCategory(name: string): string {
  if (name.startsWith('Sp_') || /^(Ear|Tail|Acc|Ribbon)/.test(name)) return 'Hair & accessories';
  const side = /(?:^|_)(L|R)$/.exec(name)?.[1] as 'L' | 'R' | undefined;
  if (side && /^(Thumb|Index|Middle|Ring|Pinky)_/.test(name)) return `${side === 'L' ? 'Left' : 'Right'} hand`;
  if (side && /^(Shoulder|Arm|Elbow|Wrist)/.test(name)) return `${side === 'L' ? 'Left' : 'Right'} arm`;
  if (side && /^(Thigh|Knee|Ankle|Toe)/.test(name)) return `${side === 'L' ? 'Left' : 'Right'} leg`;
  if (/^(Neck|Head|Eye)/.test(name)) return 'Head & neck';
  if (/^(Hip|Waist|Spine|Chest|Position|Body)/.test(name)) return 'Body';
  if (side) return `${side === 'L' ? 'Left' : 'Right'} hand`;
  return 'Hair & accessories';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function addPoseStyles(): void {
  if (document.getElementById('posing-styles')) return;
  const style = el('style', { id: 'posing-styles' });
  style.textContent = `
    .pose-options { display: grid; gap: 2px; }
    .posing-search { box-sizing: border-box; width: 100%; margin: 3px 0 7px; padding: 6px 8px; color: inherit; background: #171d27; border: 1px solid #394354; border-radius: 4px; }
    .posing-bone-list, .posing-expression-list { max-height: 260px; overflow: auto; }
    .posing-bone-group, .posing-expression-group { margin: 2px 0; }
    .posing-bone-group > summary, .posing-expression-group > summary { cursor: pointer; color: #c4cfde; font-size: 12px; padding: 3px 0; }
    .posing-bone-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 2px 0 6px; }
    .pose-bone-option { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; padding: 4px 6px; }
    .pose-bone-option.selected { border-color: var(--accent); color: #fff0d4; background: var(--accent-dim); }
    .posing-selected-bone { margin-top: 9px; }
    .posing-selected-title { margin-bottom: 4px; font-weight: 650; color: #e7eff8; }
    .pose-range-row { grid-template-columns: 100px minmax(0, 1fr) 40px; gap: 6px; }
    .pose-morph-row { grid-template-columns: 100px minmax(0, 1fr) 38px; gap: 5px; }
    .pose-morph-row .control-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .posing-empty-state { padding: 5px 2px; color: #a8b3c2; font-size: 12px; }
    .posing-expression-group .posing-expression-group { margin-left: 7px; }
    .posing-morph-rows { padding: 1px 0 5px 6px; }
  `;
  document.head.append(style);
}
