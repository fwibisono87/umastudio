# Research notes (2026-10-25)

## What UmaViewer exports contain

Three exports of Nice Nature (chara 1060) — the default racing outfit (`bdy1060_50`)
and two shared outfits (`bdy0005`, `bdy0009`) — inspected with `tools/pmxinfo.py`:

| | default | SF (`bdy0005`) | GOM (`bdy0009`) |
|---|---|---|---|
| Bones | 436 | 387 | 401 |
| Vertices / triangles | 15.6k / 30k | 10.5k / 22.8k | 10.3k / 23.4k |
| Weights | BDEF1 + BDEF2 only | same | same |
| Vertex morphs | 240 | 240 | 240 |
| IK bones | 0 | 0 | 0 |
| Rigid bodies / joints | 0 / 0 | 0 / 0 | 0 / 0 |

- PMX 2.0, written by UmaViewer 2.1.8.
- Skeleton is the game's Unity hierarchy with English names: `Position`, `Hip`, `Waist`,
  `Spine`, `Chest`, `Neck`, `Head`, `Thigh/Knee/Ankle/Toe_L/R`, face bones (cheeks,
  chin, eyelids), and swing bones `Sp_*` for skirt, ribbons, accessories, hair.
- Every vertex is weighted, so the mesh deforms correctly with the skeleton.
- Textures are referenced as `Texture2D/*.png` (22 per model) and must sit next to the
  `.pmx`.

## UmaViewer exporter behaviour

From `Assets/Scripts/Exporters/ModelExporter.cs`:

- Physics: always exports zero rigid bodies and joints; the game's own dynamic bones are
  disabled before export. No setting.
- IK: none generated; all bones are plain rotatable/movable bones.
- Bone names: a Unity → standard MMD Japanese mapping (`Spine` → `上半身`, `Thigh_L` →
  `左足`, …) plus MMD-standard morph names was added on master on 2026-07-18, **after**
  the latest release build (2026-07-02). Only a source build has it.

Conclusion: IK and physics, where wanted, are the app's job — which suits a posing tool
anyway (`CCDIKSolver` on known chains, hand-posed swing bones).

## How HoYoverse game models are usually obtained

1. **Official MMD releases.** HoYoverse publishes PMX models itself — 18 Zenless Zone
   Zero characters on bilibili at launch, reportedly also Genshin and Honkai Impact 3rd.
   Standard MMD rigs (Japanese names, physics, IK). Terms forbid redistribution, reuse of
   parts, adult content and commercial use.
   ([80.lv](https://80.lv/articles/grab-official-zenless-zone-zero-mmd-models-for-free/))
2. **AssetStudio forks** (HoYoStudio → [AnimeStudio](https://github.com/Escartem/AnimeStudio)).
   HoYoverse's asset bundles are encrypted/customised and the tools draw DMCA takedowns.
   Output is raw meshes, skeletons and textures (usually FBX) that need cleanup and
   shading in Blender.
3. **Frame capture via 3DMigoto / XXMI**
   ([GI-Model-Importer](https://github.com/SilentNightSound/GI-Model-Importer)). A
   modding tool; no usable rig, and ban risk on official servers.

Unlike all three, UmaViewer reads a local install and writes a finished rigged PMX in
one step. For future non-Uma support, official MMD models are the realistic route — hence
the bone-name mapping table in the loader.

## Coding models for 3D work

Available through OpenCode on the Xiaomi and Alibaba plans: MiMo-V2.6 Pro/Flash,
Qwen 3.6–3.8, GLM-5.x, Kimi K2.5–K2.7, DeepSeek V4, MiniMax M2.5.

- **MiMo-V2.6-Pro** — top open-weights model on the Artificial Analysis Intelligence
  Index (~46), 977 Elo / 12th on [AA-3D](https://artificialanalysis.ai/articles/aa-3d)
  (agents building three.js scenes with Blender and a headless browser, judged blind by
  people). Accepts image input. Best fit.
- **Kimi K3** scores slightly higher on AA-3D (982) but isn't on these plans (only K2.x).
- **Qwen3.8-Max** accepts images; no 3D-specific score found.
- **GLM-5.3** underperforms its general score on AA-3D by 197 Elo, the largest gap of any
  model.
- Open models remain far behind frontier models at 3D: on [3JSBench](https://3jsbench.com/)
  the best open model (Kimi K3) scores ~23% vs 78.7% for GPT-6 Astra.
