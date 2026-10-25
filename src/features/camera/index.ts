// Physical camera: sensor, lens, exposure, live-view depth of field, flash-sync band.
// Wave 0 placeholder: only aims the shot camera and sets its field of view.

import { Vector3 } from 'three';
import type { AppContext } from '../../core/context';
import type { SceneDocument } from '../../scene/types';
import { DEG2RAD } from '../../scene/units';

export function install(ctx: AppContext): void {
  const camera = ctx.views.shotCamera;
  const sync = (doc: SceneDocument) => {
    const c = doc.camera;
    camera.filmGauge = c.body.sensorWidthMm;
    camera.aspect = c.body.sensorWidthMm / c.body.sensorHeightMm;
    camera.setFocalLength(c.lens.focalLengthMm);
    camera.position.fromArray(c.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(new Vector3().fromArray(c.target));
    camera.rotateZ(-c.rollDeg * DEG2RAD);
    camera.updateProjectionMatrix();
  };
  sync(ctx.store.doc);
  ctx.store.subscribe(sync);
}
