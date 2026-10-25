# umastudio

A browser-based photo-studio simulator in the spirit of
[set.a.light 3D](https://www.elixxier.com/): load an Uma Musume character exported by
[UmaViewer](https://github.com/katboi01/UmaViewer), pose her, place a camera and studio
lights in 3D space, and produce both a lighting diagram ("shot map") and a high-quality
physically based render of the photo.

> Status: first full build. Loading, posing, lights, camera, shot map, HQ render and
> save/load all work. Textured materials are still untested; see
> [`docs/DESIGN.md`](docs/DESIGN.md) for the design and [`docs/PLAN.md`](docs/PLAN.md) for
> the build plan.

Try it at **https://fwibisono87.github.io/umastudio/**, which redeploys on every push to
`main`. Bring your own UmaViewer export: model files never leave your machine. To run it
locally:

```sh
pnpm install
pnpm dev        # http://localhost:5173
```

## Done means

The project is finished when all of these hold:

1. **Import** — UmaViewer PMX exports load with their textures. Arbitrary MMD models are
   not a goal (but the loader shouldn't make them impossible later).
2. **Camera** — shutter speed, ISO, sensor size, focal length and aperture are all
   settable and affect the image the way they would on a real camera.
3. **Placement** — camera and lights can be put anywhere in 3D space.
4. **Lights** — lights use real-world power ratings (Ws for strobes, W / lm for
   continuous) and common modifiers (softbox, octa, stripbox, umbrella, beauty dish,
   grid, snoot, barn doors, reflector, flag).
5. **Output** — the user can export a shot map and a high-quality render.

Added on top of the original list:

- **Posing.** A lighting tool whose subject is stuck in a T-pose isn't much use.
- **Realistic lighting, not toon shading.** The point is to see what light modifiers do;
  the game's cel shading would hide exactly that.

## Why the web

- Every hard piece already exists as a library: three.js for the scene,
  [`three-gpu-pathtracer`](https://github.com/gkjohnson/three-gpu-pathtracer) for the
  HQ render (physical camera with real depth of field and aperture blades, area lights,
  spot lights), `CCDIKSolver` for limb IK.
- No install and no disk cost — the dev machine is short on space, and a Blender-based
  pipeline would need a ~2 GB install.
- It can be tested end-to-end through Chrome DevTools.
- Runs fully locally: models are dropped into the page, nothing is uploaded anywhere.

## Model files are not in this repo

The character models and textures are © Cygames. This repository contains only code and
documentation; `*.pmx` files and `Texture2D/` folders are git-ignored. Bring your own
UmaViewer export.

## Tools

- [`tools/pmxinfo.py`](tools/pmxinfo.py) — dependency-free PMX 2.0 inspector (bones,
  weights, morphs, materials, textures, rigid bodies, joints). Used to establish what
  UmaViewer exports actually contain; see [`docs/RESEARCH.md`](docs/RESEARCH.md).

```sh
python3 tools/pmxinfo.py "path/to/model.pmx"
```

## License

MIT — see [`LICENSE`](LICENSE). In plain words: take it, fork it, sell it, just keep the
copyright notice. That file is the legal part; everything below is not.

```
/*
 * This is a simulator. Photons were not harmed, consulted, or accurately
 * modelled in the making of your render.
 *
 * I am not responsible for blown-out highlights, crushed shadows, a client
 * shoot that went sideways because the sim said f/8 and your strobe said
 * f/5.6, a melted GPU from leaving the path tracer running overnight, or
 * thermonuclear war because your alarm didn't go off while you were
 * dialling in a stripbox at 3 AM.
 *
 * The real light meter always wins. YOU are choosing to trust a browser tab
 * with your exposure, and if you point the finger at me for ruining your
 * shoot, I will laugh at you.
 */
```

Kode ini berbasis GSGSCICILTT. Belum tentu solusi terbaik, dan jelas bukan untuk
konsumsi Scopus. Harap menanggung sendiri segala risiko.

The character models remain © Cygames and are not covered by this license.
