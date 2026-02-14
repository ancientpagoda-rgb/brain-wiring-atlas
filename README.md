# Brain Wiring Atlas

A free-explore, art-forward 3D brain "wiring diagram".

- **GitHub Pages** hosts the lightweight web app.
- **GitHub Releases** hosts heavy **data packs** (anatomy meshes, tract bundles, network overlays) so the site stays fast.

## Local dev

```bash
npm install
npm run dev
```

## Deploy
Push to `main`. GitHub Actions deploys to Pages.

Expected URL:
- `https://ancientpagoda-rgb.github.io/brain-wiring-atlas/`

## Data packs (Releases)
The app will fetch a `manifest.json` from:

```
https://github.com/ancientpagoda-rgb/brain-wiring-atlas/releases/download/<tag>/manifest.json
```

The manifest describes URLs for anatomy + bundles.

## Status
Currently includes placeholder geometry + hover labels.
Next step: generate a real canonical hemisphere cutaway mesh + tractography-derived bundles and publish as a Release.
