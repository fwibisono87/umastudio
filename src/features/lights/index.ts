// Real power, modifier and placement model for the live studio lights.

import type { AppContext } from '../../core/context';
import { installLightsPanel } from './panel';
import { createLightRuntime } from './runtime';

export function install(ctx: AppContext): void {
  createLightRuntime(ctx);
  installLightsPanel(ctx);
}
