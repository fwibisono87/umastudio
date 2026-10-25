import { createApp } from './core/app';
import { SceneStore } from './core/store';
import { FEATURES } from './features';
import { createDefaultScene } from './scene/document';
import { createShell } from './ui/shell';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const store = new SceneStore(createDefaultScene());
const ui = createShell(root);
const ctx = createApp(store, ui);
for (const feature of FEATURES) feature.install(ctx);

// For debugging and for automated checks through Chrome DevTools.
(window as unknown as { umastudio: typeof ctx }).umastudio = ctx;
