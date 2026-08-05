import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type Genome = {
  seed: number
  size: number
  symmetry: number
  foldPressure: number
  tractAttraction: number
  pruning: number
  noise: number
}

type RegionId =
  | 'brainstem'
  | 'thalamus'
  | 'occipital'
  | 'parietal'
  | 'frontal_l'
  | 'frontal_r'
  | 'temporal_l'
  | 'temporal_r'
  | 'hippocampus_l'
  | 'hippocampus_r'

type RegionSpec = {
  id: RegionId
  label: string
  color: number
  base: [number, number, number]
  radius: number
  born: number
}

type TractSpec = {
  id: string
  label: string
  color: number
  from: RegionId
  to: RegionId
  born: number
  resilience: number
  lift: number
  curvature: number
}

type RegionVisual = {
  spec: RegionSpec
  mesh: THREE.Mesh
  basePosition: THREE.Vector3
}

type TractVisual = {
  spec: TractSpec
  line: THREE.Line
  points: THREE.Vector3[]
  random: number
}

type PhaseInfo = {
  name: string
  summary: string
}

const REGION_SPECS: RegionSpec[] = [
  { id: 'brainstem', label: 'Brainstem', color: 0xffb86b, base: [0, -0.34, -0.48], radius: 0.085, born: 0.04 },
  { id: 'thalamus', label: 'Thalamus', color: 0xb06cff, base: [0, -0.02, -0.07], radius: 0.11, born: 0.12 },
  { id: 'occipital', label: 'Occipital pole', color: 0xffea7a, base: [0.02, -0.72, 0.1], radius: 0.1, born: 0.18 },
  { id: 'parietal', label: 'Parietal crown', color: 0x6fe8ff, base: [0.0, 0.08, 0.78], radius: 0.11, born: 0.24 },
  { id: 'frontal_l', label: 'Frontal cortex L', color: 0x8bd3ff, base: [-0.56, 0.58, 0.12], radius: 0.115, born: 0.3 },
  { id: 'frontal_r', label: 'Frontal cortex R', color: 0x8bd3ff, base: [0.56, 0.58, 0.12], radius: 0.115, born: 0.3 },
  { id: 'temporal_l', label: 'Temporal lobe L', color: 0xff9ad1, base: [-0.66, -0.02, -0.28], radius: 0.12, born: 0.2 },
  { id: 'temporal_r', label: 'Temporal lobe R', color: 0xff9ad1, base: [0.66, -0.02, -0.28], radius: 0.12, born: 0.2 },
  { id: 'hippocampus_l', label: 'Hippocampus L', color: 0xc4b5ff, base: [-0.3, -0.14, -0.18], radius: 0.075, born: 0.28 },
  { id: 'hippocampus_r', label: 'Hippocampus R', color: 0xc4b5ff, base: [0.3, -0.14, -0.18], radius: 0.075, born: 0.28 },
]

const TRACT_SPECS: TractSpec[] = [
  {
    id: 'callosal',
    label: 'Callosal bridge',
    color: 0xffffff,
    from: 'frontal_l',
    to: 'frontal_r',
    born: 0.45,
    resilience: 0.55,
    lift: 0.12,
    curvature: 0.22,
  },
  {
    id: 'frontothalamic_l',
    label: 'Frontal-thalamic L',
    color: 0x8bd3ff,
    from: 'frontal_l',
    to: 'thalamus',
    born: 0.4,
    resilience: 0.4,
    lift: 0.18,
    curvature: 0.28,
  },
  {
    id: 'frontothalamic_r',
    label: 'Frontal-thalamic R',
    color: 0x8bd3ff,
    from: 'frontal_r',
    to: 'thalamus',
    born: 0.4,
    resilience: 0.4,
    lift: 0.18,
    curvature: 0.28,
  },
  {
    id: 'temporal_loop_l',
    label: 'Temporal loop L',
    color: 0xff9ad1,
    from: 'temporal_l',
    to: 'hippocampus_l',
    born: 0.32,
    resilience: 0.34,
    lift: 0.1,
    curvature: 0.24,
  },
  {
    id: 'temporal_loop_r',
    label: 'Temporal loop R',
    color: 0xff9ad1,
    from: 'temporal_r',
    to: 'hippocampus_r',
    born: 0.32,
    resilience: 0.34,
    lift: 0.1,
    curvature: 0.24,
  },
  {
    id: 'posterior_arc',
    label: 'Posterior arc',
    color: 0xffea7a,
    from: 'occipital',
    to: 'parietal',
    born: 0.28,
    resilience: 0.5,
    lift: 0.08,
    curvature: 0.19,
  },
  {
    id: 'stem_axis',
    label: 'Stem axis',
    color: 0xffb86b,
    from: 'brainstem',
    to: 'thalamus',
    born: 0.16,
    resilience: 0.65,
    lift: 0.06,
    curvature: 0.12,
  },
]

