// Every feature, in install order. Each lives in its own folder and owns it; adding a
// feature means adding a line here.

import type { Feature } from '../core/context';
import * as loader from './loader';
import * as camera from './camera';
import * as lights from './lights';
import * as posing from './posing';
import * as shotmap from './shotmap';
import * as render from './render';
import * as persistence from './persistence';

export const FEATURES: readonly Feature[] = [loader, camera, lights, posing, shotmap, render, persistence];
