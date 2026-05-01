export interface DecodedFrame {
  yuv: Uint8Array;
  width: number;
  height: number;
}

interface OpenH264Module {
  _decoder_init(): number;
  _decoder_feed(ptr: number, len: number): number;
  _decoder_flush(): number;
  _decoder_destroy(): void;
  _get_has_frame(): number;
  _get_width(): number;
  _get_height(): number;
  _get_y_stride(): number;
  _get_uv_stride(): number;
  _get_y_ptr(): number;
  _get_u_ptr(): number;
  _get_v_ptr(): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

const START_CODE = new Uint8Array([0x00, 0x00, 0x00, 0x01]);

function buildAnnexB(
  sps: Uint8Array,
  pps: Uint8Array,
  idr: Uint8Array
): Uint8Array {
  const len = START_CODE.length * 3 + sps.length + pps.length + idr.length;
  const buf = new Uint8Array(len);
  let off = 0;
  buf.set(START_CODE, off);
  off += START_CODE.length;
  buf.set(sps, off);
  off += sps.length;
  buf.set(START_CODE, off);
  off += START_CODE.length;
  buf.set(pps, off);
  off += pps.length;
  buf.set(START_CODE, off);
  off += START_CODE.length;
  buf.set(idr, off);
  return buf;
}

function extractPlanarYUV(
  mod: OpenH264Module,
  width: number,
  height: number
): Uint8Array {
  const yStride = mod._get_y_stride();
  const uvStride = mod._get_uv_stride();
  const yPtr = mod._get_y_ptr();
  const uPtr = mod._get_u_ptr();
  const vPtr = mod._get_v_ptr();

  const chromaW = width >> 1;
  const chromaH = height >> 1;
  const ySize = width * height;
  const cSize = chromaW * chromaH;
  const out = new Uint8Array(ySize + cSize * 2);

  const heap = mod.HEAPU8;

  for (let y = 0; y < height; y++) {
    out.set(
      heap.subarray(yPtr + y * yStride, yPtr + y * yStride + width),
      y * width
    );
  }

  const cbOff = ySize;
  for (let y = 0; y < chromaH; y++) {
    out.set(
      heap.subarray(uPtr + y * uvStride, uPtr + y * uvStride + chromaW),
      cbOff + y * chromaW
    );
  }

  const crOff = cbOff + cSize;
  for (let y = 0; y < chromaH; y++) {
    out.set(
      heap.subarray(vPtr + y * uvStride, vPtr + y * uvStride + chromaW),
      crOff + y * chromaW
    );
  }

  return out;
}

let modulePromise: Promise<OpenH264Module> | null = null;

function getModule(): Promise<OpenH264Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { readFileSync } = await import("fs");
      const wasmPath: string = (await import("./openh264.wasm")).default;
      const wasmBinary = readFileSync(wasmPath);
      const factory = (await import("./openh264.mjs")).default;
      return factory({
        wasmBinary,
        print: () => {},
        printErr: () => {},
      }) as Promise<OpenH264Module>;
    })();
  }
  return modulePromise;
}

export async function decodeIDR(
  sps: Uint8Array,
  pps: Uint8Array,
  sliceData: Uint8Array
): Promise<DecodedFrame | null> {
  if (!sps.length || !pps.length || !sliceData.length) return null;

  const mod = await getModule();
  const annexB = buildAnnexB(sps, pps, sliceData);

  if (mod._decoder_init() !== 0) return null;

  let ptr = 0;
  try {
    ptr = mod._malloc(annexB.length);
    if (!ptr) {
      mod._decoder_destroy();
      return null;
    }
    mod.HEAPU8.set(annexB, ptr);

    mod._decoder_feed(ptr, annexB.length);

    if (!mod._get_has_frame()) {
      mod._decoder_feed(0, 0);
    }
    if (!mod._get_has_frame()) {
      mod._decoder_flush();
    }
    if (!mod._get_has_frame()) {
      mod._free(ptr);
      mod._decoder_destroy();
      return null;
    }

    const width = mod._get_width();
    const height = mod._get_height();
    const yuv = extractPlanarYUV(mod, width, height);

    mod._free(ptr);
    mod._decoder_destroy();
    return { yuv, width, height };
  } catch {
    if (ptr) mod._free(ptr);
    try {
      mod._decoder_destroy();
    } catch {
      /* best-effort */
    }
    return null;
  }
}
