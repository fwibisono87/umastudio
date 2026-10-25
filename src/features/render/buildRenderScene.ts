import {
  BufferAttribute,
  BufferGeometry,
  LinearSRGBColorSpace,
  Material,
  Mesh,
  Object3D,
  Scene,
  Texture,
} from 'three';
import type { AppContext } from '../../core/context';
import { LAYER_SCENE } from '../../core/context';
import { flashSyncCoverage } from '../../scene/photometry';
import { StaticGeometryGenerator } from 'three-mesh-bvh';
import { ProceduralEquirectTexture, PhysicalCamera } from 'three-gpu-pathtracer';
import type { SceneDocument } from '../../scene/types';
import { createRenderEmitter } from './emitters';
import { isRenderSceneObject, preExposedAmbientRadiance } from './renderMath';

export interface RenderSceneSnapshot {
  scene: Scene;
  camera: PhysicalCamera;
  flashBandFraction: number;
  dispose(): void;
}

interface OwnedResources {
  geometries: Set<BufferGeometry>;
  materials: Set<Material>;
  textures: Set<Texture>;
  materialCopies: Map<Material, Material>;
  textureCopies: Map<Texture, Texture>;
}

/** Create an isolated, disposable render snapshot from the current live scene. */
export function buildRenderScene(ctx: AppContext, doc: SceneDocument): RenderSceneSnapshot {
  const scene = new Scene();
  scene.name = doc.meta.name;
  const owned: OwnedResources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    materialCopies: new Map(),
    textureCopies: new Map(),
  };

  const dispose = () => disposeOwned(owned);
  try {
    for (const child of ctx.scene.children) {
      if (child === ctx.subject.anchor) continue;
      cloneRenderTree(child, scene, owned);
    }

    bakeSubject(ctx.subject.anchor, scene, owned);

    for (const state of doc.lights) {
      if (!state.enabled) continue;
      const { light, target } = createRenderEmitter(state, doc.camera);
      light.layers.set(LAYER_SCENE);
      scene.add(light);
      if (target) {
        target.layers.set(LAYER_SCENE);
        scene.add(target);
      }
    }

    if (doc.environment.ambientLux > 0) {
      const radiance = preExposedAmbientRadiance(doc.environment.ambientLux, doc.camera);
      const environment = new ProceduralEquirectTexture(8, 4);
      environment.name = 'pre-exposed uniform studio ambient';
      environment.generationCallback = (_polar, _uv, _coord, color) => {
        color.setRGB(radiance, radiance, radiance, LinearSRGBColorSpace);
      };
      environment.update();
      scene.environment = environment;
      scene.environmentIntensity = 1;
      owned.textures.add(environment);
    }

    const camera = createPhysicalCamera(ctx, doc);
    scene.updateMatrixWorld(true);
    return {
      scene,
      camera,
      flashBandFraction: flashBandFraction(doc),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

function cloneRenderTree(source: Object3D, parent: Object3D, owned: OwnedResources): void {
  const objectWithLightFlag = source as Object3D & { isLight?: boolean };
  const include = isRenderSceneObject({
    layersMask: source.layers.mask,
    editorOnly: source.userData.editorOnly === true,
    isLight: objectWithLightFlag.isLight === true,
  });
  if (!include) return;

  const clone = source.clone(false);
  if (source instanceof Mesh && clone instanceof Mesh) {
    clone.geometry = source.geometry.clone();
    owned.geometries.add(clone.geometry);
    clone.material = cloneMaterial(source.material, owned);
  }
  parent.add(clone);

  for (const child of source.children) cloneRenderTree(child, clone, owned);
}

function cloneMaterial(source: Material | Material[], owned: OwnedResources): Material | Material[] {
  if (Array.isArray(source)) return source.map((material) => cloneOneMaterial(material, owned));
  return cloneOneMaterial(source, owned);
}

function cloneOneMaterial(source: Material, owned: OwnedResources): Material {
  const previous = owned.materialCopies.get(source);
  if (previous) return previous;

  const clone = source.clone();
  owned.materialCopies.set(source, clone);
  owned.materials.add(clone);
  const copyValues = clone as unknown as Record<string, unknown>;
  for (const key of Object.keys(clone)) {
    const texture = copyValues[key];
    if (!(texture instanceof Texture)) continue;
    let textureCopy = owned.textureCopies.get(texture);
    if (!textureCopy) {
      textureCopy = texture.clone();
      owned.textureCopies.set(texture, textureCopy);
      owned.textures.add(textureCopy);
    }
    copyValues[key] = textureCopy;
  }
  return clone;
}

/**
 * StaticGeometryGenerator evaluates the current morphs, bones and world transform. A
 * PMX mesh uses material groups, so bake each visible group to its own one-material mesh;
 * this preserves the original alpha/maps/materials while avoiding lost group indices.
 */
function bakeSubject(anchor: Object3D, scene: Scene, owned: OwnedResources): void {
  anchor.updateWorldMatrix(true, true);
  anchor.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return;
    for (const group of visibleMaterialGroups(object)) {
      const material = materialForGroup(object.material, group.materialIndex ?? 0);
      if (!material) continue;

      const proxyGeometry = makeGroupGeometry(object.geometry, group.start, group.count);
      const proxy = object.clone(false) as Mesh;
      proxy.geometry = proxyGeometry;
      proxy.material = cloneOneMaterial(material, owned);
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(object.matrixWorld);
      proxy.matrixWorld.copy(object.matrixWorld);
      proxy.updateMatrixWorld(true);

      try {
        const generator = new StaticGeometryGenerator(proxy);
        generator.applyWorldTransforms = true;
        const geometry = generator.generate();
        owned.geometries.add(geometry);
        const baked = new Mesh(geometry, proxy.material);
        baked.name = object.name;
        baked.castShadow = object.castShadow;
        baked.receiveShadow = object.receiveShadow;
        baked.layers.set(LAYER_SCENE);
        scene.add(baked);
      } finally {
        proxyGeometry.dispose();
      }
    }
  });
}

