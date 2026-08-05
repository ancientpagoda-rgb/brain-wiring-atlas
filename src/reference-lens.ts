import * as nifti from 'nifti-reader-js'

export type AtlasSliceAxis = 0 | 1 | 2

export const AXIS_LABELS: Record<AtlasSliceAxis, string> = {
  0: 'Sagittal',
  1: 'Coronal',
  2: 'Axial',
}

export type AtlasSourceKind = 'labels' | 'mask'

export type AtlasSource = {
  id: string
  family: string
  name: string
  summary: string
  citation: string
  volumeUrl: string
  labelTableUrl?: string
  kind: AtlasSourceKind
  defaultAxis: AtlasSliceAxis
  defaultSliceRatio: number
  accentColor: string
}

export type AtlasLabel = {
  value: number
  name: string
  color: [number, number, number]
}

export type LoadedAtlas = {
  source: AtlasSource
  dims: [number, number, number]
  values:
    | Uint8Array
    | Int8Array
    | Uint16Array
    | Int16Array
    | Uint32Array
    | Int32Array
    | Float32Array
    | Float64Array
  labels: Map<number, AtlasLabel>
  maxValue: number
}

export type SliceSummary = {
  axis: AtlasSliceAxis
  sliceIndex: number
  width: number
  height: number
  coverage: number
  nonZeroVoxels: number
  dominantLabels: Array<AtlasLabel & { count: number }>
}

const SUBCORTEX_PREFIX_COLORS: Record<string, [number, number, number]> = {
  AMY: [244, 114, 182],
  AGP: [140, 198, 63],
  CAU: [59, 130, 246],
  GP: [132, 204, 22],
  HIP: [249, 115, 22],
  NAC: [236, 72, 153],
  PUT: [6, 182, 212],
  PGP: [100, 181, 63],
  THA: [168, 85, 247],
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace('#', '')
  if (normalized.length !== 6) return [255, 255, 255]
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if ([r, g, b].some((value) => Number.isNaN(value))) return [255, 255, 255]
  return [r, g, b]
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const mix = clamp(t, 0, 1)
  return [
    Math.round(a[0] + (b[0] - a[0]) * mix),
    Math.round(a[1] + (b[1] - a[1]) * mix),
    Math.round(a[2] + (b[2] - a[2]) * mix),
  ]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360 / 360
  const sat = clamp(s, 0, 1)
  const light = clamp(l, 0, 1)

  if (sat === 0) {
    const gray = Math.round(light * 255)
    return [gray, gray, gray]
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const hueToRgb = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }

  return [
    Math.round(hueToRgb(hue + 1 / 3) * 255),
    Math.round(hueToRgb(hue) * 255),
    Math.round(hueToRgb(hue - 1 / 3) * 255),
  ]
}

function paletteFromIndex(index: number): [number, number, number] {
  const hue = (index * 137.508) % 360
  return hslToRgb(hue, 0.62, 0.55)
}

function colorFromSubcortexName(name: string, index: number): [number, number, number] {
  const prefix = name.split(/[-_]/)[0]?.toUpperCase() ?? ''
  const mapped = SUBCORTEX_PREFIX_COLORS[prefix]
  return mapped ?? paletteFromIndex(index)
}

function prettifyLabel(name: string) {
  return name.replace(/_/g, ' ').replace(/-/g, ' ')
}

function fetchArrayBuffer(url: string) {
  return fetch(url).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Failed to load atlas asset (${res.status}): ${url}`)
    }
    return res.arrayBuffer()
  })
}

function fetchText(url: string) {
  return fetch(url).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Failed to load atlas asset (${res.status}): ${url}`)
    }
    return res.text()
  })
}

function readTypedArray(header: nifti.NIFTI1 | nifti.NIFTI2, image: ArrayBuffer) {
  switch (header.datatypeCode) {
    case nifti.NIFTI1.TYPE_UINT8:
      return new Uint8Array(image)
    case nifti.NIFTI1.TYPE_INT8:
      return new Int8Array(image)
    case nifti.NIFTI1.TYPE_UINT16:
      return new Uint16Array(image)
    case nifti.NIFTI1.TYPE_INT16:
      return new Int16Array(image)
    case nifti.NIFTI1.TYPE_UINT32:
      return new Uint32Array(image)
    case nifti.NIFTI1.TYPE_INT32:
      return new Int32Array(image)
    case nifti.NIFTI1.TYPE_FLOAT32:
      return new Float32Array(image)
    case nifti.NIFTI1.TYPE_FLOAT64:
      return new Float64Array(image)
    default:
      return new Uint8Array(image)
  }
}

function parseLabelTable(text: string) {
  const labels = new Map<number, AtlasLabel>()
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (lines.length === 0) return labels

  const firstLine = lines[0].split(/\t+/)
  const looksLikeIndexedTable = Number.isFinite(Number(firstLine[0])) && firstLine.length >= 2

  if (looksLikeIndexedTable) {
    for (const line of lines) {
      const cols = line.split(/\t+/).map((value) => value.trim())
      const value = Number(cols[0])
      if (!Number.isFinite(value)) continue
      const name = prettifyLabel(cols[1] ?? String(value))
      const r = Number(cols[2])
      const g = Number(cols[3])
      const b = Number(cols[4])
      const color = [r, g, b].every((component) => Number.isFinite(component))
        ? [r, g, b] as [number, number, number]
        : paletteFromIndex(value)
      labels.set(value, { value, name, color })
    }
    return labels
  }

  lines.forEach((line, index) => {
    const value = index + 1
    const name = prettifyLabel(line)
    labels.set(value, {
      value,
      name,
      color: colorFromSubcortexName(name, value),
    })
  })

  return labels
}

