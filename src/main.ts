import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import GUI from 'lil-gui'

// Data pack tag hosted under /public/packs/<tag>/...
let DATA_TAG = 'v0.3'

type Manifest = {
  version: string
  citation?: string
  notes?: string
  assets: {
    anatomy?: { url: string; name?: string }
    bundles?: Array<{ id: string; name: string; url: string; color?: string }>
  }
}

// NOTE: GitHub Releases asset URLs do not reliably send CORS headers for browser fetch/XHR.
// So we host packs under the site itself (public/packs/<tag>/...) and still ALSO upload
// them to Releases for distribution.
function makePackUrl(tag: string, path: string) {
  const base = import.meta.env.BASE_URL
  // cache-bust because GitHub Pages caches aggressively for a few minutes
  const v = encodeURIComponent(String(Date.now()))
  return `${base}packs/${tag}/${path}?v=${v}`
}

// Only used for text/binary assets; don't append cache-buster to glTF URLs,
// because loaders may request range/relative resources in some cases.
function makePackUrlNoBust(tag: string, path: string) {
  const base = import.meta.env.BASE_URL
  return `${base}packs/${tag}/${path}`
}

async function loadManifest(tag: string): Promise<Manifest> {
  const url = makePackUrl(tag, 'manifest.json')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load manifest (${res.status}): ${url}`)
  return (await res.json()) as Manifest
}

async function loadGltf(url: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => reject(err))
  })
}

function normalizeObjectToUnit(obj: THREE.Object3D) {
  // Centers object at origin and scales so its longest dimension is ~1.
  const box = new THREE.Box3().setFromObject(obj)
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = new THREE.Vector3()
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = maxDim > 0 ? 1 / maxDim : 1

  obj.traverse((child) => {
    // ensure bounding boxes update after scaling
    ;(child as any).frustumCulled = false
  })

  obj.position.sub(center)
  obj.scale.multiplyScalar(scale)
  obj.updateMatrixWorld(true)
  return { box, size, center, scale }
}

function parseHexColor(hex: string, fallback = 0x8bd3ff) {
  const h = hex.trim().replace('#', '')
  if (h.length === 6) return parseInt(h, 16)
  return fallback
}

type BundleJson = {
  id: string
  name: string
  type: 'polyline'
  lines: number[][][]
}

async function loadBundleJson(url: string): Promise<BundleJson> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load bundle (${res.status}): ${url}`)
  return (await res.json()) as BundleJson
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

  // Debug helpers (small, but useful)
  const axes = new THREE.AxesHelper(0.3)
  ;(axes.material as THREE.Material).transparent = true
  ;(axes.material as THREE.Material).opacity = 0.25
  scene.add(axes)
  const originDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff66aa })
  )
  scene.add(originDot)
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

  // Structural bundles container (loaded from pack)
  const bundlesGroup = new THREE.Group()
  bundlesGroup.name = 'bundles'
  brainGroup.add(bundlesGroup)

  const bundleObjects = new Map<string, THREE.Object3D>()

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
    const intersects = raycaster.intersectObjects(Array.from(bundleObjects.values()), true)
    if (intersects.length === 0) {
      tooltip.style.display = 'none'
      return
    }
    const obj = intersects[0].object
    const label = (obj as any).userData?.label ?? (obj.parent as any)?.userData?.label ?? (obj.parent?.parent as any)?.userData?.label
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

  async function applyDataPack(tag: string) {
    dataTagEl.textContent = tag
    dataStatusEl.textContent = 'Loading data pack…'

    try {
      const manifest = await loadManifest(tag)

      // Try loading anatomy if provided.
      if (manifest.assets.anatomy?.url) {
        const url = manifest.assets.anatomy.url.startsWith('http')
          ? manifest.assets.anatomy.url
          : makePackUrlNoBust(tag, manifest.assets.anatomy.url)

        const obj = await loadGltf(url)
        obj.name = 'anatomy'

        const old = brainGroup.getObjectByName('anatomy')
        if (old) brainGroup.remove(old)
        brainGroup.add(obj)

        normalizeObjectToUnit(obj)

        // Reframe camera/controls roughly around the loaded anatomy.
        controls.target.set(0, 0, 0)
        camera.position.set(1.2, 0.6, 1.6)
        controls.update()

        // Don't finalize status here; we update after bundles load.
      }

      // Load bundles.
      bundlesGroup.clear()
      bundleObjects.clear()

      for (const b of manifest.assets.bundles ?? []) {
        const bUrl = b.url.startsWith('http') ? b.url : makePackUrl(tag, b.url)
        const data = await loadBundleJson(bUrl)
        const color = parseHexColor(b.color ?? '#8bd3ff')

        const group = new THREE.Group()
        group.name = `bundle:${data.id}`
        ;(group as any).userData = { label: data.name }

        // Bundles in the pack are authored in "normalized" space (roughly -0.5..0.5).
        // If/when we switch to real tractography in mm space, we can set a flag in the manifest.
        const bundleScale = 1.0

        const makeLineObject = (pts: THREE.Vector3[]) => {
          if (params.bundleWidth <= 1.0) {
            const material = new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: params.bundleOpacity,
              blending: params.glowMode ? THREE.AdditiveBlending : THREE.NormalBlending,
            })
            const geom = new THREE.BufferGeometry().setFromPoints(pts)
            return new THREE.Line(geom, material)
          }

          // Wide lines (screen-space) using Line2.
          const positions: number[] = []
          for (const p of pts) positions.push(p.x, p.y, p.z)
          const geom = new LineGeometry()
          geom.setPositions(positions)

          const mat = new LineMaterial({
            color,
            linewidth: params.bundleWidth, // in pixels
            transparent: true,
            opacity: params.bundleOpacity,
            dashed: false,
          })
          mat.blending = params.glowMode ? THREE.AdditiveBlending : THREE.NormalBlending
          mat.depthTest = true

          const line2 = new Line2(geom, mat)
          line2.computeLineDistances()
          return line2
        }

        for (const line of data.lines) {
          const pts = line.map((p) => new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(bundleScale))
          const obj = makeLineObject(pts)
          ;(obj as any).userData = { label: data.name }
          group.add(obj)
        }

        bundlesGroup.add(group)
        bundleObjects.set(data.id, group)
      }

      const bundleCount = bundleObjects.size
      const anatomyStatus = manifest.assets.anatomy?.url ? (manifest.assets.anatomy.name ?? 'anatomy') : '(no anatomy)'
      dataStatusEl.innerHTML = `Loaded: <b>${anatomyStatus}</b> • bundles: <b>${bundleCount}</b>`

      if (!manifest.assets.anatomy?.url) {
        dataStatusEl.textContent = manifest.notes ?? 'Loaded (no anatomy in this pack).'
      }
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      dataStatusEl.textContent = `Data pack load failed: ${msg}`
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
    bundlesVisible: true,
    bundleOpacity: 0.75,
    bundleWidth: 2.5,
    glowMode: false,
  }

  const gui = new GUI({ title: 'Atlas' })
  const dataFolder = gui.addFolder('Data pack')
  dataFolder.add(params, 'dataTag').name('pack tag')
  dataFolder.add(params, 'applyDataTag').name('load')
  dataFolder.open()

  // Kick off initial pack load.
  params.applyDataTag()

  gui.add(params, 'cutaway', 0.1, 1.0, 0.01).onChange((v: number) => {
    brain.scale.x = v
    wire.scale.x = v
  })
  gui.add(params, 'wireOpacity', 0, 0.5, 0.01).onChange((v: number) => {
    ;(wire.material as THREE.LineBasicMaterial).opacity = v
  })
  const layerFolder = gui.addFolder('Layers')
  layerFolder.add(params, 'bundlesVisible').name('Structural bundles').onChange((v: boolean) => {
    bundlesGroup.visible = v
  })
  layerFolder.add(params, 'bundleOpacity', 0, 1, 0.01).name('Bundle opacity').onChange(() => {
    params.applyDataTag()
  })
  layerFolder.add(params, 'bundleWidth', 0.5, 8, 0.1).name('Bundle width (px)').onChange(() => {
    params.applyDataTag()
  })
  layerFolder.add(params, 'glowMode').name('Glow mode').onChange(() => {
    params.applyDataTag()
  })
  layerFolder.open()

  const onResize = () => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()

    // Update resolution for wide line materials.
    for (const obj of bundleObjects.values()) {
      obj.traverse((child) => {
        const mat = (child as any).material as LineMaterial | undefined
        if (mat && (mat as any).isLineMaterial) {
          mat.resolution.set(w, h)
        }
      })
    }
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