const DEFAULT_GENOME: Genome = {
  seed: 26051986,
  size: 0.65,
  symmetry: 0.84,
  foldPressure: 0.72,
  tractAttraction: 0.66,
  pruning: 0.42,
  noise: 0.28,
}

const PRESETS: Record<string, Partial<Genome> & { name: string }> = {
  balanced: {
    name: 'Balanced',
    seed: 26051986,
    size: 0.65,
    symmetry: 0.84,
    foldPressure: 0.72,
    tractAttraction: 0.66,
    pruning: 0.42,
    noise: 0.28,
  },
  foldy: {
    name: 'Foldy',
    seed: 19950721,
    size: 0.72,
    symmetry: 0.76,
    foldPressure: 0.92,
    tractAttraction: 0.74,
    pruning: 0.34,
    noise: 0.46,
  },
  compact: {
    name: 'Compact',
    seed: 12041991,
    size: 0.54,
    symmetry: 0.92,
    foldPressure: 0.38,
    tractAttraction: 0.52,
    pruning: 0.68,
    noise: 0.18,
  },
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hashSeed(value: number) {
  let h = value >>> 0
  h ^= h << 13
  h ^= h >>> 17
  h ^= h << 5
  return h >>> 0
}

function createRng(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function waveNoise(x: number, y: number, z: number, t: number, seed: number) {
  const s = seed * 0.0001
  return (
    Math.sin(x * 7.31 + t * 1.7 + s) +
    Math.sin(y * 8.12 - t * 1.3 + s * 0.7) +
    Math.sin(z * 9.87 + t * 1.1 - s * 1.4) +
    Math.sin((x + y + z) * 4.73 + t * 2.1 + s * 0.3)
  ) * 0.25
}

function influence(direction: THREE.Vector3, center: THREE.Vector3, spread: number) {
  const dx = direction.x - center.x
  const dy = direction.y - center.y
  const dz = direction.z - center.z
  return Math.exp(-(dx * dx + dy * dy + dz * dz) / Math.max(1e-6, spread * spread))
}

function phaseForAge(age: number): PhaseInfo {
  if (age < 0.18) return { name: 'Embryo', summary: 'patterning and early expansion' }
  if (age < 0.42) return { name: 'Lobes', summary: 'regional bulges begin to separate' }
  if (age < 0.72) return { name: 'Folding', summary: 'surface waves and long tracts appear' }
  if (age < 0.92) return { name: 'Pruning', summary: 'weak routes thin out as structure stabilizes' }
  return { name: 'Mature', summary: 'stable adult-like shape' }
}

function addSlider(
  root: HTMLElement,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (next: number) => void
) {
  const labelEl = document.createElement('label')
  labelEl.className = 'gene'

  const heading = document.createElement('span')
  heading.className = 'gene-label'
  heading.textContent = label

  const row = document.createElement('div')
  row.className = 'gene-row'

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)

  const valueEl = document.createElement('span')
  valueEl.className = 'gene-value'
  valueEl.textContent = value.toFixed(2)

  input.addEventListener('input', () => {
    const next = Number(input.value)
    valueEl.textContent = next.toFixed(2)
    onInput(next)
  })

  row.append(input, valueEl)
  labelEl.append(heading, row)
  root.appendChild(labelEl)

  return {
    input,
    valueEl,
    set(next: number) {
      input.value = String(next)
      valueEl.textContent = next.toFixed(2)
    },
  }
}

function pointAtQuadratic(start: THREE.Vector3, control: THREE.Vector3, end: THREE.Vector3, t: number) {
  const a = start.clone().multiplyScalar((1 - t) * (1 - t))
  const b = control.clone().multiplyScalar(2 * (1 - t) * t)
  const c = end.clone().multiplyScalar(t * t)
  return a.add(b).add(c)
}

function phaseColor(start: THREE.Color, end: THREE.Color, t: number) {
  return start.clone().lerp(end, clamp(t, 0, 1))
}

function disposeGroupContents(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
    if (mesh.geometry) {
      mesh.geometry.dispose()
    }
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose()
    } else if (mesh.material) {
      mesh.material.dispose()
    }
  })
  group.clear()
}

