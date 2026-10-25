# Build plan

Work is planned and reviewed by Claude and implemented in lanes by coding agents, one git
worktree per lane, each lane landing as a reviewable branch. Every lane is checked with
the build/typecheck and in Chrome (screenshots, console, rendered state) before merging.

## Waves

| Wave | Lane | Size | Who |
|---|---|---|---|
| 0 | Scene document, units, project skeleton (Vite + TS + three) | S | Claude — every other lane builds on this contract |
| 1 | PMX/UmaViewer loader → physical materials, textures, alpha | M | Codex (GPT Luna) |
| 1 | Physical camera, exposure maths, live-view DoF | M | Codex (GPT Luna); exposure maths reviewed by hand |
| 2 | Lights: power units, power steps, modifier presets, placement | M–L | Codex |
| 2 | Posing: bone picker, FK gizmo, limb IK, presets, mirroring, expressions | M–L | Codex |
| 2 | Shot map: SVG diagram + settings table + export | S–M | MiMo-V2.6-Pro (self-contained) |
| 3 | HQ render via path tracer (skinned → static bake, physical camera, area lights) | M | Codex — riskiest lane |
| 3 | Scene save/load, UI cohesion pass | S–M | MiMo-V2.6-Pro |

Wave 1 lanes run in parallel, wave 2 lanes run in parallel. Rough total: ~8 lanes,
3–5 working sessions.

## Risks

1. **Exposure calibration.** Code that runs is not code that's right. "500 Ws in a 90 cm
   softbox at 2 m → f/8 at ISO 100" has to be checked against light-meter rules of
   thumb, then against a photographer's eye.
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
