# Design

## Architecture

Single-page app, Vite + TypeScript + three.js, no backend. Two render paths share one
scene:

- **Live view** — rasterised, interactive. Physically based materials, the studio lights
  as three.js lights, a cheap depth-of-field post pass, transform gizmos for everything.
- **HQ render** — `three-gpu-pathtracer` over a static snapshot of the scene. The user
  clicks render and lets it converge.

All app state lives in one serialisable **scene document** (JSON). Every feature reads
and writes that document; nothing else is shared between features. This is what lets the
work be built in parallel lanes (see `PLAN.md`), and it doubles as the save format.

### Code map

- `src/scene/` — the contract: document types (`types.ts`), defaults and loading
  (`document.ts`), the photometric chain from Ws to pixels (`photometry.ts`), units and
  photographic scales (`units.ts`), the modifier table (`modifiers.ts`).
- `src/core/` — `AppContext` (`context.ts`), the store with undo (`store.ts`), renderer,
  views, picking and the shared gizmo (`app.ts`), the set and subject anchor (`studio.ts`).
- `src/ui/` — page shell and bound form controls.
- `src/features/<name>/` — one folder per feature, each exporting `install(ctx)`.

Rendering is **pre-exposed**: light intensities are multiplied by the camera's exposure
scale before they reach three.js, so the renderer's exposure stays at 1 and the path
tracer gets the same numbers. A correctly metered 18% grey card renders at 0.18; the
stand-in mannequin is exactly that grey.

### Units — fixed before anything else is written

| Quantity | Unit |
|---|---|
| Distance | metres (the PMX import is rescaled to match; MMD's native unit is ~8 cm) |
| Angles in the document | degrees |
| Focal length, sensor size | millimetres |
| Shutter | seconds |
| Strobe output | watt-seconds (Ws) at full power, plus a power step (1/1 … 1/128) |
| Continuous output | watts or lumens |

## Features and why

### 1. UmaViewer import

- Drop the whole export folder (`.pmx` + `Texture2D/`) onto the page so texture paths
  resolve.
- Port our own PMX parser (`tools/pmxinfo.py`, ~200 lines) to TypeScript rather than
  depending on three.js's `MMDLoader`, which newer three.js releases removed.
- Convert UmaViewer's toon materials to `MeshPhysicalMaterial` using the `_diff`
  textures; handle alpha materials (eye highlights, `*_Alpha0`).
- **Bone-name mapping table** from day one. UmaViewer's current release uses the game's
  English bone names (`Hip`, `Spine`, `Thigh_L`…); its unreleased master and official
  MMD models (e.g. HoYoverse's) use standard Japanese MMD names (`上半身`, `左足`…). A
  table keeps a second source cheap to add.

### 2. Physical camera

- Sensor size + focal length → field of view (three.js `filmGauge` / `setFocalLength`).
- Aperture → depth of field: approximate in live view, exact in the path tracer.
- Shutter + ISO + aperture → exposure value → renderer exposure.
- **Flash-sync behaviour is modelled deliberately**: a strobe's flash is far shorter than
  the shutter, so shutter speed changes only the ambient contribution, and only up to the
  sync speed (~1/200 s). That interplay is what a photographer uses a simulator like this
  to learn, so getting it right matters more than any visual polish.

### 3. Placement

Transform gizmos for camera and lights, plus typed values (distance, height, angle) for
precise setups. Optional "aim at subject" constraint.

Camera, light and prop aims share one orientation frame: local +Z points from position to
target, world +Y sets the upright reference, and positive roll turns clockwise when viewed
from behind along the aim (90° lays a stripbox horizontal). A selected object shows a
target handle and guide line; dragging the handle moves the aim point directly.

### 4. Lights and modifiers

- Power is converted to luminous output with a fixed efficacy assumption, calibrated so a
  known setup (e.g. 500 Ws at 2 m) meters near where it would on a real set.
- A modifier is data, not code: **emitter shape + size + beam angle + light loss**. A
  preset table covers softbox, octabox, stripbox, umbrella, beauty dish, reflector, grid,
  snoot, barn doors and flags; adding one is a table edit.

### 5. Posing

UmaViewer exports carry a full skeleton with every vertex weighted, but **no IK, no
physics** (both are hard-coded off in UmaViewer's exporter, with no setting to change
it). So the app provides them:

- Bone picker + rotation gizmo (FK) for everything.
- Limb IK via three.js `CCDIKSolver`, with chains defined from the known bone names —
  no IK data needed in the file.
- Hair, skirt, ribbons and tail are posed by hand through their swing bones (`Sp_*`).
  A "settle under gravity" helper is a possible later addition, not a goal.
- Pose presets and left/right mirroring.
- 240 facial morphs are already in the file (`EyeBrow_*`, `Eye_*`, `Mouth_*`, named
  after the game's expressions), exposed as an expression picker.

### 6. Shot map

Top-down SVG lighting diagram (subject, camera, each light with its modifier and beam),
plus a settings table: body, lens, exposure, and per light its power, modifier and
distance. Export as PNG / PDF.

### 7. HQ render

Bake the posed skinned mesh to static geometry (`StaticGeometryGenerator` from
three-mesh-bvh), hand it to the path tracer with a physical camera (f-stop, focus
distance, blade count) and the lights as area / spot lights. Export PNG.

## Non-goals

- Arbitrary MMD model support.
- MMD motion (`.vmd`) playback or animation.
- Writing IK or physics back into PMX files.
- Toon / game-accurate shading as the primary look (may come back as a live-view toggle).