function requireElement<T extends Element>(selector: string) {
  const el = document.querySelector<T>(selector)
  if (!el) {
    throw new Error(`Missing ${selector}.`)
  }
  return el
}

export function startGrowthPrototype() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) throw new Error('Missing #app root.')

  app.innerHTML = `
    <header class="growth-header">
      <div>
        <div class="brand">Brain Growth</div>
        <div class="hint">Genome-driven morphogenesis prototype</div>
      </div>
      <div class="growth-phase" id="growthphase">Embryo</div>
    </header>
    <div id="stage">
      <div class="tooltip" id="tooltip"></div>
      <div class="growth-dock">
        <div class="growth-dock-head">
          <div>
            <div class="growth-kicker">Genome</div>
            <div class="growth-title">Grow a brain from a seed</div>
          </div>
          <div class="growth-actions">
            <button type="button" class="chrome-btn" id="growthplay">Pause</button>
            <button type="button" class="chrome-btn chrome-btn-secondary" id="growthreset">Reset</button>
          </div>
        </div>
        <div class="growth-presets" id="growthpresets"></div>
        <label class="gene">
          <span class="gene-label">DNA seed</span>
          <div class="seed-row">
            <input id="growthseed" type="number" value="${DEFAULT_GENOME.seed}" min="1" step="1" />
            <button type="button" class="chrome-btn chrome-btn-secondary" id="growthreroll">Reroll</button>
          </div>
        </label>
        <label class="gene">
          <span class="gene-label">Age</span>
          <div class="gene-row">
            <input id="growthage" type="range" min="0" max="1000" step="1" value="0" />
            <span class="gene-value" id="growthagevalue">0.00</span>
          </div>
        </label>
        <label class="gene">
          <span class="gene-label">Speed</span>
          <div class="gene-row">
            <input id="growthspeed" type="range" min="0" max="1" step="0.01" value="0.28" />
            <span class="gene-value" id="growthspeedvalue">0.28</span>
          </div>
        </label>
        <div class="growth-genegrid" id="growthgenes"></div>
        <div class="growth-note" id="growthnote">A compact genome drives shell growth, regional expansion, and tract pruning.</div>
      </div>
    </div>
  `

  const stage = requireElement<HTMLDivElement>('#stage')
  const tooltip = requireElement<HTMLDivElement>('#tooltip')
  const phaseBadge = requireElement<HTMLDivElement>('#growthphase')
  const playButton = requireElement<HTMLButtonElement>('#growthplay')
  const resetButton = requireElement<HTMLButtonElement>('#growthreset')
  const rerollButton = requireElement<HTMLButtonElement>('#growthreroll')
  const seedInput = requireElement<HTMLInputElement>('#growthseed')
  const ageInput = requireElement<HTMLInputElement>('#growthage')
  const ageValue = requireElement<HTMLSpanElement>('#growthagevalue')
  const speedInput = requireElement<HTMLInputElement>('#growthspeed')
  const speedValue = requireElement<HTMLSpanElement>('#growthspeedvalue')
  const genomeRoot = requireElement<HTMLDivElement>('#growthgenes')
  const presetRoot = requireElement<HTMLDivElement>('#growthpresets')

  const genome: Genome = { ...DEFAULT_GENOME }
  let playing = true
  let age = 0
  let speed = Number(speedInput.value)

  const genomeInputs = {
    size: addSlider(genomeRoot, 'Size', genome.size, 0.3, 1, 0.01, (next) => {
      genome.size = next
      rebuildStructures()
      syncUi()
    }),
    symmetry: addSlider(genomeRoot, 'Symmetry', genome.symmetry, 0, 1, 0.01, (next) => {
      genome.symmetry = next
      rebuildStructures()
      syncUi()
    }),
    foldPressure: addSlider(genomeRoot, 'Fold pressure', genome.foldPressure, 0, 1, 0.01, (next) => {
      genome.foldPressure = next
      syncUi()
    }),
    tractAttraction: addSlider(genomeRoot, 'Tract attraction', genome.tractAttraction, 0, 1, 0.01, (next) => {
      genome.tractAttraction = next
      rebuildStructures()
      syncUi()
    }),
    pruning: addSlider(genomeRoot, 'Pruning', genome.pruning, 0, 1, 0.01, (next) => {
      genome.pruning = next
      syncUi()
    }),
    noise: addSlider(genomeRoot, 'Noise', genome.noise, 0, 1, 0.01, (next) => {
      genome.noise = next
      rebuildStructures()
      syncUi()
    }),
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#05060a')
  scene.fog = new THREE.Fog(0x05060a, 3.25, 10.5)

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100)
  camera.position.set(0.0, 0.18, 3.15)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x05060a, 1)
  stage.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.target.set(0, 0.03, 0)
  controls.minDistance = 1.3
  controls.maxDistance = 8

  const ambient = new THREE.AmbientLight(0x8db1ff, 0.55)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(1.5, 1.1, 2.2)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xffb86b, 0.45)
  rim.position.set(-1.5, -0.5, -1.8)
  scene.add(rim)
  const fill = new THREE.PointLight(0x6fe8ff, 0.7, 12, 2)
  fill.position.set(0, 0.9, 2.4)
  scene.add(fill)

  const root = new THREE.Group()
  scene.add(root)

  const growthRoot = new THREE.Group()
  root.add(growthRoot)

  const shellGroup = new THREE.Group()
  growthRoot.add(shellGroup)
  const regionGroup = new THREE.Group()
  growthRoot.add(regionGroup)
  const tractGroup = new THREE.Group()
  growthRoot.add(tractGroup)

  const shellGeometry = new THREE.SphereGeometry(1, 58, 38)
  shellGeometry.scale(1.08, 0.94, 0.88)
  const shellPositions = shellGeometry.attributes.position as THREE.BufferAttribute
  const shellBase = new Float32Array(shellPositions.array.length)
  shellBase.set(shellPositions.array as Float32Array)

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x22314c,
    roughness: 0.78,
    metalness: 0.06,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  })
  const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial)
  shellGroup.add(shellMesh)

  const coreMesh = new THREE.Mesh(
    shellGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x0d1422,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
  )
  coreMesh.scale.setScalar(0.87)
  shellGroup.add(coreMesh)

  const glowMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.92, 26, 18),
    new THREE.MeshBasicMaterial({
      color: 0x6dc7ff,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  shellGroup.add(glowMesh)

  const vertexMeta = Array.from({ length: shellBase.length / 3 }, (_, index) => {
    const rng = createRng(hashSeed(genome.seed + index * 13))
    return {
      phase: rng() * Math.PI * 2,
      warp: lerp(0.7, 1.35, rng()),
      bias: rng() * 2 - 1,
      lift: lerp(0.4, 1.15, rng()),
    }
  })

  let regionVisuals: RegionVisual[] = []
  let tractVisuals: TractVisual[] = []
  const regionById = new Map<RegionId, RegionVisual>()
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const interactiveObjects: THREE.Object3D[] = []

  function createTractPoints(spec: TractSpec, rng: () => number) {
    const from = regionById.get(spec.from)?.basePosition ?? new THREE.Vector3()
    const to = regionById.get(spec.to)?.basePosition ?? new THREE.Vector3()
    const mid = from.clone().add(to).multiplyScalar(0.5)
    const dir = to.clone().sub(from)
    const lateral = new THREE.Vector3(-dir.y, dir.x, 0)
    if (lateral.lengthSq() < 1e-6) lateral.set(0, 1, 0)
    lateral.normalize()
    const dorsal = new THREE.Vector3(0, 0, 1)
    const tractDirection = dir.clone().normalize()
    const seedJitter = new THREE.Vector3(
      (rng() - 0.5) * 0.06,
      (rng() - 0.5) * 0.05,
      (rng() - 0.5) * 0.05
    )
    const control = mid
      .clone()
      .add(lateral.multiplyScalar(spec.curvature * (0.4 + genome.tractAttraction * 0.9)))
      .add(dorsal.multiplyScalar(spec.lift * (0.25 + genome.foldPressure * 0.7)))
      .add(tractDirection.multiplyScalar((rng() - 0.5) * 0.08))
      .add(seedJitter)

    const points: THREE.Vector3[] = []
    const steps = 24
    for (let i = 0; i < steps; i += 1) {
      points.push(pointAtQuadratic(from, control, to, i / (steps - 1)))
    }
    return points
  }

  function updateShell(ageValue: number) {
    const growth = smoothstep(0.02, 0.38, ageValue)
    const folding = smoothstep(0.28, 0.86, ageValue)
    const strain = smoothstep(0.1, 0.82, ageValue)
    const scale = lerp(0.28, 1, growth) * (0.92 + genome.size * 0.2)
    growthRoot.scale.setScalar(scale)

    const positions = shellGeometry.attributes.position as THREE.BufferAttribute
    const array = positions.array as Float32Array
    const colorStart = new THREE.Color(0x2e466f)
    const colorEnd = new THREE.Color(0x98d6ff)
    const hue = phaseColor(colorStart, colorEnd, smoothstep(0.12, 0.92, ageValue))
    shellMaterial.color.copy(hue)
    shellMaterial.opacity = lerp(0.92, 0.78, growth)
    shellMaterial.roughness = lerp(0.9, 0.68, folding)
    coreMesh.material.opacity = lerp(0.22, 0.06, growth)
    glowMesh.material.opacity = 0.04 + folding * 0.07

    const seed = genome.seed
    const sizeBoost = 0.06 + genome.size * 0.11
    const foldBoost = 0.04 + genome.foldPressure * 0.12
    const noiseBoost = genome.noise * 0.07
    const asymmetry = 1 - genome.symmetry

    for (let i = 0; i < array.length; i += 3) {
      const baseX = shellBase[i]
      const baseY = shellBase[i + 1]
      const baseZ = shellBase[i + 2]
      const dir = new THREE.Vector3(baseX, baseY, baseZ).normalize()
      const meta = vertexMeta[i / 3]

      const anterior = influence(dir, new THREE.Vector3(0, 0.82, 0.16), 0.66)
      const posterior = influence(dir, new THREE.Vector3(0, -0.78, 0.12), 0.64)
      const dorsal = influence(dir, new THREE.Vector3(0, 0.1, 0.82), 0.62)
      const ventral = influence(dir, new THREE.Vector3(0, -0.15, -0.62), 0.54)
      const temporalL = influence(dir, new THREE.Vector3(-0.72, 0, -0.18), 0.5)
      const temporalR = influence(dir, new THREE.Vector3(0.72, 0, -0.18), 0.5)
      const hemisphere = dir.x >= 0 ? 1 : -1

      const wave = waveNoise(dir.x * 1.8 + meta.phase, dir.y * 1.8, dir.z * 1.8, ageValue * 4.3, seed)
      const ridge = Math.sin(dir.y * 8.8 * meta.warp + ageValue * 7.2 + meta.phase)
      const groove = Math.sin(dir.x * 7.1 + dir.z * 9.4 + ageValue * 5.3 + meta.phase * 0.7)
      const foldWave = (ridge + groove + wave) / 3

      const lobeBulge =
        anterior * 0.8 +
        posterior * 0.74 +
        dorsal * 0.9 +
        temporalL * 0.66 +
        temporalR * 0.66 +
        ventral * 0.28

      const leftRight =
        hemisphere * asymmetry * (0.04 + 0.03 * Math.sin(ageValue * 6.2 + meta.bias * 4.1))

      const corticalFold = foldBoost * folding * meta.lift * (0.35 + 0.65 * genome.foldPressure + foldWave * 0.08)
      const irregularity = noiseBoost * wave * (0.55 + genome.noise * 0.45)
      const expansion = sizeBoost + lobeBulge * (0.16 + strain * 0.1) + corticalFold + irregularity + leftRight

      array[i] = dir.x * (1 + expansion)
      array[i + 1] = dir.y * (1 + expansion * 0.94)
      array[i + 2] = dir.z * (1 + expansion * 0.9)
    }

    positions.needsUpdate = true
    shellGeometry.computeVertexNormals()
  }

  function updateRegions(ageValue: number) {
    for (const visual of regionVisuals) {
      const emergence = smoothstep(visual.spec.born, visual.spec.born + 0.2, ageValue)
      const stabilizing = smoothstep(visual.spec.born + 0.08, visual.spec.born + 0.42, ageValue)
      const scale = visual.spec.radius * emergence * (0.4 + genome.size * 0.7)
      visual.mesh.scale.setScalar(scale)
      const material = visual.mesh.material as THREE.MeshStandardMaterial
      material.opacity = clamp(0.02 + emergence * (0.78 - genome.pruning * 0.2), 0, 0.95)
      material.emissiveIntensity = 0.06 + stabilizing * 0.24
      visual.mesh.rotation.y = ageValue * 0.8 + visual.spec.radius
    }
  }

  function updateTracts(ageValue: number) {
    for (const visual of tractVisuals) {
      const emergence = smoothstep(visual.spec.born, visual.spec.born + 0.22, ageValue)
      const pruningCut = clamp(genome.pruning * (0.28 + (1 - visual.spec.resilience) * 0.55), 0, 0.92)
      const keep = clamp(emergence - pruningCut + visual.spec.resilience, 0, 1)
      const progress = clamp(keep * (0.4 + genome.tractAttraction * 0.6), 0, 1)
      const geometry = visual.line.geometry as THREE.BufferGeometry
      const visibleVertices = Math.max(2, Math.floor(visual.points.length * progress))
      geometry.setDrawRange(0, visibleVertices)
      const material = visual.line.material as THREE.LineBasicMaterial
      material.opacity = clamp(progress * (0.18 + genome.tractAttraction * 0.52), 0, 0.95)
      material.color.copy(new THREE.Color(visual.spec.color)).offsetHSL(0, 0, genome.noise * 0.06)
      visual.line.scale.setScalar(1 + genome.noise * 0.08)
    }
  }

  function updateStageBadge(ageValue: number) {
    const phase = phaseForAge(ageValue)
    phaseBadge.textContent = `${phase.name} • ${Math.round(ageValue * 100)}%`
    const note = document.querySelector<HTMLDivElement>('#growthnote')
    if (note) {
      note.textContent = phase.summary
    }
  }

  function syncUi() {
    seedInput.value = String(Math.max(1, Math.round(genome.seed)))
    ageInput.value = String(Math.round(age * 1000))
    ageValue.textContent = age.toFixed(2)
    speedValue.textContent = speed.toFixed(2)
    playButton.textContent = playing ? 'Pause' : 'Play'
    updateStageBadge(age)
    genomeInputs.size.set(genome.size)
    genomeInputs.symmetry.set(genome.symmetry)
    genomeInputs.foldPressure.set(genome.foldPressure)
    genomeInputs.tractAttraction.set(genome.tractAttraction)
    genomeInputs.pruning.set(genome.pruning)
    genomeInputs.noise.set(genome.noise)
  }

  function rebuildStructures() {
    // Preserve the current adult-ish shape while refreshing seeded placement and tracts.
    const currentAge = age
    const currentPlaying = playing
    disposeGroupContents(regionGroup)
    disposeGroupContents(tractGroup)
    regionById.clear()
    interactiveObjects.length = 0
    regionVisuals = []
    tractVisuals = []
    const rng = createRng(hashSeed(genome.seed))
    const symmetrySkew = 1 - genome.symmetry

    for (const spec of REGION_SPECS) {
      const regionGeo = new THREE.SphereGeometry(spec.radius, 18, 14)
      const material = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.52,
        metalness: 0.06,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        emissive: new THREE.Color(spec.color),
        emissiveIntensity: 0.08,
      })
      const mesh = new THREE.Mesh(regionGeo, material)
      mesh.name = spec.label
      const base = new THREE.Vector3(spec.base[0], spec.base[1], spec.base[2])
      const jitter = new THREE.Vector3(
        (rng() - 0.5) * 0.08 * (1 + symmetrySkew * 0.5),
        (rng() - 0.5) * 0.05,
        (rng() - 0.5) * 0.06
      )
      if (spec.id.endsWith('_l')) jitter.x -= symmetrySkew * 0.05
      if (spec.id.endsWith('_r')) jitter.x += symmetrySkew * 0.05
      const position = base.add(jitter)
      mesh.position.copy(position)
      mesh.userData = { label: spec.label }
      regionGroup.add(mesh)
      interactiveObjects.push(mesh)
      const visual = { spec, mesh, basePosition: position.clone() }
      regionVisuals.push(visual)
      regionById.set(spec.id, visual)
    }

    for (const spec of TRACT_SPECS) {
      const points = createTractPoints(spec, rng)
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      )
      line.userData = { label: spec.label }
      tractGroup.add(line)
      interactiveObjects.push(line)
      const visual = { spec, line, points, random: rng() }
      tractVisuals.push(visual)
    }

    age = currentAge
    playing = currentPlaying
    syncUi()
  }

  function applyGenomeToMesh() {
    updateShell(age)
    updateRegions(age)
    updateTracts(age)
    controls.target.set(0, 0.03, 0)
  }

  function setPreset(key: keyof typeof PRESETS) {
    const preset = PRESETS[key]
    genome.seed = preset.seed ?? genome.seed
    genome.size = preset.size ?? genome.size
    genome.symmetry = preset.symmetry ?? genome.symmetry
    genome.foldPressure = preset.foldPressure ?? genome.foldPressure
    genome.tractAttraction = preset.tractAttraction ?? genome.tractAttraction
    genome.pruning = preset.pruning ?? genome.pruning
    genome.noise = preset.noise ?? genome.noise
    rebuildStructures()
    syncUi()
  }

  for (const [key, preset] of Object.entries(PRESETS)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chrome-btn chrome-btn-secondary growth-preset'
    button.textContent = preset.name
    button.addEventListener('click', () => setPreset(key as keyof typeof PRESETS))
    presetRoot.appendChild(button)
  }

  const setPlaying = (next: boolean) => {
    playing = next
    syncUi()
  }

  playButton.addEventListener('click', () => setPlaying(!playing))
  resetButton.addEventListener('click', () => {
    age = 0
    setPlaying(true)
    syncUi()
    applyGenomeToMesh()
  })
  rerollButton.addEventListener('click', () => {
    genome.seed = Math.floor(Math.random() * 1_000_000_000) + 1
    rebuildStructures()
    applyGenomeToMesh()
  })
  seedInput.addEventListener('input', () => {
    const next = Number(seedInput.value)
    if (Number.isFinite(next)) {
      genome.seed = Math.max(1, Math.floor(next))
      rebuildStructures()
      applyGenomeToMesh()
    }
  })
  ageInput.addEventListener('input', () => {
    age = Number(ageInput.value) / 1000
    applyGenomeToMesh()
    syncUi()
  })
  speedInput.addEventListener('input', () => {
    speed = Number(speedInput.value)
    syncUi()
  })

  function hoverLabels(ev: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -(((ev.clientY - rect.top) / rect.height) * 2 - 1))
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(interactiveObjects, true)
    if (hits.length === 0) {
      tooltip.style.display = 'none'
      renderer.domElement.style.cursor = 'grab'
      return
    }
    const label = (hits[0].object as any).userData?.label ?? (hits[0].object.parent as any)?.userData?.label
    if (!label) {
      tooltip.style.display = 'none'
      renderer.domElement.style.cursor = 'grab'
      return
    }
    tooltip.textContent = label
    tooltip.style.display = 'block'
    tooltip.style.left = `${ev.clientX - rect.left + 12}px`
    tooltip.style.top = `${ev.clientY - rect.top + 12}px`
    renderer.domElement.style.cursor = 'pointer'
  }

  renderer.domElement.addEventListener('pointermove', hoverLabels)
  renderer.domElement.addEventListener('pointerleave', () => {
    tooltip.style.display = 'none'
    renderer.domElement.style.cursor = 'grab'
  })

  stage.addEventListener('pointerdown', () => {
    renderer.domElement.style.cursor = 'grabbing'
  })
  stage.addEventListener('pointerup', () => {
    renderer.domElement.style.cursor = 'grab'
  })

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space') {
      ev.preventDefault()
      setPlaying(!playing)
    }
    if (ev.key.toLowerCase() === 'r') {
      genome.seed = Math.floor(Math.random() * 1_000_000_000) + 1
      rebuildStructures()
      applyGenomeToMesh()
    }
  })

  function onResize() {
    const width = stage.clientWidth
    const height = stage.clientHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  new ResizeObserver(onResize).observe(stage)

  rebuildStructures()
  syncUi()
  onResize()
  applyGenomeToMesh()

  let lastTime = performance.now()
  function frame(now: number) {
    const dt = Math.min(0.05, (now - lastTime) / 1000)
    lastTime = now
    if (playing) {
      age = clamp(age + dt * speed * 0.08, 0, 1)
      if (age >= 1) playing = false
      applyGenomeToMesh()
      syncUi()
    }
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
