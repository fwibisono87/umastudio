import { existsSync, readFileSync } from 'node:fs';
import { MeshPhysicalMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { loadPhysicalMaterials } from './materials';
import { parsePmx } from './pmx';

declare const process: { env: Record<string, string | undefined> };

const testPath = process.env.UMASTUDIO_TEST_PMX ?? '/home/francis/Downloads/1060_Nice Nature.pmx';

describe('loadPhysicalMaterials', () => {
  it.skipIf(!existsSync(testPath))('uses PMX diffuse colours and reports the export textures missing', async () => {
    const pmx = parsePmx(readFileSync(testPath));
    const loaded = await loadPhysicalMaterials(pmx, 'Nice Nature.pmx', []);

    expect(loaded.materials).toHaveLength(10);
    expect(loaded.missingTextures).toHaveLength(22);
    expect(loaded.materials.every((material) => material instanceof MeshPhysicalMaterial)).toBe(true);
    expect((loaded.materials[0] as MeshPhysicalMaterial).map).toBeNull();
    expect((loaded.materials[0] as MeshPhysicalMaterial).color.r).toBeCloseTo(pmx.materials[0]!.diffuse[0]);
    loaded.dispose();
  });
});
