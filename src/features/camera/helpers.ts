import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { LAYER_HELPERS, type AppContext, type EntityRef } from '../../core/context';
import { aimFromQuaternion, aimQuaternion, aimQuaternionForNegativeZ } from '../../scene/aim';
import type { SceneDocument, Vec3 } from '../../scene/types';

export interface CameraHelpers {
  readonly proxy: Object3D;
  sync(doc: SceneDocument): void;
}

export function createCameraHelpers(ctx: AppContext): CameraHelpers {
  const bodyGroup = new Group();
  bodyGroup.name = 'Editor camera body';
  const cameraBodyMaterial = new MeshStandardMaterial({ color: 0x292d32, roughness: 0.52, metalness: 0.35 });
  const lensMaterial = new MeshStandardMaterial({ color: 0x111315, roughness: 0.2, metalness: 0.45 });
  const glassMaterial = new MeshBasicMaterial({ color: 0x344554 });

  const shell = new Mesh(new BoxGeometry(0.16, 0.105, 0.065), cameraBodyMaterial);
  shell.position.z = -0.04;
  bodyGroup.add(shell);

  const lens = new Mesh(new CylinderGeometry(0.043, 0.037, 0.09, 24), lensMaterial);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.035;
  bodyGroup.add(lens);

  const frontGlass = new Mesh(new CylinderGeometry(0.034, 0.034, 0.003, 24), glassMaterial);
  frontGlass.rotation.x = Math.PI / 2;
  frontGlass.position.z = 0.082;
  bodyGroup.add(frontGlass);
  markEditorOnly(bodyGroup);
  ctx.scene.add(bodyGroup);
  ctx.picking.register(bodyGroup, { kind: 'camera' });

  const frustumMaterial = new LineBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.72 });
  const frustum = new LineSegments(new BufferGeometry(), frustumMaterial);
  frustum.name = 'Camera field of view';
  bodyGroup.add(frustum);
  markEditorOnly(frustum);

  const focusMaterial = new MeshBasicMaterial({
    color: 0xe8a33d,
    transparent: true,
    opacity: 0.075,
    side: DoubleSide,
    depthWrite: false,
  });
  const focusPlane = new Mesh(new PlaneGeometry(0.01, 0.01), focusMaterial);
  focusPlane.name = 'Camera focus plane';
  bodyGroup.add(focusPlane);
  markEditorOnly(focusPlane);

  const proxy = new Object3D();
  proxy.name = 'Camera translate proxy';
  proxy.visible = false;
  markEditorOnly(proxy);
  ctx.scene.add(proxy);

  const aimProxy = new Object3D();
  aimProxy.name = 'Camera aim proxy';
  aimProxy.visible = false;
  markEditorOnly(aimProxy);
  ctx.scene.add(aimProxy);
  const aimHandle = new Mesh(new SphereGeometry(0.05, 16, 12), new MeshBasicMaterial({ color: 0xe8a33d, depthTest: false, depthWrite: false }));
  aimHandle.name = 'Camera aim target handle';
  aimHandle.renderOrder = 1000;
  markEditorOnly(aimHandle);
  ctx.scene.add(aimHandle);
  const aimLine = new Line(
    new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
    new LineBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.72, depthTest: false, depthWrite: false }),
  );
  aimLine.name = 'Camera aim guide';
  aimLine.renderOrder = 999;
  aimLine.frustumCulled = false;
  markEditorOnly(aimLine);
  ctx.scene.add(aimLine);
  ctx.picking.register(aimHandle, { kind: 'aim', owner: { kind: 'camera' } });

  const shotCamera = ctx.views.shotCamera;
  let frustumSignature = '';

  const syncAim = (position: Vec3, target: Vec3) => {
    aimProxy.position.fromArray(target);
    aimHandle.position.fromArray(target);
    const positions = aimLine.geometry.getAttribute('position');
    positions.setXYZ(0, position[0], position[1], position[2]);
    positions.setXYZ(1, target[0], target[1], target[2]);
    positions.needsUpdate = true;
    aimLine.geometry.computeBoundingSphere();
    const selected = ctx.selection.current;
    const shown = ctx.views.mode === 'set'
      && (selected?.kind === 'camera' || (selected?.kind === 'aim' && selected.owner.kind === 'camera'));
    aimHandle.visible = shown;
    aimLine.visible = shown;
  };

  const applyPose = (position: Vec3, target: Vec3, rollDeg: number) => {
    const bodyOrientation = aimQuaternion(position, target, rollDeg);
    shotCamera.position.fromArray(position);
    shotCamera.quaternion.copy(aimQuaternionForNegativeZ(position, target, rollDeg));
    shotCamera.updateProjectionMatrix();
    shotCamera.updateMatrixWorld();

    bodyGroup.position.fromArray(position);
    bodyGroup.quaternion.copy(bodyOrientation);
    bodyGroup.visible = ctx.views.mode === 'set';
    if (!(ctx.gizmo.attached === proxy && ctx.gizmo.dragging && ctx.gizmo.toolMode === 'rotate')) {
      proxy.position.fromArray(position);
      proxy.quaternion.copy(bodyOrientation);
    }
    syncAim(position, target);
  };

  const sync = (doc: SceneDocument) => {
    const camera = doc.camera;
    shotCamera.filmGauge = camera.body.sensorWidthMm;
    shotCamera.aspect = camera.body.sensorWidthMm / camera.body.sensorHeightMm;
    shotCamera.setFocalLength(camera.lens.focalLengthMm);
    shotCamera.near = 0.05;
    shotCamera.far = 200;
    shotCamera.up.set(0, 1, 0);
    let position = camera.position;
    let target = camera.target;
    let rollDeg = camera.rollDeg;
    if (ctx.gizmo.dragging && ctx.gizmo.attached === proxy) {
      position = proxy.position.toArray() as Vec3;
      if (ctx.gizmo.toolMode === 'rotate') {
        const aimed = aimFromQuaternion(position, proxy.quaternion, distanceM(camera.position, camera.target));
        target = aimed.target;
        rollDeg = aimed.rollDeg;
      }
    } else if (ctx.gizmo.dragging && ctx.gizmo.attached === aimProxy) {
      target = aimProxy.position.toArray() as Vec3;
    }
    applyPose(position, target, rollDeg);

    const signature = [camera.body.sensorWidthMm, camera.body.sensorHeightMm, camera.lens.focalLengthMm, camera.lens.focusDistanceM].join(':');
    if (signature !== frustumSignature) {
      frustum.geometry.dispose();
      frustum.geometry = createFrustumGeometry(camera.body.sensorWidthMm, camera.body.sensorHeightMm, camera.lens.focalLengthMm, camera.lens.focusDistanceM);
      const planeWidth = (camera.lens.focusDistanceM * camera.body.sensorWidthMm) / camera.lens.focalLengthMm;
      const planeHeight = (camera.lens.focusDistanceM * camera.body.sensorHeightMm) / camera.lens.focalLengthMm;
      focusPlane.geometry.dispose();
      focusPlane.geometry = new PlaneGeometry(planeWidth, planeHeight);
      focusPlane.position.set(0, 0, camera.lens.focusDistanceM);
      frustumSignature = signature;
    }
  };

  ctx.views.onChange(() => {
    bodyGroup.visible = ctx.views.mode === 'set';
    const camera = ctx.store.doc.camera;
    syncAim(camera.position, camera.target);
  });

  const attachSelection = (ref: EntityRef | null) => {
    const cameraAimSelected = ref?.kind === 'aim' && ref.owner.kind === 'camera';
    if (cameraAimSelected) {
      aimProxy.position.fromArray(ctx.store.doc.camera.target);
      ctx.gizmo.attach(aimProxy, {
        mode: 'translate',
        onChange: (object) => {
          const camera = ctx.store.doc.camera;
          const target = object.position.toArray() as Vec3;
          applyPose(camera.position, target, camera.rollDeg);
        },
        onCommit: (object) => {
          const target = object.position.toArray() as Vec3;
          ctx.store.update((draft) => { draft.camera.target = target; }, { label: `aim camera drag ${cameraCommitSerial++}` });
        },
      });
      return;
    }
    if (ref?.kind === 'camera') {
      const mode = ctx.gizmo.toolMode;
      const camera = ctx.store.doc.camera;
      proxy.position.fromArray(camera.position);
      proxy.quaternion.copy(aimQuaternion(camera.position, camera.target, camera.rollDeg));
      ctx.gizmo.attach(proxy, {
        mode,
        space: mode === 'rotate' ? 'local' : 'world',
        onChange: (object) => {
          const current = ctx.store.doc.camera;
          const position = object.position.toArray() as Vec3;
          if (mode === 'rotate') {
            const aimed = aimFromQuaternion(position, object.quaternion, distanceM(current.position, current.target));
            applyPose(position, aimed.target, aimed.rollDeg);
          } else {
            applyPose(position, current.target, current.rollDeg);
          }
        },
        onCommit: (object) => {
          const position = object.position.toArray() as Vec3;
          ctx.store.update((draft) => {
            if (mode === 'rotate') {
              const aimed = aimFromQuaternion(position, object.quaternion, distanceM(draft.camera.position, draft.camera.target));
              draft.camera.target = aimed.target;
              draft.camera.rollDeg = aimed.rollDeg;
            } else {
              draft.camera.position = position;
            }
          }, { label: `${mode === 'rotate' ? 'rotate' : 'move'} camera drag ${cameraCommitSerial++}` });
        },
      });
      return;
    }
    if (ctx.gizmo.attached === proxy || ctx.gizmo.attached === aimProxy) ctx.gizmo.detach();
  };
  let cameraCommitSerial = 0;
  ctx.selection.onChange((ref) => {
    const camera = ctx.store.doc.camera;
    syncAim(camera.position, camera.target);
    attachSelection(ref);
  });
  ctx.gizmo.onToolModeChange(() => attachSelection(ctx.selection.current));

  return { proxy, sync };
}

function distanceM(position: Vec3, target: Vec3): number {
  return Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]);
}

function createFrustumGeometry(sensorWidthMm: number, sensorHeightMm: number, focalMm: number, depthM: number): BufferGeometry {
  const depth = Math.max(0.1, depthM);
  const halfWidth = (depth * sensorWidthMm) / (2 * Math.max(1, focalMm));
  const halfHeight = (depth * sensorHeightMm) / (2 * Math.max(1, focalMm));
  const corners = [
    [-halfWidth, -halfHeight, depth],
    [halfWidth, -halfHeight, depth],
    [halfWidth, halfHeight, depth],
    [-halfWidth, halfHeight, depth],
  ] as const;
  const origin = [0, 0, 0] as const;
  const vertices: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    vertices.push(...origin, ...corners[i]!);
    vertices.push(...corners[i]!, ...corners[(i + 1) % corners.length]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  return geometry;
}

function markEditorOnly(object: Object3D): void {
  object.traverse((child) => {
    child.layers.set(LAYER_HELPERS);
    child.userData.editorOnly = true;
  });
}
