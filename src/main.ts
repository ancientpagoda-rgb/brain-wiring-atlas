import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import GUI from 'lil-gui'

// GitHub Release tag hosting the current heavy data pack.
let DATA_TAG = 'v0.1-preview'

type Manifest = {
  version: string
  citation?: string
  notes?: string
  assets: {
    anatomy?: { url: string; name?: string }
    bundles?: Array<{ id: string; name: string; url: string; color?: string }>
  }
}

const RELEASE_OWNER = 'ancientpagoda-rgb'
const RELEASE_REPO = 'brain-wiring-atlas'

function makeReleaseUrl(tag: string, path: string) {
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/${tag}/${path}`
}

async function loadManifest(tag: string): Promise<Manifest> {
  const url = makeReleaseUrl(tag, 'manifest.json')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load manifest (${res.status}): ${url}`)
  return (await res.json()) as Manifest
}

async function loadGltf(url: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(err)
    )
  })
}

function main() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <header>
      <div class="brand">Brain Wiring Atlas</div>
      <div class="hint">Free explore • Drag to orbit • Scroll to zoom • Hover for labels</div>
    </header>
    <div id="stage">
      <div class="tooltip" id="tooltip"></div>
      <div class="legend" id="legend">
        <b>Legend</b><br/>
        <span style="color:#8bd3ff">Structural</span>: tract bundles (streamline-derived, in canonical space) <br/>
        <span style="color:#ffb86b">Functional</span>: networks/edges (RSNs / connectome overlays)
        <div style="margin-top:8px; opacity:0.85">Data pack: <code id="datatag">${DATA_TAG}</code> (GitHub Releases)</div>
        <div id="datastatus" style="margin-top:6px; opacity:0.85"></div>
      </div>
    </div>
  `

  const stage = document.querySelector<HTMLDivElement>('#stage')!
  const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!
  const dataTagEl = document.querySelector<HTMLElement>('#datatag')!
  const dataStatusEl = document.querySelector<HTMLElement>('#datastatus')!

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#05060a')

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6)
  camera.position.set(0.6, 0.25, 1.2)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  stage.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.target.set(0.0, 0.05, 0.0)

  // Lighting (moody)
  scene.add(new THREE.AmbientLight(0x112233, 0.25))
  const key = new THREE.DirectionalLight(0xffffff, 1.3)
  key.position.set(1.2, 1.0, 1.0)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x88aaff, 0.4)
  rim.position.set(-1.2, 0.2, -1.0)
  scene.add(rim)

  // Root content group
  const brainGroup = new THREE.Group()
  scene.add(brainGroup)

  // Placeholder "hemisphere cutaway" brain shell (until real anatomy GLB arrives).
  // A clipped sphere + subtle wire overlay for that diagram look.

  const mat = new THREE.MeshStandardMaterial({
    color: 0x1d2a3a,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    opacity: 0.95,
  })

  const geo = new THREE.SphereGeometry(0.45, 96, 96)
  const brain = new THREE.Mesh(geo, mat)
  brainGroup.add(brain)

  // Cutaway: hide one hemisphere by scaling X (temporary hack; real cutaway will come from mesh).
  brain.scale.x = 0.55

  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x2a4666, transparent: true, opacity: 0.12 })
  )
  wire.scale.copy(brain.scale)
  brainGroup.add(wire)

  // Placeholder tract "bundle" cables
  function makeBundle(name: string, color: number, seed: number) {
    const points: THREE.Vector3[] = []
    for (let i = 0; i < 140; i++) {
      const t = i / 139
      const a = t * Math.PI * 2
      const r = 0.15 + 0.12 * Math.sin(a * 2 + seed)
      const x = (t - 0.5) * 0.5
      const y = 0.08 * Math.sin(a * 1.2 + seed)
      const z = r * Math.cos(a + seed)
      points.push(new THREE.Vector3(x, y, z))
    }
    const curve = new THREE.CatmullRomCurve3(points)
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(500))
    const m = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }))
    ;(m as any).userData = { label: name }
    return m
  }

  const bundles: THREE.Object3D[] = [
    makeBundle('Arcuate fasciculus (preview)', 0x8bd3ff, 0.7),
    makeBundle('Corticospinal tract (preview)', 0x7fffd4, 1.9),
  ]
  bundles.forEach((b) => brainGroup.add(b))

  // Hover labels via raycaster
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  function onPointerMove(ev: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -(((ev.clientY - rect.top) / rect.height) * 2 - 1)
    )
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(bundles, true)
    if (intersects.length === 0) {
      tooltip.style.display = 'none'
      return
    }
    const obj = intersects[0].object
    const label = (obj as any).userData?.label ?? (obj.parent as any)?.userData?.label
    if (!label) {
      tooltip.style.display = 'none'
      return
    }
    tooltip.textContent = label
    tooltip.style.display = 'block'
    tooltip.style.left = `${ev.clientX - rect.left + 12}px`
    tooltip.style.top = `${ev.clientY - rect.top + 12}px`
  }

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerleave', () => (tooltip.style.display = 'none'))

  // Kick off initial pack load (will fall back gracefully if it doesn't exist yet).
  applyDataPack(DATA_TAG)

  async function applyDataPack(tag: string) {
    dataTagEl.textContent = tag
    dataStatusEl.textContent = 'Loading data pack…'

    try {
      const manifest = await loadManifest(tag)

      // Try loading anatomy if provided.
      if (manifest.assets.anatomy?.url) {
        const url = manifest.assets.anatomy.url.startsWith('http')
          ? manifest.assets.anatomy.url
          : makeReleaseUrl(tag, manifest.assets.anatomy.url)

        const obj = await loadGltf(url)
        obj.name = 'anatomy'

        // Replace placeholder brain mesh (keep wiring overlay for now).
        const old = brainGroup.getObjectByName('anatomy')
        if (old) brainGroup.remove(old)
        brainGroup.add(obj)

        dataStatusEl.innerHTML = `Loaded: <b>${manifest.assets.anatomy.name ?? 'anatomy'}</b>`
      } else {
        dataStatusEl.textContent = manifest.notes ?? 'No anatomy in this pack yet.'
      }
    } catch (e) {
      console.error(e)
      dataStatusEl.textContent = `Data pack load failed (still using preview geometry).`
    }
  }

  const params = {
    dataTag: DATA_TAG,
    applyDataTag: async () => {
      DATA_TAG = params.dataTag
      await applyDataPack(DATA_TAG)
    },
    cutaway: 0.55,
    wireOpacity: 0.12,
    bundleOpacity: 0.75,
  }

  const gui = new GUI({ title: 'Atlas' })
  const dataFolder = gui.addFolder('Data pack')
  dataFolder.add(params, 'dataTag').name('release tag')
  dataFolder.add(params, 'applyDataTag').name('load')
  dataFolder.open()

  gui.add(params, 'cutaway', 0.1, 1.0, 0.01).onChange((v: number) => {
    brain.scale.x = v
    wire.scale.x = v
  })
  gui.add(params, 'wireOpacity', 0, 0.5, 0.01).onChange((v: number) => {
    ;(wire.material as THREE.LineBasicMaterial).opacity = v
  })
  gui.add(params, 'bundleOpacity', 0, 1, 0.01).onChange((v: number) => {
    bundles.forEach((b) => {
      ;((b as THREE.Line).material as THREE.LineBasicMaterial).opacity = v
    })
  })
  // (tryLoadDataPack removed; use Data pack folder)

  const onResize = () => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(onResize).observe(stage)
  onResize()

  function frame() {
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main()
