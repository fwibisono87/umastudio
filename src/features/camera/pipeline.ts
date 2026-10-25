import {
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  NoToneMapping,
  NearestFilter,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  OrthographicCamera,
  PlaneGeometry,
  Mesh,
} from 'three';
import type { AppContext, RenderPipeline } from '../../core/context';
import { letterboxRect } from './cameraMath';

const frameBackground = 0x202124;
const maxBlurRadiusPx = 36;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform vec2 uTexelSize;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocalMm;
  uniform float uAperture;
  uniform float uFocusM;
  uniform float uSensorWidthMm;
  uniform float uFrameWidthPx;
  uniform float uDofEnabled;
  varying vec2 vUv;

  // three.js prepends the tone-mapping and colour-space functions to ShaderMaterials.

  float linearDepthM(float rawDepth) {
    return (uNear * uFar) / max(uFar - rawDepth * (uFar - uNear), 0.000001);
  }

  float cocRadiusPx(float depthM) {
    float focusMm = max(uFocusM * 1000.0, uFocalMm + 1.0);
    float depthMm = max(depthM * 1000.0, 0.001);
    float cocMm = (uFocalMm * uFocalMm / (uAperture * (focusMm - uFocalMm)))
      * abs(depthMm - focusMm) / depthMm;
    // The optical CoC is a diameter; a disc gather needs its radius.
    return min(0.5 * cocMm / uSensorWidthMm * uFrameWidthPx, ${maxBlurRadiusPx.toFixed(1)});
  }

  void main() {
    vec4 center = texture2D(uColor, vUv);
    float centerDepth = linearDepthM(texture2D(uDepth, vUv).x);
    float radius = uDofEnabled > 0.5 ? cocRadiusPx(centerDepth) : 0.0;
    vec3 colorSum = center.rgb;
    float weightSum = 1.0;

    // A compact golden-angle disc gather gives a soft bokeh approximation. Rejecting
    // nearer samples prevents foreground colour bleeding out as a bright halo.
    if (radius > 0.75) {
      const float GOLDEN_ANGLE = 2.39996323;
      for (int i = 0; i < 32; i++) {
        float fi = float(i) + 0.5;
        float radial = sqrt(fi / 32.0);
        float angle = fi * GOLDEN_ANGLE;
        vec2 pixelOffset = vec2(cos(angle), sin(angle)) * radius * radial;
        vec2 sampleUv = vUv + pixelOffset * uTexelSize;
        float sampleDepth = linearDepthM(texture2D(uDepth, sampleUv).x);
        if (sampleDepth + max(0.01, centerDepth * 0.0001) >= centerDepth) {
          colorSum += texture2D(uColor, sampleUv).rgb;
          weightSum += 1.0;
        }
      }
    }

    gl_FragColor = vec4(colorSum / weightSum, center.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Owns the offscreen target only while camera view is active. */
export interface CameraViewPass {
  render: RenderPipeline;
  resize(): void;
  dispose(): void;
}

export function createCameraViewPass(ctx: AppContext, dofEnabled: () => boolean): CameraViewPass {
  const passScene = new Scene();
  const passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: null },
      uDepth: { value: null },
      uTexelSize: { value: new Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 200 },
      uFocalMm: { value: 85 },
      uAperture: { value: 8 },
      uFocusM: { value: 3.5 },
      uSensorWidthMm: { value: 36 },
      uFrameWidthPx: { value: 1 },
      uDofEnabled: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  passScene.add(quad);

  let target: WebGLRenderTarget | null = null;
  let targetWidth = 0;
  let targetHeight = 0;

  const getFrameRect = () => {
    const doc = ctx.store.doc;
    const aspect = doc.camera.body.sensorWidthMm / doc.camera.body.sensorHeightMm;
    return letterboxRect(ctx.frame.size.width, ctx.frame.size.height, aspect);
  };

  const ensureTarget = (renderer: WebGLRenderer): WebGLRenderTarget => {
    const rect = getFrameRect();
    const ratio = renderer.getPixelRatio();
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (!target) {
      target = new WebGLRenderTarget(width, height, {
        format: RGBAFormat,
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        // MSAA, so the camera view is as smooth as the set view.
        samples: 4,
      });
      target.texture.colorSpace = NoColorSpace;
      target.depthTexture = new DepthTexture(width, height, UnsignedIntType);
      target.depthTexture.minFilter = NearestFilter;
      target.depthTexture.magFilter = NearestFilter;
      targetWidth = width;
      targetHeight = height;
    } else if (width !== targetWidth || height !== targetHeight) {
      target.setSize(width, height);
      targetWidth = width;
      targetHeight = height;
    }
    material.uniforms.uColor!.value = target.texture;
    material.uniforms.uDepth!.value = target.depthTexture;
    material.uniforms.uTexelSize!.value.set(1 / width, 1 / height);
    material.uniforms.uFrameWidthPx!.value = width;
    return target;
  };

  const render: RenderPipeline = (renderer, scene) => {
    const rect = getFrameRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const renderTarget = ensureTarget(renderer);
    const doc = ctx.store.doc;
    const shotCamera = ctx.views.shotCamera;
    const previousToneMapping = renderer.toneMapping;
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer.getClearColor(colorScratch);
    const previousClearAlpha = renderer.getClearAlpha();

    try {
      renderer.setRenderTarget(renderTarget);
      renderer.setViewport(0, 0, rect.width, rect.height);
      renderer.setScissorTest(false);
      renderer.toneMapping = NoToneMapping;
      renderer.autoClear = true;
      renderer.render(scene, shotCamera);

      material.uniforms.uNear!.value = shotCamera.near;
      material.uniforms.uFar!.value = shotCamera.far;
      material.uniforms.uFocalMm!.value = doc.camera.lens.focalLengthMm;
      material.uniforms.uAperture!.value = Math.max(0.1, doc.camera.aperture);
      material.uniforms.uFocusM!.value = doc.camera.lens.focusDistanceM;
      material.uniforms.uSensorWidthMm!.value = doc.camera.body.sensorWidthMm;
      material.uniforms.uDofEnabled!.value = dofEnabled() ? 1 : 0;

      // The output pass applies the renderer's normal tone mapping, so camera view matches set view.
      renderer.toneMapping = previousToneMapping;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, ctx.frame.size.width, ctx.frame.size.height);
      renderer.setClearColor(frameBackground, 1);
      renderer.clear(true, true, true);

      const bottom = ctx.frame.size.height - rect.y - rect.height;
      renderer.setViewport(rect.x, bottom, rect.width, rect.height);
      renderer.setScissor(rect.x, bottom, rect.width, rect.height);
      renderer.setScissorTest(true);
      renderer.render(passScene, passCamera);
    } finally {
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, ctx.frame.size.width, ctx.frame.size.height);
      renderer.setScissor(0, 0, ctx.frame.size.width, ctx.frame.size.height);
      renderer.setScissorTest(false);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.toneMapping = previousToneMapping;
      renderer.autoClear = previousAutoClear;
    }
  };

  const resize = () => {
    if (!target) return;
    ensureTarget(ctx.renderer);
  };

  const dispose = () => {
    target?.dispose();
    target = null;
    targetWidth = 0;
    targetHeight = 0;
    material.uniforms.uColor!.value = null;
    material.uniforms.uDepth!.value = null;
  };

  return { render, resize, dispose };
}

const colorScratch = new Color();