export async function loadAtlasSource(source: AtlasSource): Promise<LoadedAtlas> {
  const rawData = await fetchArrayBuffer(source.volumeUrl)
  const data = nifti.isCompressed(rawData) ? ((await nifti.decompressAsync(rawData)) as ArrayBuffer) : rawData

  if (!nifti.isNIFTI(data)) {
    throw new Error(`Atlas volume is not a NIfTI file: ${source.volumeUrl}`)
  }

  const header = nifti.readHeader(data)
  const image = nifti.readImage(header, data)
  const values = readTypedArray(header, image)

  const dims: [number, number, number] = [
    Math.max(1, header.dims[1] ?? 1),
    Math.max(1, header.dims[2] ?? 1),
    Math.max(1, header.dims[3] ?? 1),
  ]

  const labels = source.labelTableUrl ? parseLabelTable(await fetchText(source.labelTableUrl)) : new Map<number, AtlasLabel>()

  let maxValue = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value > maxValue) maxValue = value
  }

  return {
    source,
    dims,
    values,
    labels,
    maxValue,
  }
}

export function renderAtlasSlice(
  canvas: HTMLCanvasElement,
  atlas: LoadedAtlas,
  axis: AtlasSliceAxis,
  sliceRatio: number,
  threshold: number
): SliceSummary {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not get 2D context for detail canvas.')
  }

  const [nx, ny, nz] = atlas.dims
  const sliceCounts = [nx, ny, nz] as const
  const sliceCount = sliceCounts[axis]
  const sliceIndex = clamp(Math.round(clamp(sliceRatio, 0, 1) * (sliceCount - 1)), 0, sliceCount - 1)

  const outputWidth = Math.max(1, canvas.width)
  const outputHeight = Math.max(1, canvas.height)
  const imageData = ctx.createImageData(outputWidth, outputHeight)
  const pixels = imageData.data
  const counts = new Map<number, number>()

  const background: [number, number, number] = [6, 10, 18]
  const accent = hexToRgb(atlas.source.accentColor)
  const labelMode = atlas.source.kind === 'labels'
  let nonZeroVoxels = 0
  const planeWidth = axis === 0 ? ny : nx
  const planeHeight = axis === 0 ? nz : axis === 1 ? nz : ny

  for (let py = 0; py < outputHeight; py += 1) {
    const sy = outputHeight === 1 ? 0 : 1 - py / (outputHeight - 1)
    const vIndex = clamp(Math.round(sy * (planeHeight - 1)), 0, planeHeight - 1)

    for (let px = 0; px < outputWidth; px += 1) {
      const sx = outputWidth === 1 ? 0 : px / (outputWidth - 1)
      const uIndex = clamp(Math.round(sx * (planeWidth - 1)), 0, planeWidth - 1)

      const rawValue =
        axis === 0
          ? atlas.values[sliceIndex + nx * (uIndex + ny * vIndex)] ?? 0
          : axis === 1
            ? atlas.values[uIndex + nx * (sliceIndex + ny * vIndex)] ?? 0
            : atlas.values[uIndex + nx * (vIndex + ny * sliceIndex)] ?? 0

      const offset = (py * outputWidth + px) * 4

      if (labelMode) {
        const labelValue = Math.round(rawValue)
        const label = atlas.labels.get(labelValue)
        if (labelValue > 0) {
          nonZeroVoxels += 1
          counts.set(labelValue, (counts.get(labelValue) ?? 0) + 1)
          const color = label?.color ?? paletteFromIndex(labelValue)
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = 235
        } else {
          pixels[offset] = background[0]
          pixels[offset + 1] = background[1]
          pixels[offset + 2] = background[2]
          pixels[offset + 3] = 255
        }
        continue
      }

      const normalized = atlas.maxValue > 0 ? clamp(rawValue / atlas.maxValue, 0, 1) : 0
      const alpha = clamp((normalized - threshold) / Math.max(1e-6, 1 - threshold), 0, 1)

      if (alpha > 0) nonZeroVoxels += 1
      const color = mixRgb(background, accent, Math.max(normalized, alpha))
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }

  ctx.putImageData(imageData, 0, 0)

  const dominantLabels = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([value, count]) => {
      const label = atlas.labels.get(value)
      return {
        value,
        name: label?.name ?? `Label ${value}`,
        color: label?.color ?? paletteFromIndex(value),
        count,
      }
    })

  return {
    axis,
    sliceIndex,
    width: outputWidth,
    height: outputHeight,
    coverage: outputWidth * outputHeight > 0 ? nonZeroVoxels / (outputWidth * outputHeight) : 0,
    nonZeroVoxels,
    dominantLabels,
  }
}
