import { describe, expect, it } from 'vitest';
import { weldedNormals } from './normals';

describe('weldedNormals', () => {
  it('gives a flat quad split along a seam one shared upward normal', () => {
    // Two triangles in the XZ plane wound counter-clockwise seen from +Y; the diagonal's
    // vertices are duplicated, as PMX does at UV seams.
    const positions = [0, 0, 0, 0, 0, 1, 1, 0, 1, /* seam copies */ 0, 0, 0, 1, 0, 1, 1, 0, 0];
    const normals = weldedNormals(positions, [0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < 6; i++) {
      expect(normals[i * 3]).toBeCloseTo(0, 6);
      expect(normals[i * 3 + 1]).toBeCloseTo(1, 6);
      expect(normals[i * 3 + 2]).toBeCloseTo(0, 6);
    }
  });

  it('smooths across a crease shared by split vertices', () => {
    // A roof: two faces meeting at the ridge x = 0, with the ridge vertices duplicated.
    const positions = [-1, 0, 0, 0, 1, 1, 0, 1, 0, /* right face */ 0, 1, 0, 0, 1, 1, 1, 0, 0];
    const normals = weldedNormals(positions, [0, 1, 2, 3, 4, 5]);
    // Ridge vertices (2 and 3) are averaged to point straight up; the eaves keep their slope.
    expect(normals[2 * 3 + 1]).toBeCloseTo(1, 6);
    expect(normals[3 * 3 + 1]).toBeCloseTo(1, 6);
    expect(Math.abs(normals[0]!)).toBeGreaterThan(0.5);
  });
});
