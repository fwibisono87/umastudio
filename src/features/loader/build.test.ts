import { existsSync, readFileSync } from 'node:fs';
import { Box3, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildSubjectModel, convertPmxNormal, convertPmxPosition } from './build';
import { parsePmx } from './pmx';

declare const process: { env: Record<string, string | undefined> };

describe('PMX model conversion', () => {
  it('converts positions into metres and reflects the PMX forward axis', () => {
    expect(convertPmxPosition([2, 4, -6])).toEqual([0.16, 0.32, 0.48]);
    expect(convertPmxNormal([1, 2, 3])).toEqual([1, 2, -3]);
  });

  const testPath = process.env.UMASTUDIO_TEST_PMX ?? '/home/francis/Downloads/1060_Nice Nature.pmx';
  it.skipIf(!existsSync(testPath))('builds the sample at floor height facing +Z', () => {
    const pmx = parsePmx(readFileSync(testPath));
    const materials = pmx.materials.map(() => new MeshBasicMaterial());
    const model = buildSubjectModel(pmx, materials);
    model.root.updateMatrixWorld(true);

    const mesh = model.meshes[0]!;
    const positions = mesh.geometry.getAttribute('position');
    for (const vertexIndex of [0, 17, 1024, 8000, pmx.vertices.length - 1]) {
      const original = new Vector3().fromBufferAttribute(positions, vertexIndex);
      const skinned = mesh.applyBoneTransform(vertexIndex, original.clone());
      expect(skinned.distanceTo(original)).toBeLessThan(0.00001);
    }

    const bounds = new Box3().setFromObject(model.root);
    const height = bounds.max.y - bounds.min.y;
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.02);
    expect(height).toBeGreaterThanOrEqual(1.4);
    expect(height).toBeLessThanOrEqual(1.7);

    const head = model.bones.get('Head');
    const nose = model.bones.get('Nose');
    expect(head).toBeDefined();
    expect(nose).toBeDefined();
    expect(nose!.getWorldPosition(new Vector3()).z).toBeGreaterThan(head!.getWorldPosition(new Vector3()).z);
    expect(model.morphNames).toHaveLength(240);
    expect(mesh.morphTargetInfluences?.every((weight) => weight === 0)).toBe(true);

    mesh.geometry.dispose();
    mesh.skeleton.dispose();
    materials.forEach((material) => material.dispose());
  });
});
