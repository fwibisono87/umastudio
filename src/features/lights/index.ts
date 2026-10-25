// Lights: power units, power steps, modifier presets, placement, props.
// Wave 0 placeholder: each enabled light is a bare point source at its rated output,
// just so the set isn't black.

import { PointLight } from 'three';
import type { AppContext } from '../../core/context';
import { renderIntensityStrobe, strobeLumenSeconds } from '../../scene/photometry';
import type { SceneDocument } from '../../scene/types';

export function install(ctx: AppContext): void {
  const lights: PointLight[] = [];
  const sync = (doc: SceneDocument) => {
    lights.forEach((l) => ctx.scene.remove(l));
    lights.length = 0;
    for (const light of doc.lights) {
      if (!light.enabled || light.output.kind !== 'strobe') continue;
      // Bare tube, isotropic: cd·s = lm·s / 4π.
      const cdS = strobeLumenSeconds(light.output) / (4 * Math.PI);
      const point = new PointLight(0xffffff, renderIntensityStrobe(cdS, doc.camera), 0, 2);
      point.position.fromArray(light.position);
      point.castShadow = true;
      ctx.scene.add(point);
      lights.push(point);
    }
  };
  sync(ctx.store.doc);
  ctx.store.subscribe(sync);
}
