# Build plan

Work is planned and reviewed by Claude and implemented in lanes by coding agents, one git
worktree per lane, each lane landing as a reviewable branch. Every lane is checked with
the build/typecheck and in Chrome (screenshots, console, rendered state) before merging.

## Waves

| Wave | Lane | Size | Who |
|---|---|---|---|
| 0 | Scene document, units, photometry, project skeleton (Vite + TS + three) | S | Claude — every other lane builds on this contract. **Done.** |
| 1 | PMX/UmaViewer loader → physical materials, textures, alpha, bone map | M | Codex (GPT Luna). **Done**; normals recomputed from geometry by default (toon-edited normals flattened the key light) |
| 1 | Physical camera, exposure UI, live-view DoF, flash-sync band | M | Codex (GPT Luna); exposure maths reviewed by hand. **Done**; white balance added |
| 1 | Lights: power units, power steps, modifier presets, placement, props | M–L | Codex (GPT Luna). **Done**; area lights flipped to face their target |
| 1 | Shot map: SVG diagram + settings table + export | S–M | MiMo-V2.6-Pro (self-contained). **Done** |
| 2 | Posing: bone picker, FK gizmo, limb IK, presets, mirroring, expressions | M–L | Codex — needs the loader. **Done**; presets redone with a real-skeleton FK test |
| 2 | HQ render via path tracer (skinned → static bake, physical camera, area lights) | M | Codex — needs loader, camera, lights; riskiest lane. **Done** |
| 2 | Scene save/load, autosave | S | Codex. **Done** |
| 3 | UI cohesion pass over the integrated app | S | Claude + one lane. **Done** (work light, grouped toolbar, shortcuts) |

Wave 0 put everything the lanes share into `src/scene/` (document types, photometry,
modifier table) and `src/core/` (store, views, picking, gizmo), and gave every feature its
own folder, so lights and the shot map no longer depend on the loader or camera and moved
up to wave 1. Lanes within a wave run in parallel. Rough total: ~8 lanes.

## Status (2026-10-25)

Every wave is merged on `main`: 87 unit tests, typecheck and build all pass, and the app
was checked in headless Chrome. Open items:

- **Textures.** Untested: the test export has no `Texture2D/`, so materials fall back to
  flat colours.
- **Live vs render.** On the subject, the HQ render agrees with the meter to within about
  ¼ stop. The live preview's softbox (part area light, part spot) puts about ⅔ stop more
  light on the backdrop and the shadow side than the path tracer does. Trust the render
  and the meter.
- **Bundle size.** The main chunk is over 500 kB. Code-splitting the path tracer would fix
  it.

## Risks

1. **Exposure calibration.** Code that runs is not code that's right. The reference
   setups in `src/scene/photometry.ts` (500 Ws at 2 m, ISO 100: about f/11 in a ~90 cm
   softbox, about f/22 in a standard reflector) come from the incident-meter equation
   and xenon efficacy, and still need checking against a photographer's eye. (The
   earlier "softbox → f/8" target was about a stop low.)
2. **Path tracer + skinned meshes.** The posed mesh must be baked to static geometry and
   the converted materials must survive the hand-off. Most likely lane to need a retry.
3. **Look.** Agents can't see their output. Each wave ends with a human look at the
   result.

## Model choice for delegation

From [`RESEARCH.md`](RESEARCH.md): the frontier models lead every 3D benchmark by a wide
margin, so the hard lanes go to GPT Luna. Among the open models available through
OpenCode, MiMo-V2.6-Pro is the pick for the self-contained lanes: best open model on
the Artificial Analysis index, 12th on AA-3D (three.js scene building), and it accepts
images, so it can look at its own screenshots.
