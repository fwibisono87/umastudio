// Shading normals for realistic lighting.
//
// Uma Musume models ship with normals edited for cel shading: the face's normals are
// flattened toward the front so a toon shader paints it in one tone. Under real studio
// light that hides exactly what the app is for (a key light modelling cheekbones and a
// nose), so by default we replace them with normals computed from the geometry, welding
// vertices that share a position (PMX splits vertices at UV seams, and a plain per-vertex
// computation would show those seams as hard edges).

import type { BufferGeometry, Float32BufferAttribute } from 'three';

export type NormalsMode = 'geometric' | 'authored';

/** Area-weighted smooth normals, averaged across all vertices at the same position. */
export function weldedNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  const vertexCount = positions.length / 3;
  const keyOf = (i: number) =>
    `${positions[i * 3]!.toFixed(5)},${positions[i * 3 + 1]!.toFixed(5)},${positions[i * 3 + 2]!.toFixed(5)}`;
  const slotOf = new Int32Array(vertexCount);
  const slots = new Map<string, number>();
  for (let i = 0; i < vertexCount; i++) {
    const key = keyOf(i);
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = slots.size;
      slots.set(key, slot);
    }
    slotOf[i] = slot;
  }

  // Unnormalised cross products are proportional to triangle area, which weights big
  // faces more than slivers.
  const sums = new Float64Array(slots.size * 3);
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const a = indices[f]!, b = indices[f + 1]!, c = indices[f + 2]!;
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
    const ux = positions[b * 3]! - ax, uy = positions[b * 3 + 1]! - ay, uz = positions[b * 3 + 2]! - az;
    const vx = positions[c * 3]! - ax, vy = positions[c * 3 + 1]! - ay, vz = positions[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const s = slotOf[v]! * 3;
      sums[s] = sums[s]! + nx;
      sums[s + 1] = sums[s + 1]! + ny;
      sums[s + 2] = sums[s + 2]! + nz;
    }
  }

  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const s = slotOf[i]! * 3;
    const x = sums[s]!, y = sums[s + 1]!, z = sums[s + 2]!;
    const length = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / length;
    normals[i * 3 + 1] = y / length;
    normals[i * 3 + 2] = z / length;
  }
  return normals;
}

/** Switches a geometry between its authored and geometric normals (computed once, cached). */
export function applyNormalsMode(geometry: BufferGeometry, mode: NormalsMode): void {
  const attribute = geometry.getAttribute('normal') as Float32BufferAttribute;
  const data = geometry.userData as { authoredNormals?: Float32Array; geometricNormals?: Float32Array };
  data.authoredNormals ??= (attribute.array as Float32Array).slice();
  if (mode === 'geometric' && !data.geometricNormals) {
    const index = geometry.getIndex();
    if (!index) return;
    data.geometricNormals = weldedNormals(geometry.getAttribute('position').array, index.array);
  }
  (attribute.array as Float32Array).set(mode === 'geometric' ? data.geometricNormals! : data.authoredNormals);
  attribute.needsUpdate = true;
}
