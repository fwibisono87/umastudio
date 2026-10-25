import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { PhysicalSpotLight } from 'three-gpu-pathtracer';
import { createDefaultScene, createLight } from '../../scene/document';
import { cameraExposureScale } from '../../scene/photometry';
import { illuminanceAt } from '../../scene/lightModel';
import type { LightState } from '../../scene/types';
import { createRenderEmitter } from './emitters';
import {
  cameraBokehSizeMm,
  entrancePupilDiameterM,
  isRenderSceneObject,
  planEmitter,
  predictedIlluminance,
  renderResolution,
} from './renderMath';

describe('path-tracer emitter calibration', () => {
  const doc = createDefaultScene();
  const samples: { name: string; light: LightState; type: string }[] = [
    { name: 'rect area', light: createLight('rect', 'Rect', { modifierId: 'softbox-90x120' }), type: 'area' },
    { name: 'circular area', light: createLight('disc', 'Disc', { modifierId: 'umbrella-shoot-105' }), type: 'area' },
    { name: 'octagon equal-area rectangle', light: createLight('octa', 'Octa', { modifierId: 'octabox-90' }), type: 'area' },
    { name: 'directed spot', light: createLight('spot', 'Spot', { modifierId: 'reflector-std' }), type: 'spot' },
    {
      name: 'gridded diffuse spot approximation',
      light: createLight('grid', 'Grid', { modifierId: 'softbox-90x120', accessories: { gridDeg: 20, barnDoors: null } }),
      type: 'spot',
    },
    { name: 'bare point emitter', light: createLight('point', 'Bare', { modifierId: 'bare' }), type: 'point' },
  ];

  for (const { name, light, type } of samples) {
    it(`${name} reproduces illuminanceAt at 2 m and 4 m`, () => {
      const plan = planEmitter(light, doc.camera);
      expect(plan.kind).toBe(type);
      for (const distanceM of [2, 4]) {
        const axis = new Vector3(...light.target).sub(new Vector3(...light.position)).normalize();
        const point = new Vector3(...light.position).addScaledVector(axis, distanceM).toArray() as [number, number, number];
        expect(predictedIlluminance(plan, distanceM)).toBeCloseTo(illuminanceAt(light, point), 8);

        const exposure = cameraExposureScale(doc.camera) / (light.output.kind === 'strobe' ? doc.camera.shutterS : 1);
        const pathTracerLux = (plan.kind === 'area' ? plan.intensity * plan.areaM2 : plan.intensity) / (distanceM * distanceM);
        expect(pathTracerLux).toBeCloseTo(illuminanceAt(light, point) * exposure, 8);
      }
    });
  }

  it('aims area and spot light local -Z axes at the document target', () => {
    for (const light of [samples[0]!.light, samples[3]!.light]) {
      const emitter = createRenderEmitter(light, doc.camera).light;
      const emittedDirection = new Vector3(0, 0, -1).applyQuaternion(emitter.quaternion).normalize();
      const targetDirection = new Vector3(...light.target).sub(new Vector3(...light.position)).normalize();
      expect(emittedDirection.dot(targetDirection)).toBeCloseTo(1, 7);
    }
  });

  it('keeps a finite-radius spot emitter face on the document position', () => {
    const light = samples[4]!.light;
    const { light: emitter } = createRenderEmitter(light, doc.camera);
    expect(emitter).toBeInstanceOf(PhysicalSpotLight);
    if (!(emitter instanceof PhysicalSpotLight)) return;
    const awayFromTarget = new Vector3(...light.position).sub(new Vector3(...light.target)).normalize();
    const face = emitter.position.clone().addScaledVector(awayFromTarget, -(emitter.radius / Math.tan(emitter.angle)));
    expect(face.distanceTo(new Vector3(...light.position))).toBeCloseTo(0, 7);
  });
});

describe('physical camera conversion', () => {
  it('uses f/N as the physical entrance pupil and converts its diameter to scene metres', () => {
    expect(cameraBokehSizeMm(85, 1.4)).toBeCloseTo(60.7142857, 6);
    expect(entrancePupilDiameterM(85, 1.4)).toBeCloseTo(85 / 1.4 / 1000, 10);
    expect(entrancePupilDiameterM(85, 16)).toBeCloseTo(0.0053125, 10);
  });
});

describe('render output sizing', () => {
  it('uses the requested long edge and keeps the sensor aspect ratio', () => {
    expect(renderResolution(1200, 36, 24)).toEqual({ width: 1200, height: 800 });
    expect(renderResolution(2000, 24, 36)).toEqual({ width: 1333, height: 2000 });
    expect(renderResolution(3000, 44, 33)).toEqual({ width: 3000, height: 2250 });
  });
});

describe('render scene object filtering', () => {
  it('excludes editor helpers, non-scene layers, and every live light', () => {
    expect(isRenderSceneObject({ layersMask: 1, editorOnly: false, isLight: false })).toBe(true);
    expect(isRenderSceneObject({ layersMask: 2, editorOnly: false, isLight: false })).toBe(false);
    expect(isRenderSceneObject({ layersMask: 1, editorOnly: true, isLight: false })).toBe(false);
    expect(isRenderSceneObject({ layersMask: 1, editorOnly: false, isLight: true })).toBe(false);
    expect(isRenderSceneObject({ layersMask: 3, editorOnly: false, isLight: false })).toBe(true);
  });
});
