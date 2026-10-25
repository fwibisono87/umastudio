import {
  Color,
  DoubleSide,
  FrontSide,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import type { Material, Texture } from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import type { PmxDocument, PmxMaterial } from './pmx';

export interface ModelFile {
  file: File;
  /** File path relative to the selected or dropped folder, with forward slashes. */
  path: string;
}

export interface LoadedMaterials {
  materials: Material[];
  missingTextures: string[];
  dispose(): void;
}

interface MaterialStyle {
  roughness: number;
  metalness: number;
  sheen: number;
  sheenRoughness: number;
  clearcoat: number;
}

const styles: Record<'skin' | 'hair' | 'cloth' | 'eyes' | 'metal', MaterialStyle> = {
  skin: { roughness: 0.52, metalness: 0, sheen: 0.2, sheenRoughness: 0.78, clearcoat: 0.02 },
  hair: { roughness: 0.4, metalness: 0, sheen: 0.12, sheenRoughness: 0.55, clearcoat: 0.04 },
  cloth: { roughness: 0.8, metalness: 0, sheen: 0.04, sheenRoughness: 0.85, clearcoat: 0 },
  eyes: { roughness: 0.2, metalness: 0, sheen: 0.05, sheenRoughness: 0.35, clearcoat: 0.65 },
  metal: { roughness: 0.28, metalness: 0.72, sheen: 0, sheenRoughness: 0.4, clearcoat: 0.12 },
};

/** Resolves PMX texture paths, decodes usable colour maps and creates physical materials. */
export async function loadPhysicalMaterials(
  pmx: PmxDocument,
  pmxPath: string,
  files: readonly ModelFile[],
): Promise<LoadedMaterials> {
  const fileIndex = new Map<string, ModelFile>();
  for (const entry of files) fileIndex.set(normalizePath(entry.path), entry);
  const pmxDirectory = normalizePath(pmxPath).split('/').slice(0, -1).join('/');
  const resolved = pmx.textures.map((path) => ({ path, file: resolveTexture(path, pmxDirectory, fileIndex) }));
  const missingTextures = resolved.filter((item) => !item.file).map((item) => item.path);
  const textures = new Map<File, Promise<Texture>>();
  const ownedTextures = new Set<Texture>();
  const objectUrls = new Set<string>();

  const loadTexture = (entry: ModelFile): Promise<Texture> => {
    let pending = textures.get(entry.file);
    if (!pending) {
      pending = (async () => {
        const url = URL.createObjectURL(entry.file);
        objectUrls.add(url);
        const loader = isTga(entry.path) ? new TGALoader() : new TextureLoader();
        const texture = await loader.loadAsync(url);
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        ownedTextures.add(texture);
        return texture;
      })();
      textures.set(entry.file, pending);
    }
    return pending;
  };

  const materials: MeshPhysicalMaterial[] = [];
  try {
    for (const material of pmx.materials) {
      const sourcePath = material.textureIndex >= 0 ? pmx.textures[material.textureIndex] : undefined;
      const colourPath = sourcePath ? diffuseSibling(sourcePath, pmx.textures, files, pmxDirectory, fileIndex) : undefined;
      const sourceFile = colourPath ? resolveTexture(colourPath, pmxDirectory, fileIndex) : undefined;
      let map: Texture | undefined;
      if (sourceFile) {
        try {
          map = await loadTexture(sourceFile);
        } catch {
          if (colourPath && !missingTextures.includes(colourPath)) missingTextures.push(colourPath);
        }
      } else if (colourPath && !missingTextures.includes(colourPath)) {
        missingTextures.push(colourPath);
      }
      materials.push(makeMaterial(material, map, sourcePath, colourPath));
    }
  } catch (error) {
    ownedTextures.forEach((texture) => texture.dispose());
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    materials.forEach((material) => material.dispose());
    throw error;
  }

  return {
    materials,
    missingTextures,
    dispose() {
      ownedTextures.forEach((texture) => texture.dispose());
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      materials.forEach((material) => material.dispose());
    },
  };
}

function makeMaterial(
  pmx: PmxMaterial,
  map: Texture | undefined,
  sourcePath: string | undefined,
  colourPath: string | undefined,
): MeshPhysicalMaterial {
  const diffuse = pmx.diffuse;
  const name = `${pmx.name} ${pmx.englishName} ${sourcePath ?? ''} ${colourPath ?? ''}`.toLowerCase();
  const category = classify(name);
  const style = styles[category];
  const alphaHint = /alpha0|eyehi|eye|lash|brow|mayu/.test(name);
  const transparent = diffuse[3] < 0.999 || (Boolean(map) && alphaHint);
  const overlay = /eyehi|lash|eyelash|brow|mayu/.test(name);
  const hasCutout = Boolean(map) && /alpha0|lash|eyelash|brow|mayu/.test(name);
  return new MeshPhysicalMaterial({
    color: new Color().setRGB(diffuse[0], diffuse[1], diffuse[2], LinearSRGBColorSpace),
    map,
    opacity: diffuse[3],
    transparent,
    alphaTest: hasCutout ? 0.08 : 0,
    depthWrite: !transparent,
    side: pmx.flags & 0x01 ? DoubleSide : FrontSide,
    roughness: style.roughness,
    metalness: style.metalness,
    sheen: style.sheen,
    sheenRoughness: style.sheenRoughness,
    clearcoat: style.clearcoat,
    polygonOffset: overlay,
    polygonOffsetFactor: overlay ? -1 : 0,
    polygonOffsetUnits: overlay ? -1 : 0,
  });
}

function classify(name: string): keyof typeof styles {
  if (/metal|gold|silver|chrome|buckle|hardware|accessory/.test(name)) return 'metal';
  if (/eye|iris|pupil|eyelash|lash|brow|mayu|eyehi/.test(name)) return 'eyes';
  if (/hair|kami|bang/.test(name)) return 'hair';
  if (/face|skin|body|\bbdy|cheek/.test(name)) return 'skin';
  return 'cloth';
}

function diffuseSibling(
  sourcePath: string,
  pmxPaths: readonly string[],
  files: readonly ModelFile[],
  pmxDirectory: string,
  fileIndex: ReadonlyMap<string, ModelFile>,
): string {
  if (!/(?:_base|_ctrl|_shad_c)(?=\.[^.]+$)/i.test(sourcePath)) return sourcePath;
  const replaced = sourcePath.replace(/(?:_base|_ctrl|_shad_c)(?=\.[^.]+$)/i, '_diff');
  if (resolveTexture(replaced, pmxDirectory, fileIndex)) return replaced;

  const sourceName = basename(sourcePath).toLowerCase();
  const root = sourceName.replace(/_(?:[a-z0-9]+_)?(?:base|ctrl|shad_c)(?=\.[^.]+$)/i, '');
  const candidates = [...pmxPaths, ...files.map((entry) => entry.path)];
  const sibling = candidates.find((candidate) => {
    const name = basename(candidate).toLowerCase();
    return name.startsWith(`${root}_`) && /_diff\.[^.]+$/i.test(name);
  });
  return sibling ?? replaced;
}

function resolveTexture(
  reference: string,
  pmxDirectory: string,
  fileIndex: ReadonlyMap<string, ModelFile>,
): ModelFile | undefined {
  const normalizedReference = normalizePath(reference);
  const relativePath = normalizePath(pmxDirectory ? `${pmxDirectory}/${normalizedReference}` : normalizedReference);
  const exact = fileIndex.get(relativePath);
  if (exact) return exact;
  const direct = fileIndex.get(normalizedReference);
  if (direct) return direct;
  const wantedName = normalizedReference.split('/').at(-1);
  if (!wantedName) return undefined;
  for (const [path, entry] of fileIndex) {
    if (path.split('/').at(-1) === wantedName) return entry;
  }
  return undefined;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').toLowerCase();
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1) ?? path;
}

function isTga(path: string): boolean {
  return /\.tga$/i.test(path);
}