interface MaterialGroup {
  start: number;
  count: number;
  materialIndex?: number;
}

function visibleMaterialGroups(mesh: Mesh): MaterialGroup[] {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const geometry = mesh.geometry;
  const total = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
  const groups = Array.isArray(mesh.material) && geometry.groups.length > 0
    ? geometry.groups
    : [{ start: 0, count: total, materialIndex: 0 }];
  return groups.filter((group) => {
    const material = materials[group.materialIndex ?? 0];
    return material !== undefined && material.visible && group.count > 0;
  });
}

function materialForGroup(material: Material | Material[], index: number): Material | null {
  const result = Array.isArray(material) ? material[index] : material;
  return result?.visible ? result : null;
}

function makeGroupGeometry(source: BufferGeometry, start: number, count: number): BufferGeometry {
  const geometry = source.clone();
  const sourceIndex = source.index;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = sourceIndex ? sourceIndex.getX(start + i) : start + i;
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.clearGroups();
  return geometry;
}

function createPhysicalCamera(ctx: AppContext, doc: SceneDocument): PhysicalCamera {
  const camera = new PhysicalCamera();
  camera.copy(ctx.views.shotCamera);
  camera.filmGauge = doc.camera.body.sensorWidthMm;
  camera.aspect = doc.camera.body.sensorWidthMm / doc.camera.body.sensorHeightMm;
  camera.setFocalLength(doc.camera.lens.focalLengthMm);
  camera.fStop = doc.camera.aperture;
  camera.focusDistance = doc.camera.lens.focusDistanceM;
  camera.apertureBlades = doc.camera.lens.bladeCount;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  // PhysicalCamera.bokehSize = focalLength / fStop in mm. Its 0.0.27 camera shader
  // multiplies by 0.5 * 1e-3 to sample the aperture radius in scene metres, so the full
  // entrance pupil is exactly f / N (e.g. 85 mm at f/1.4 => 60.7 mm diameter).
  return camera;
}

function flashBandFraction(doc: SceneDocument): number {
  const hasStrobe = doc.lights.some((light) => light.enabled && light.output.kind === 'strobe');
  if (!hasStrobe || doc.camera.shutterS >= doc.camera.body.flashSyncS) return 0;
  return 1 - flashSyncCoverage(doc.camera.shutterS, doc.camera.body.flashSyncS);
}

function disposeOwned(owned: OwnedResources): void {
  owned.geometries.forEach((geometry) => geometry.dispose());
  owned.materials.forEach((material) => material.dispose());
  owned.textures.forEach((texture) => texture.dispose());
  owned.geometries.clear();
  owned.materials.clear();
  owned.textures.clear();
  owned.materialCopies.clear();
  owned.textureCopies.clear();
}
