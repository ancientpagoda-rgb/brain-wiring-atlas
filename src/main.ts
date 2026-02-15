import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import GUI from 'lil-gui'

// Data pack tag hosted under /public/packs/<tag>/...
let DATA_TAG = 'v0.9'

type Manifest = {
  version: string
  citation?: string
  notes?: string
  assets: {
    anatomy?: { url: string; name?: string }
    bundles?: Array<{
      id: string
      name: string
      color?: string
      // v0.6+: dual representations
      meshUrl?: string
      wireUrl?: string
      // legacy
      url?: string
      type?: 'polyline' | 'mesh'
    }>
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
  loader.setMeshoptDecoder(MeshoptDecoder)
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => reject(err))
  })
}

type Normalization = { center: THREE.Vector3; scale: number }

function computeNormalization(obj: THREE.Object3D): Normalization {
  const box = new THREE.Box3().setFromObject(obj)
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = new THREE.Vector3()
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = maxDim > 0 ? 1 / maxDim : 1
  return { center, scale }
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
        <span style="color:#8bd3ff">Structural</span>: tract bundles (atlas-derived) <br/>
        <span style="color:#ffb86b">Functional</span>: networks/edges (RSNs / connectome overlays)
        <div style="margin-top:8px; opacity:0.85">Data pack: <code id="datatag">${DATA_TAG}</code></div>
        <div id="datastatus" style="margin-top:6px; opacity:0.85"></div>
        <div id="bundlelegend" style="margin-top:8px"></div>
      </div>
    </div>
  `

  const stage = document.querySelector<HTMLDivElement>('#stage')!
  const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!
  const dataTagEl = document.querySelector<HTMLElement>('#datatag')!
  const dataStatusEl = document.querySelector<HTMLElement>('#datastatus')!
  const bundleLegendEl = document.querySelector<HTMLElement>('#bundlelegend')!

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
  controls.minDistance = 0.01
  controls.maxDistance = 50

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

  // Everything data-driven lives under normalizedRoot, which gets centered+scaled once
  // based on anatomy bounds. This guarantees Surface/Wiring share identical transforms.
  const normalizedRoot = new THREE.Group()
  normalizedRoot.name = 'normalizedRoot'
  brainGroup.add(normalizedRoot)

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
  brain.name = 'placeholderBrain'
  brainGroup.add(brain)

  // Cutaway: hide one hemisphere by scaling X (temporary hack; real cutaway will come from mesh).
  brain.scale.x = 0.55

  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x2a4666, transparent: true, opacity: 0.12 })
  )
  wire.name = 'placeholderWire'
  wire.scale.copy(brain.scale)
  brainGroup.add(wire)

  // Structural bundles container (loaded from pack)
  const bundlesGroup = new THREE.Group()
  bundlesGroup.name = 'bundles'
  normalizedRoot.add(bundlesGroup)

  const bundleObjects = new Map<string, THREE.Object3D>()

  // Functional overlays (node+edge style for now; surface overlays later).
  const functionalGroup = new THREE.Group()
  functionalGroup.name = 'functional'
  normalizedRoot.add(functionalGroup)

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

      let anatomyNorm: Normalization | null = null

      // Try loading anatomy if provided.
      if (manifest.assets.anatomy?.url) {
        const url = manifest.assets.anatomy.url.startsWith('http')
          ? manifest.assets.anatomy.url
          : makePackUrlNoBust(tag, manifest.assets.anatomy.url)

        const obj = await loadGltf(url)
        obj.name = 'anatomy'

        // Hide placeholder geometry once real anatomy is loaded.
        const placeholderBrain = brainGroup.getObjectByName('placeholderBrain')
        const placeholderWire = brainGroup.getObjectByName('placeholderWire')
        if (placeholderBrain) placeholderBrain.visible = false
        if (placeholderWire) placeholderWire.visible = false

        const old = normalizedRoot.getObjectByName('anatomy')
        if (old) normalizedRoot.remove(old)
        normalizedRoot.add(obj)

        anatomyNorm = computeNormalization(obj)

        // Reset normalization transform on root, then apply it once (center+scale).
        normalizedRoot.position.set(0, 0, 0)
        normalizedRoot.scale.set(1, 1, 1)
        normalizedRoot.updateMatrixWorld(true)

        // Apply normalization to the *root* in a translation-safe way.
        // Note: scaling does NOT scale Object3D.position, so we must scale the translation ourselves.
        normalizedRoot.scale.setScalar(anatomyNorm.scale)
        normalizedRoot.position.copy(anatomyNorm.center).multiplyScalar(-anatomyNorm.scale)
        normalizedRoot.updateMatrixWorld(true)

        // Ensure anatomy is visible (Pandora surface comes in without useful materials).
        obj.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x162234,
            transparent: true,
            opacity: 0.35,
            roughness: 1,
            metalness: 0,
            emissive: new THREE.Color(0x0b1626),
            emissiveIntensity: 0.9,
          })
        })
      }

      // Load structural layers (Surface meshes and/or Wiring centerlines).
      bundlesGroup.clear()
      bundleObjects.clear()

      // Always load both representations (if present) so switching modes is instant.
      const showSurface = params.structuralMode === 'Surface' || params.structuralMode === 'Both'
      const showWiring = params.structuralMode === 'Wiring' || params.structuralMode === 'Both'
      const loadSurface = true
      const loadWiring = true

      const bundleDefs = manifest.assets.bundles ?? []

      // Initialize enabled map once per tag.
      if (params.enabledBundleIds.size === 0) {
        for (const b of bundleDefs) params.enabledBundleIds.add(b.id)
      }

      const makeWireObject = (pts: THREE.Vector3[], color: number) => {
        if (params.bundleWidth <= 1.0) {
          const material = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: params.bundleOpacity,
            blending: THREE.AdditiveBlending,
          })
          const geom = new THREE.BufferGeometry().setFromPoints(pts)
          geom.computeBoundingBox()
          geom.computeBoundingSphere()
          return new THREE.Line(geom, material)
        }

        const positions: number[] = []
        for (const p of pts) positions.push(p.x, p.y, p.z)
        const geom = new LineGeometry()
        geom.setPositions(positions)
        ;(geom as any).computeBoundingBox?.()
        ;(geom as any).computeBoundingSphere?.()

        const mat = new LineMaterial({
          color,
          linewidth: Math.max(1.0, params.bundleWidth),
          transparent: true,
          opacity: params.bundleOpacity,
          dashed: false,
        })
        mat.blending = THREE.AdditiveBlending
        mat.depthTest = true

        const line2 = new Line2(geom, mat)
        line2.computeLineDistances()
        return line2
      }

      for (const b of bundleDefs) {
        if (!params.enabledBundleIds.has(b.id)) continue

        const color = parseHexColor(b.color ?? '#8bd3ff')
        const group = new THREE.Group()
        group.name = `bundle:${b.id}`
        ;(group as any).userData = { label: b.name }

        // Surface (mesh)
        if (loadSurface) {
          const meshPath = b.meshUrl ?? (b.type === 'mesh' ? b.url : undefined)
          if (meshPath) {
            const url = meshPath.startsWith('http') ? meshPath : makePackUrlNoBust(tag, meshPath)
            const obj = await loadGltf(url)
            obj.name = `surface:${b.id}`
            ;(obj as any).userData = { label: b.name }

            // No per-object normalization; normalizedRoot already handles centering+scale.

            obj.traverse((child) => {
              const mesh = child as THREE.Mesh
              if (!mesh.isMesh) return
              mesh.material = new THREE.MeshStandardMaterial({
                color,
                transparent: true,
                opacity: Math.min(0.9, Math.max(0.1, params.bundleOpacity)),
                roughness: 0.9,
                metalness: 0,
                emissive: params.glowMode ? new THREE.Color(color) : new THREE.Color(0x000000),
                emissiveIntensity: params.glowMode ? 0.35 : 0,
              })
            })

            obj.visible = showSurface
            group.add(obj)
          }
        }

        // Wiring (polyline)
        if (loadWiring) {
          const wirePath = b.wireUrl
          if (wirePath) {
            const url = wirePath.startsWith('http') ? wirePath : makePackUrl(tag, wirePath)
            const data = await loadBundleJson(url)

            for (const line of data.lines) {
              let pts = line.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
              // Wires are authored in world-mm. normalizedRoot already applies centering+scale.
              const obj = makeWireObject(pts, color)
              ;(obj as any).userData = { label: b.name }
              obj.visible = showWiring
              group.add(obj)
            }
          }
        }

        if (group.children.length > 0) {
          bundlesGroup.add(group)
          bundleObjects.set(b.id, group)
        }
      }

      const bundleCount = bundleObjects.size
      const anatomyStatus = manifest.assets.anatomy?.url ? (manifest.assets.anatomy.name ?? 'anatomy') : '(no anatomy)'

      dataStatusEl.innerHTML = `Loaded: <b>${anatomyStatus}</b> • visible bundles: <b>${bundleCount}</b> • mode: <b>${params.structuralMode}</b>`

      // Legend + per-bundle toggles.
      const items = bundleDefs.map((b) => {
        const checked = params.enabledBundleIds.has(b.id) ? 'checked' : ''
        const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${b.color ?? '#8bd3ff'};margin-right:8px;border:1px solid rgba(255,255,255,0.15)"></span>`
        return `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
            <input type="checkbox" data-bundle-id="${b.id}" ${checked} />
            ${swatch}
            <span style="opacity:0.92">${b.name}</span>
          </label>
        `
      })
      bundleLegendEl.innerHTML = items.join('')

      bundleLegendEl.onclick = (ev) => {
        const t = ev.target as HTMLElement
        if (!(t instanceof HTMLInputElement)) return
        const id = t.dataset.bundleId
        if (!id) return
        if (t.checked) params.enabledBundleIds.add(id)
        else params.enabledBundleIds.delete(id)
        params.applyDataTag()
      }

      // Deterministic view: keep content centered at origin after normalization.
      // (Bounding-box framing can be unreliable with Line2 wiring geometry.)
      {
        controls.target.set(0, 0, 0)
        camera.position.set(0.0, 0.12, 1.2)
        camera.near = 0.001
        camera.far = 200
        camera.updateProjectionMatrix()
        controls.update()
      }

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
      // reset enabled ids when switching packs
      if (params.dataTag !== DATA_TAG) {
        params.enabledBundleIds.clear()
      }
      DATA_TAG = params.dataTag
      await applyDataPack(DATA_TAG)
    },
    frame: () => {
      // Frame to anatomy+bundles using standard box bounds.
      const box = new THREE.Box3().setFromObject(brainGroup)
      const size = new THREE.Vector3()
      box.getSize(size)
      const center = new THREE.Vector3()
      box.getCenter(center)
      const maxDim = Math.max(size.x, size.y, size.z)
      const dist = maxDim > 0 ? maxDim * 2.2 : 2.2
      controls.target.copy(center)
      camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist * 0.2, dist)))
      camera.near = Math.max(0.001, dist / 200)
      camera.far = Math.max(10, dist * 80)
      camera.updateProjectionMatrix()
      controls.update()
    },
    cutaway: 0.55,
    wireOpacity: 0.12,

    // Structural
    bundlesVisible: true,
    bundleOpacity: 0.75,
    bundleWidth: 2.5,
    glowMode: true,
    structuralMode: 'Wiring' as 'Surface' | 'Wiring' | 'Both',
    enabledBundleIds: new Set<string>(),

    // Functional
    functionalOpacity: 0.75,
    functionalNodeSize: 0.018,
    dmnSizeBoost: 1.6,
    netDMN: true,
    netSalience: false,
    netDorsalAttention: false,
    netVisual: false,
    netSomatomotor: false,

    figureMode: false,
    exportPng: () => {
      renderer.render(scene, camera)
      const a = document.createElement('a')
      a.download = `brain-wiring-${DATA_TAG}.png`
      a.href = renderer.domElement.toDataURL('image/png')
      a.click()
    },
  }

  const gui = new GUI({ title: 'Atlas' })
  const dataFolder = gui.addFolder('Data pack')
  dataFolder.add(params, 'dataTag').name('pack tag')
  dataFolder.add(params, 'applyDataTag').name('load')
  dataFolder.add(params, 'frame').name('frame view')
  dataFolder.open()

  type NetDef = {
    id: string
    name: string
    color: number
    nodes: Array<{ id: string; label: string; p: [number, number, number] }>
    edges: Array<[string, string]>
  }

  const NETS: Record<string, NetDef> = {
    DMN: {
      id: 'DMN',
      name: 'Default Mode',
      color: 0xffb86b,
      nodes: [
        { id: 'mPFC', label: 'mPFC', p: [0, 52, -2] },
        { id: 'PCC', label: 'PCC/Precuneus', p: [0, -52, 26] },
        { id: 'LAG', label: 'L Angular', p: [-45, -68, 34] },
        { id: 'RAG', label: 'R Angular', p: [45, -68, 34] },
        { id: 'LMTL', label: 'L MTL', p: [-24, -20, -18] },
        { id: 'RMTL', label: 'R MTL', p: [24, -20, -18] },
      ],
      edges: [
        ['mPFC', 'PCC'],
        ['PCC', 'LAG'],
        ['PCC', 'RAG'],
        ['PCC', 'LMTL'],
        ['PCC', 'RMTL'],
      ],
    },
    SAL: {
      id: 'SAL',
      name: 'Salience',
      color: 0xff4d6d,
      nodes: [
        { id: 'dACC', label: 'dACC', p: [0, 20, 28] },
        { id: 'Lins', label: 'L Insula', p: [-34, 20, 2] },
        { id: 'Rins', label: 'R Insula', p: [34, 20, 2] },
        { id: 'Lamg', label: 'L Amygdala', p: [-22, -4, -16] },
        { id: 'Ramg', label: 'R Amygdala', p: [22, -4, -16] },
      ],
      edges: [
        ['dACC', 'Lins'],
        ['dACC', 'Rins'],
        ['Lins', 'Lamg'],
        ['Rins', 'Ramg'],
      ],
    },
    DAN: {
      id: 'DAN',
      name: 'Dorsal Attention',
      color: 0x6fe8ff,
      nodes: [
        { id: 'LFEF', label: 'L FEF', p: [-28, -2, 50] },
        { id: 'RFEF', label: 'R FEF', p: [28, -2, 50] },
        { id: 'LIPS', label: 'L IPS', p: [-28, -60, 48] },
        { id: 'RIPS', label: 'R IPS', p: [28, -60, 48] },
      ],
      edges: [
        ['LFEF', 'LIPS'],
        ['RFEF', 'RIPS'],
        ['LIPS', 'RIPS'],
      ],
    },
    VIS: {
      id: 'VIS',
      name: 'Visual',
      color: 0xffea7a,
      nodes: [
        { id: 'LV1', label: 'L V1', p: [-10, -92, 2] },
        { id: 'RV1', label: 'R V1', p: [10, -92, 2] },
        { id: 'LMT', label: 'L MT+', p: [-46, -72, 2] },
        { id: 'RMT', label: 'R MT+', p: [46, -72, 2] },
      ],
      edges: [
        ['LV1', 'LMT'],
        ['RV1', 'RMT'],
        ['LV1', 'RV1'],
      ],
    },
    SMN: {
      id: 'SMN',
      name: 'Somatomotor',
      color: 0x9effa1,
      nodes: [
        { id: 'LS1', label: 'L S1/M1', p: [-36, -24, 56] },
        { id: 'RS1', label: 'R S1/M1', p: [36, -24, 56] },
        { id: 'LSMA', label: 'L SMA', p: [-4, -6, 58] },
        { id: 'RSMA', label: 'R SMA', p: [4, -6, 58] },
      ],
      edges: [
        ['LS1', 'LSMA'],
        ['RS1', 'RSMA'],
        ['LS1', 'RS1'],
      ],
    },
  }

  function buildFunctionalNetworks() {
    functionalGroup.clear()

    const buildNet = (net: NetDef) => {
      const netGroup = new THREE.Group()
      netGroup.name = `net:${net.id}`

      const sphereMat = new THREE.MeshBasicMaterial({
        color: net.color,
        transparent: true,
        opacity: params.functionalOpacity,
      })

      const nodeMeshes: Record<string, THREE.Mesh> = {}
      for (const n of net.nodes) {
        const size = net.id === 'DMN' ? params.functionalNodeSize * params.dmnSizeBoost : params.functionalNodeSize
        const geom = new THREE.SphereGeometry(size, 16, 16)
        const m = new THREE.Mesh(geom, sphereMat)
        m.name = `netnode:${net.id}:${n.id}`
        ;(m as any).userData = { label: `${net.name}: ${n.label}` }

        // IMPORTANT: Nodes are authored in world-mm coordinates.
        // Since functionalGroup is a child of normalizedRoot, they will be normalized automatically.
        m.position.set(n.p[0], n.p[1], n.p[2])

        netGroup.add(m)
        nodeMeshes[n.id] = m
      }

      for (const [a, b] of net.edges) {
        const pa = nodeMeshes[a]?.position
        const pb = nodeMeshes[b]?.position
        if (!pa || !pb) continue
        const obj = makeFunctionalEdge(pa, pb, net.color)
        netGroup.add(obj)
      }

      functionalGroup.add(netGroup)
    }

    if (params.netDMN) buildNet(NETS.DMN)
    if (params.netSalience) buildNet(NETS.SAL)
    if (params.netDorsalAttention) buildNet(NETS.DAN)
    if (params.netVisual) buildNet(NETS.VIS)
    if (params.netSomatomotor) buildNet(NETS.SMN)
  }

  function makeFunctionalEdge(a: THREE.Vector3, b: THREE.Vector3, color: number) {
    const pts = [a, b]
    if (params.bundleWidth <= 1.0) {
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: params.functionalOpacity,
        blending: THREE.AdditiveBlending,
      })
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      return new THREE.Line(geom, material)
    }

    const positions = [a.x, a.y, a.z, b.x, b.y, b.z]
    const geom = new LineGeometry()
    geom.setPositions(positions)
    const mat = new LineMaterial({
      color,
      linewidth: Math.max(1.0, params.bundleWidth * 0.6),
      transparent: true,
      opacity: params.functionalOpacity,
      dashed: true,
      dashSize: 0.2,
      gapSize: 0.15,
    } as any)
    ;(mat as any).blending = THREE.AdditiveBlending
    ;(mat as any).depthTest = true
    const line2 = new Line2(geom, mat)
    line2.computeLineDistances()
    return line2
  }

  // Kick off initial pack load.
  params.applyDataTag().then(() => buildFunctionalNetworks())

  gui.add(params, 'cutaway', 0.1, 1.0, 0.01).onChange((v: number) => {
    brain.scale.x = v
    wire.scale.x = v
  })
  gui.add(params, 'wireOpacity', 0, 0.5, 0.01).onChange((v: number) => {
    ;(wire.material as THREE.LineBasicMaterial).opacity = v
  })
  const layerFolder = gui.addFolder('Layers')
  layerFolder.add(params, 'bundlesVisible').name('Structural').onChange((v: boolean) => {
    bundlesGroup.visible = v
  })
  const funcFolder = gui.addFolder('Functional networks')
  funcFolder.add(params, 'netDMN').name('Default Mode (DMN)').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'netSalience').name('Salience').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'netDorsalAttention').name('Dorsal Attention').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'netVisual').name('Visual').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'netSomatomotor').name('Somatomotor').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'functionalOpacity', 0, 1, 0.01).name('Opacity').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'functionalNodeSize', 0.005, 0.05, 0.001).name('Node size').onChange(() => buildFunctionalNetworks())
  funcFolder.add(params, 'dmnSizeBoost', 1.0, 3.0, 0.1).name('DMN size boost').onChange(() => buildFunctionalNetworks())
  funcFolder.open()
  layerFolder.add(params, 'structuralMode', ['Surface', 'Wiring', 'Both']).name('Structural mode').onChange((v: string) => {
    // Instant toggle: just change visibility of loaded objects.
    const showSurface = v === 'Surface' || v === 'Both'
    const showWiring = v === 'Wiring' || v === 'Both'
    for (const obj of bundleObjects.values()) {
      obj.traverse((child) => {
        if (child.name.startsWith('surface:')) child.visible = showSurface
        else if ((child as any).isLine || (child as any).isLine2) child.visible = showWiring
      })
    }
    // Update status line.
    const dataStatusEl = document.querySelector<HTMLElement>('#datastatus')
    if (dataStatusEl) {
      dataStatusEl.innerHTML = dataStatusEl.innerHTML.replace(/mode: <b>.*?<\/b>/, `mode: <b>${v}</b>`)
    }
  })
  layerFolder.add(params, 'bundleOpacity', 0, 1, 0.01).name('Structural opacity').onChange(() => {
    params.applyDataTag()
  })
  // (functional controls moved to "Functional networks" folder)
  layerFolder.add(params, 'bundleWidth', 0.5, 8, 0.1).name('Width (px)').onChange(() => {
    params.applyDataTag()
  })
  layerFolder.add(params, 'glowMode').name('Glow mode').onChange(() => {
    params.applyDataTag()
  })
  layerFolder.open()

  const figureFolder = gui.addFolder('Figure')
  figureFolder.add(params, 'figureMode').name('Figure mode').onChange((v: boolean) => {
    const legend = document.querySelector<HTMLElement>('#legend')!
    legend.style.display = v ? 'none' : 'block'
    gui.domElement.style.display = v ? 'none' : 'block'
  })
  figureFolder.add(params, 'exportPng').name('Export PNG')

  const onResize = () => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()

    // Update resolution for wide line materials.
    const updateLineRes = (root: THREE.Object3D) => {
      root.traverse((child) => {
        const mat = (child as any).material as LineMaterial | undefined
        if (mat && (mat as any).isLineMaterial) {
          mat.resolution.set(w, h)
        }
      })
    }

    for (const obj of bundleObjects.values()) updateLineRes(obj)
    updateLineRes(functionalGroup)
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
