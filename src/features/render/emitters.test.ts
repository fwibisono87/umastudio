import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { lightAimFrame } from '../../scene/lightModel';
import { createDefaultScene, createLight } from '../../scene/document';
import { lightBodyQuaternion } from '../lights/runtime';
import { createRenderEmitter } from './emitters';

function worldLongEdge(orientation: Quaternion): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(orientation).normalize();
}

describe('shared stripbox orientation across live, render, and meter paths', () => {
  it.each([0, 90])('agrees on the long edge for a side-aimed stripbox at roll %i°', (rollDeg) => {
    const position: [number, number, number] = [2, 1.6, 0.4];
    const target: [number, number, number] = [-1, 1.6, 0.4];
    const light = createLight('strip', 'Strip', { modifierId: 'stripbox-30x120', position, target, rollDeg });
    const liveDirection = worldLongEdge(lightBodyQuaternion(position, target, rollDeg));
    const render = createRenderEmitter(light, createDefaultScene().camera);
    const renderDirection = worldLongEdge(render.light.quaternion);
    const meterFrame = lightAimFrame(light);
    const meterDirection = new Vector3(...meterFrame.up).normalize();

    expect(liveDirection.distanceTo(renderDirection)).toBeLessThan(1e-8);
    expect(liveDirection.distanceTo(meterDirection)).toBeLessThan(1e-8);
    if (rollDeg === 0) expect(Math.abs(liveDirection.y)).toBeCloseTo(1, 8);
    else expect(Math.abs(liveDirection.y)).toBeLessThan(1e-8);

    const expectedForward = new Vector3(...target).sub(new Vector3(...position)).normalize();
    expect(new Vector3(0, 0, -1).applyQuaternion(render.light.quaternion).distanceTo(expectedForward)).toBeLessThan(1e-8);
  });
});
