# Working in umastudio

Browser studio-lighting simulator: Vite + TypeScript + three.js, no backend, no framework.
Read `docs/DESIGN.md` for what is being built and why.

## Commands

```sh
pnpm typecheck   # tsc --noEmit, strict
pnpm test        # vitest, pure-logic tests in src/**/*.test.ts
pnpm build       # typecheck + production bundle (delete dist/ afterwards)
pnpm dev         # dev server on :5173
```

There is no network in agent sandboxes: use only the dependencies already in
`package.json` (three, three-gpu-pathtracer, three-mesh-bvh, xatlas-web). Do not run
`pnpm install`/`add`, and do not edit `package.json` or `pnpm-lock.yaml`.

## Layout and ownership

| Path | What | Who may edit |
|---|---|---|
| `src/scene/` | The scene document types, defaults, photometry, units, modifier table | Shared contract: change only where your task says so |
| `src/core/` | App context, store (undo), views, frame loop, picking, gizmo, set and subject anchor | Core: don't edit unless your task says so |
| `src/ui/` | Page shell, form controls, styles | Core: don't edit unless your task says so |
| `src/features/<name>/` | One feature each, exporting `install(ctx)` | Only the feature your task names |
| `src/features/index.ts` | Feature list | Nobody needs to; every feature is already listed |

Rules that keep parallel work mergeable:

- **Features don't import each other.** Share through the scene document (`ctx.store`) or
  the `AppContext` (`src/core/context.ts`). Feature-local helpers live in the feature's
  folder, even if a similar helper exists in another feature.
- **All persistent state lives in the scene document** (`src/scene/types.ts`). Runtime-only
  state (three.js objects, selection, loaded model) does not.
- If you believe a core or contract file must change, make the smallest change possible and
  call it out explicitly in your final message.

## Conventions

- Units: metres, degrees, mm for lenses and sensors, seconds for shutter, Ws for strobes.
  Right-handed, Y up, floor at y = 0, subject at the origin facing +Z.
- **Light intensities are pre-exposed.** Every three.js light intensity is the physical
  value passed through `renderIntensityContinuous` / `renderIntensityStrobe`
  (`src/scene/photometry.ts`). `renderer.toneMappingExposure` stays 1. Read the header of
  that file before touching anything light- or exposure-related.
- Editor-only objects (gizmos, light bodies, handles, frustums) go on `LAYER_HELPERS` and get
  `userData.editorOnly = true`, so the shot camera and HQ render skip them.
- Changes to the document go through `ctx.store.update(recipe, { label })`; give drags and
  sliders a stable label so they undo as one step.
- UI uses the helpers in `src/ui/controls.ts` and panels from `ctx.ui.addPanel`, so it all
  looks alike. No UI frameworks.
- Match the surrounding code: small modules, comments that explain why, no dead code.
- `window.umastudio` exposes the AppContext in the browser, for debugging and automated checks.

## Never

- Commit `*.pmx`, `Texture2D/` or any other model files (© Cygames).
- Leave build artifacts (`dist/`, `node_modules/` changes, logs) in the tree.
- Push, or run `git config`.
