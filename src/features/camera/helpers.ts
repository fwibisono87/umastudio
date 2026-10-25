import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { LAYER_HELPERS, type AppContext } from '../../core/context';
import type { SceneDocument, Vec3 } from '../../scene/types';
import { DEG2RAD } from '../../scene/units';

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

  const shotCamera = ctx.views.shotCamera;
  let frustumSignature = '';

  const sync = (doc: SceneDocument) => {
    const camera = doc.camera;
    const target = new Vector3().fromArray(camera.target);
    const position = new Vector3().fromArray(camera.position);

    shotCamera.filmGauge = camera.body.sensorWidthMm;
    shotCamera.aspect = camera.body.sensorWidthMm / camera.body.sensorHeightMm;
    shotCamera.setFocalLength(camera.lens.focalLengthMm);
    shotCamera.near = 0.05;
    shotCamera.far = 200;
    shotCamera.position.copy(position);
    shotCamera.up.set(0, 1, 0);
    shotCamera.lookAt(target);
    shotCamera.rotateZ(-camera.rollDeg * DEG2RAD);
    shotCamera.updateProjectionMatrix();
    shotCamera.updateMatrixWorld();

    bodyGroup.position.copy(position);
    bodyGroup.quaternion.identity();
    bodyGroup.lookAt(target);
    bodyGroup.rotateZ(-camera.rollDeg * DEG2RAD);
    bodyGroup.visible = ctx.views.mode === 'set';
    proxy.position.copy(position);

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

  ctx.views.onChange((mode) => {
    bodyGroup.visible = mode === 'set';
  });

  ctx.selection.onChange((ref) => {
    if (ref?.kind === 'camera') {
      proxy.position.fromArray(ctx.store.doc.camera.position);
      ctx.gizmo.attach(proxy, {
        mode: 'translate',
        onChange: (object) => {
          const position: Vec3 = [object.position.x, object.position.y, object.position.z];
          ctx.store.update((draft) => {
            draft.camera.position = position;
          }, { label: 'camera position' });
        },
      });
    } else if (ctx.gizmo.attached === proxy) {
      ctx.gizmo.detach();
    }
  });

  return { proxy, sync };
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
