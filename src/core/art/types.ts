/** Greyscale image, values 0 (black) .. 1 (white). */
export interface GreyImage { width: number; height: number; data: Float32Array }
/** 1-bit image, 1 = black. */
export interface BitImage { width: number; height: number; bits: Uint8Array }
