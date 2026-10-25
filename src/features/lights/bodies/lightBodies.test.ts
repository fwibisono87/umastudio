import { Box3, Group, LineSegments, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MODIFIERS } from '../../../scene/modifiers';
import type { LightState } from '../../../scene/types';
import { buildLightBody, setLightBodySelected } from './lightBodies';
import { buildLightStand, planLightStand } from './stand';

function light(modifierId: string): LightState {
  return {
    id: `test-${modifierId}`,
    name: 'Test light',
    enabled: true,
    output: { kind: 'strobe', fullPowerWs: 500, powerStops: 0 },
    colorTempK: 5600,
    modifierId,
    position: [0, 1.8, 0],
    target: [0, 1, 2],
    rollDeg: 0,
    accessories: { gridDeg: null, barnDoors: null },
  };
}

function triangleCount(root: Group): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

describe('procedural light bodies', () => {
  it('builds every modifier with one correctly sized emitting face and a stand under budget', () => {
    for (const modifier of MODIFIERS) {
      const state = light(modifier.id);
      const body = new Group();
      buildLightBody(body, state);
      setLightBodySelected(body, state, true);
      body.updateMatrixWorld(true);

      const faces: Mesh[] = [];
      body.traverse((object) => {
        if (object instanceof Mesh && object.userData.lightFace === true) faces.push(object);
      });
      expect(faces, modifier.id).toHaveLength(1);
      const bounds = new Box3().setFromObject(faces[0]!);
      expect(bounds.getSize(new Vector3()).x, modifier.id).toBeCloseTo(modifier.widthM, 2);
      expect(bounds.getSize(new Vector3()).y, modifier.id).toBeCloseTo(modifier.heightM, 2);

      const stand = buildLightStand('stand');
      expect(triangleCount(body) + triangleCount(stand), modifier.id).toBeLessThanOrEqual(6000);
    }
  });

  it('adds a denser grid and barn leaves whose rotations track their closing angles', () => {
    const ungridded = new Group();
    buildLightBody(ungridded, light('octabox-90'));
    const gridded = new Group();
    buildLightBody(gridded, { ...light('octabox-90'), accessories: { gridDeg: 10, barnDoors: null } });
    const wideGrid = new Group();
    buildLightBody(wideGrid, { ...light('octabox-90'), accessories: { gridDeg: 40, barnDoors: null } });
    expect(gridded.children.some((child) => child.name === 'Honeycomb grid 10°')).toBe(true);
    const lineCount = (group: Group) => {
      const grid = group.children.find((child) => child.name.startsWith('Honeycomb grid'));
      return grid instanceof LineSegments ? grid.geometry.getAttribute('position').count : 0;
    };
    expect(lineCount(gridded)).toBeGreaterThan(lineCount(wideGrid));

    const doors = new Group();
    buildLightBody(doors, {
      ...light('reflector-std'),
      accessories: { gridDeg: null, barnDoors: { top: 25, bottom: 10, left: 35, right: 45 } },
    });
    const top = doors.getObjectByName('Barn door top') as Mesh;
    const right = doors.getObjectByName('Barn door right') as Mesh;
    expect(top.rotation.x).toBeCloseTo((-25 * Math.PI) / 180);
    expect(right.rotation.y).toBeCloseTo((-45 * Math.PI) / 180);
  });
});

describe('light stand planner', () => {
  it('keeps each stand variant on the floor', () => {
    for (const variant of ['stand', 'boom', 'floor'] as const) {
      const stand = buildLightStand(variant);
      stand.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(stand);
      expect(bounds.min.y, variant).toBeCloseTo(0, 3);
    }
  });

  it('selects boom and floor stands from aim and height', () => {
    const normal = planLightStand(new Vector3(0, 1.7, 0), new Vector3(0, 0, 1), 1.8);
    expect(normal.variant).toBe('stand');

    const overhead = planLightStand(new Vector3(0, 2.1, 0), new Vector3(0, -0.95, 0.3), 2.2);
    expect(overhead.variant).toBe('boom');
    expect(overhead.basePosition.z).toBeLessThan(-1);

    const high = planLightStand(new Vector3(0, 2.5, 0), new Vector3(0, 0, 1), 2.6);
    expect(high.variant).toBe('boom');

    const low = planLightStand(new Vector3(0, 0.24, 0), new Vector3(0, 0, 1), 0.3);
    expect(low.variant).toBe('floor');
  });
});
