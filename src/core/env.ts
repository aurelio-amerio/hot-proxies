export interface TextMetricsLike { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number }
export interface ImageDataLike { width: number; height: number; data: Uint8ClampedArray }

export interface Ctx2D {
  font: string
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  textBaseline: string
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): TextMetricsLike
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(path?: unknown): void
  stroke(): void
  clip(): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  drawImage(image: unknown, dx: number, dy: number, dw?: number, dh?: number): void
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike
}

export interface CanvasLike { width: number; height: number; getContext(type: '2d'): Ctx2D }

export interface RenderEnv {
  createCanvas(w: number, h: number): CanvasLike
  createPath(d: string): unknown
}
