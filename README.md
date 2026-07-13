# Brain Wiring Atlas

A free-explore, art-forward 3D brain wiring atlas.

- **GitHub Pages** hosts the lightweight web app.
- **Local public data packs** host the browser-ready anatomy meshes, tract bundles, and wiring centerlines.
- **GitHub Releases** can mirror heavy data packs for distribution, but the live app uses `/public/packs/<tag>/` to avoid GitHub release CORS issues.

## Local dev

```bash
npm install
npm run dev
```

## Deploy
Push to `main`. GitHub Actions deploys to Pages.

Expected URL:
- `https://ancientpagoda-rgb.github.io/brain-wiring-atlas/`

## Data packs
The app fetches a `manifest.json` from:

```
/brain-wiring-atlas/packs/<tag>/manifest.json
```

The manifest describes URLs for anatomy + bundle assets.

## Status
Current default pack: `v0.9`.

- Full-brain left/right anatomy surface and 20 bilateral structural tract bundles.
- Structural surfaces and wiring centerlines are derived from `MASILab/Pandora-WhiteMatterAtlas`, licensed CC-BY-4.0.
- Upstream Pandora repository latest commit checked: `2caf442` from 2020-11-18; GitHub metadata updated 2026-01-16.
- Functional network and dopamine overlays are schematic MNI-space reference overlays, not subject-specific measured connectivity.

## Accuracy Notes
This is an atlas visualization, not a diagnostic or patient-specific reconstruction. Structural bundle geometry is atlas-derived and suitable for orientation, comparison, and storytelling. Functional and neurochemistry layers are deliberately labeled schematic because they are canonical reference overlays rather than live measurements.
