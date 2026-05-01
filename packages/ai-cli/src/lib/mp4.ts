export interface KeyframeData {
  sps: Uint8Array;
  pps: Uint8Array;
  sliceData: Uint8Array;
  width: number;
  height: number;
}

interface Box {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

function readBoxHeader(view: DataView, offset: number): Box | null {
  if (offset + 8 > view.byteLength) return null;
  let size = view.getUint32(offset);
  const type = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7)
  );
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > view.byteLength) return null;
    size = Number(view.getBigUint64(offset + 8));
    headerSize = 16;
  } else if (size === 0) {
    size = view.byteLength - offset;
  }
  return { type, offset, size, headerSize };
}

function findBox(
  view: DataView,
  start: number,
  end: number,
  type: string
): Box | null {
  let offset = start;
  while (offset < end) {
    const box = readBoxHeader(view, offset);
    if (!box || box.size < 8) return null;
    if (box.type === type) return box;
    offset += box.size;
  }
  return null;
}

function findBoxPath(
  view: DataView,
  start: number,
  end: number,
  path: string[]
): Box | null {
  let box: Box | null = null;
  let s = start;
  let e = end;
  for (const type of path) {
    box = findBox(view, s, e, type);
    if (!box) return null;
    s = box.offset + box.headerSize;
    e = box.offset + box.size;
    if (
      type === "stsd" ||
      type === "stbl" ||
      type === "minf" ||
      type === "mdia" ||
      type === "trak" ||
      type === "moov"
    ) {
      // full boxes with version/flags
    }
  }
  return box;
}

function isVideoTrack(
  view: DataView,
  trakStart: number,
  trakEnd: number
): boolean {
  const mdia = findBox(view, trakStart, trakEnd, "mdia");
  if (!mdia) return false;
  const hdlr = findBox(
    view,
    mdia.offset + mdia.headerSize,
    mdia.offset + mdia.size,
    "hdlr"
  );
  if (!hdlr) return false;
  const hdlrData = hdlr.offset + hdlr.headerSize;
  if (hdlrData + 12 > view.byteLength) return false;
  // version(1) + flags(3) + pre_defined(4) + handler_type(4)
  const handlerType = String.fromCharCode(
    view.getUint8(hdlrData + 8),
    view.getUint8(hdlrData + 9),
    view.getUint8(hdlrData + 10),
    view.getUint8(hdlrData + 11)
  );
  return handlerType === "vide";
}

function findVideoTrack(
  view: DataView,
  moovStart: number,
  moovEnd: number
): Box | null {
  let offset = moovStart;
  while (offset < moovEnd) {
    const box = readBoxHeader(view, offset);
    if (!box || box.size < 8) break;
    if (box.type === "trak") {
      if (
        isVideoTrack(view, box.offset + box.headerSize, box.offset + box.size)
      ) {
        return box;
      }
    }
    offset += box.size;
  }
  return null;
}

interface AvcCData {
  sps: Uint8Array;
  pps: Uint8Array;
  nalLengthSize: number;
}

function parseAvcC(
  buf: Uint8Array,
  offset: number,
  size: number
): AvcCData | null {
  if (size < 8) return null;
  const view = new DataView(buf.buffer, buf.byteOffset + offset, size);
  const version = view.getUint8(0);
  if (version !== 1) return null;
  const nalLengthSize = (view.getUint8(4) & 0x03) + 1;
  const numSPS = view.getUint8(5) & 0x1f;
  if (numSPS < 1) return null;

  let pos = 6;
  const spsLen = view.getUint16(pos);
  pos += 2;
  if (pos + spsLen > size) return null;
  const sps = buf.slice(offset + pos, offset + pos + spsLen);
  pos += spsLen;

  // skip remaining SPS entries
  for (let i = 1; i < numSPS; i++) {
    const len = view.getUint16(pos);
    pos += 2 + len;
  }

  const numPPS = view.getUint8(pos);
  pos += 1;
  if (numPPS < 1) return null;
  const ppsLen = view.getUint16(pos);
  pos += 2;
  if (pos + ppsLen > size) return null;
  const pps = buf.slice(offset + pos, offset + pos + ppsLen);

  return { sps, pps, nalLengthSize };
}

function readStsdAvcC(
  view: DataView,
  buf: Uint8Array,
  stsdOffset: number,
  stsdSize: number
): AvcCData | null {
  // stsd full box payload: version(1)+flags(3) + entry_count(4) + entries
  if (stsdSize < 8) return null;
  const entryCount = view.getUint32(stsdOffset + 4);
  if (entryCount < 1) return null;

  let entryOffset = stsdOffset + 8;
  const entrySize = view.getUint32(entryOffset);
  const entryType = String.fromCharCode(
    view.getUint8(entryOffset + 4),
    view.getUint8(entryOffset + 5),
    view.getUint8(entryOffset + 6),
    view.getUint8(entryOffset + 7)
  );

  if (entryType !== "avc1" && entryType !== "avc3") return null;

  // avc1 box: SampleEntry(8) + VisualSampleEntry(70) = 78 bytes fixed after box header
  const childrenStart = entryOffset + 8 + 78;
  const childrenEnd = entryOffset + entrySize;

  let pos = childrenStart;
  while (pos + 8 <= childrenEnd) {
    const childBox = readBoxHeader(view, pos);
    if (!childBox || childBox.size < 8) break;
    if (childBox.type === "avcC") {
      return parseAvcC(
        buf,
        childBox.offset + childBox.headerSize,
        childBox.size - childBox.headerSize
      );
    }
    pos += childBox.size;
  }
  return null;
}

function readUint32Array(
  view: DataView,
  offset: number,
  count: number
): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) {
    arr.push(view.getUint32(offset + i * 4));
  }
  return arr;
}

interface SampleTableInfo {
  syncSamples: number[] | null;
  sampleSizes: number[];
  sampleToChunk: Array<{
    firstChunk: number;
    samplesPerChunk: number;
    sdi: number;
  }>;
  chunkOffsets: number[];
  totalSamples: number;
}

function readSampleTable(
  view: DataView,
  stblStart: number,
  stblEnd: number
): SampleTableInfo | null {
  // stss (sync sample)
  let syncSamples: number[] | null = null;
  const stss = findBox(view, stblStart, stblEnd, "stss");
  if (stss) {
    const d = stss.offset + stss.headerSize;
    const count = view.getUint32(d + 4);
    syncSamples = readUint32Array(view, d + 8, count);
  }

  // stsz (sample size)
  const stsz = findBox(view, stblStart, stblEnd, "stsz");
  if (!stsz) return null;
  const stszData = stsz.offset + stsz.headerSize;
  const uniformSize = view.getUint32(stszData + 4);
  const sampleCount = view.getUint32(stszData + 8);
  let sampleSizes: number[];
  if (uniformSize !== 0) {
    sampleSizes = Array.from({ length: sampleCount }, () => uniformSize);
  } else {
    sampleSizes = readUint32Array(view, stszData + 12, sampleCount);
  }

  // stsc (sample-to-chunk)
  const stsc = findBox(view, stblStart, stblEnd, "stsc");
  if (!stsc) return null;
  const stscData = stsc.offset + stsc.headerSize;
  const stscCount = view.getUint32(stscData + 4);
  const sampleToChunk: SampleTableInfo["sampleToChunk"] = [];
  for (let i = 0; i < stscCount; i++) {
    const off = stscData + 8 + i * 12;
    sampleToChunk.push({
      firstChunk: view.getUint32(off),
      samplesPerChunk: view.getUint32(off + 4),
      sdi: view.getUint32(off + 8),
    });
  }

  // stco or co64 (chunk offsets)
  let chunkOffsets: number[];
  const stco = findBox(view, stblStart, stblEnd, "stco");
  if (stco) {
    const stcoData = stco.offset + stco.headerSize;
    const chunkCount = view.getUint32(stcoData + 4);
    chunkOffsets = readUint32Array(view, stcoData + 8, chunkCount);
  } else {
    const co64 = findBox(view, stblStart, stblEnd, "co64");
    if (!co64) return null;
    const co64Data = co64.offset + co64.headerSize;
    const chunkCount = view.getUint32(co64Data + 4);
    chunkOffsets = [];
    for (let i = 0; i < chunkCount; i++) {
      chunkOffsets.push(Number(view.getBigUint64(co64Data + 8 + i * 8)));
    }
  }

  return {
    syncSamples,
    sampleSizes,
    sampleToChunk,
    chunkOffsets,
    totalSamples: sampleCount,
  };
}

function computeSampleOffset(
  info: SampleTableInfo,
  sampleIndex: number
): number {
  // sampleIndex is 0-based
  let chunkIndex = 0;
  let sampleInChunk = 0;
  let currentSample = 0;

  for (let i = 0; i < info.sampleToChunk.length; i++) {
    const entry = info.sampleToChunk[i];
    const nextFirstChunk =
      i + 1 < info.sampleToChunk.length
        ? info.sampleToChunk[i + 1].firstChunk
        : info.chunkOffsets.length + 1;
    const chunksInRun = nextFirstChunk - entry.firstChunk;

    for (let c = 0; c < chunksInRun; c++) {
      const chunk = entry.firstChunk - 1 + c;
      if (currentSample + entry.samplesPerChunk > sampleIndex) {
        chunkIndex = chunk;
        sampleInChunk = sampleIndex - currentSample;

        let offset = info.chunkOffsets[chunkIndex];
        for (let s = 0; s < sampleInChunk; s++) {
          offset += info.sampleSizes[currentSample + s];
        }
        return offset;
      }
      currentSample += entry.samplesPerChunk;
    }
  }

  return info.chunkOffsets[chunkIndex] ?? 0;
}

export function extractKeyframe(buf: Uint8Array): KeyframeData | null {
  if (buf.length < 8) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const moov = findBox(view, 0, buf.length, "moov");
  if (!moov) return null;

  const moovStart = moov.offset + moov.headerSize;
  const moovEnd = moov.offset + moov.size;

  const trak = findVideoTrack(view, moovStart, moovEnd);
  if (!trak) return null;
  const trakStart = trak.offset + trak.headerSize;
  const trakEnd = trak.offset + trak.size;

  // Navigate to stbl
  const mdia = findBox(view, trakStart, trakEnd, "mdia");
  if (!mdia) return null;
  const minf = findBox(
    view,
    mdia.offset + mdia.headerSize,
    mdia.offset + mdia.size,
    "minf"
  );
  if (!minf) return null;
  const stbl = findBox(
    view,
    minf.offset + minf.headerSize,
    minf.offset + minf.size,
    "stbl"
  );
  if (!stbl) return null;
  const stblStart = stbl.offset + stbl.headerSize;
  const stblEnd = stbl.offset + stbl.size;

  // Get stsd for avcC
  const stsd = findBox(view, stblStart, stblEnd, "stsd");
  if (!stsd) return null;
  const avcC = readStsdAvcC(
    view,
    buf,
    stsd.offset + stsd.headerSize,
    stsd.size - stsd.headerSize
  );
  if (!avcC) return null;

  const tableInfo = readSampleTable(view, stblStart, stblEnd);
  if (!tableInfo || tableInfo.totalSamples === 0) return null;

  // Pick keyframe closest to midpoint
  let targetSample: number;
  const midSample = Math.floor(tableInfo.totalSamples / 2);
  if (tableInfo.syncSamples && tableInfo.syncSamples.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < tableInfo.syncSamples.length; i++) {
      const dist = Math.abs(tableInfo.syncSamples[i] - 1 - midSample);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    targetSample = tableInfo.syncSamples[bestIdx] - 1; // convert to 0-based
  } else {
    // No stss means every sample is a sync sample
    targetSample = midSample;
  }

  if (targetSample < 0 || targetSample >= tableInfo.totalSamples) return null;

  const sampleOffset = computeSampleOffset(tableInfo, targetSample);
  const sampleSize = tableInfo.sampleSizes[targetSample];
  if (sampleOffset + sampleSize > buf.length) return null;

  // Find the IDR slice NAL (type 5) among the length-prefixed NALUs
  const idrNal = findIDRNal(buf, sampleOffset, sampleSize, avcC.nalLengthSize);
  if (!idrNal) return null;

  const dims = parseSPSDimensions(avcC.sps);

  return {
    sps: avcC.sps,
    pps: avcC.pps,
    sliceData: idrNal,
    width: dims?.width ?? 0,
    height: dims?.height ?? 0,
  };
}

function findIDRNal(
  buf: Uint8Array,
  offset: number,
  size: number,
  nalLengthSize: number
): Uint8Array | null {
  let pos = offset;
  const end = offset + size;

  while (pos + nalLengthSize <= end) {
    let nalLen = 0;
    for (let i = 0; i < nalLengthSize; i++) {
      nalLen = (nalLen << 8) | buf[pos + i];
    }
    pos += nalLengthSize;
    if (pos + nalLen > end) break;

    const nalType = buf[pos] & 0x1f;
    if (nalType === 5) {
      return buf.slice(pos, pos + nalLen);
    }
    pos += nalLen;
  }
  return null;
}

function parseSPSDimensions(
  sps: Uint8Array
): { width: number; height: number } | null {
  if (sps.length < 4) return null;
  // Simple Exp-Golomb reader
  let bitPos = 0;
  const totalBits = sps.length * 8;

  function readBit(): number {
    if (bitPos >= totalBits) return 0;
    const byte = sps[bitPos >> 3];
    const bit = (byte >> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return bit;
  }

  function readBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) val = (val << 1) | readBit();
    return val;
  }

  function readUE(): number {
    let zeros = 0;
    while (readBit() === 0 && zeros < 32) zeros++;
    if (zeros === 0) return 0;
    return (1 << zeros) - 1 + readBits(zeros);
  }

  // NAL header: forbidden_zero_bit(1) + nal_ref_idc(2) + nal_unit_type(5)
  readBits(8);
  const profileIdc = readBits(8);
  readBits(8); // constraint flags
  readBits(8); // level_idc
  readUE(); // seq_parameter_set_id

  if (
    [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134].includes(
      profileIdc
    )
  ) {
    const chromaFormat = readUE();
    if (chromaFormat === 3) readBit(); // separate_colour_plane_flag
    readUE(); // bit_depth_luma_minus8
    readUE(); // bit_depth_chroma_minus8
    readBit(); // qpprime_y_zero_transform_bypass_flag
    const scalingMatrixPresent = readBit();
    if (scalingMatrixPresent) {
      const count = chromaFormat !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) {
        if (readBit()) {
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) {
              const delta = readUE(); // actually se(v) but we just need to skip
              nextScale = (lastScale + delta + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }

  readUE(); // log2_max_frame_num_minus4
  const picOrderCntType = readUE();
  if (picOrderCntType === 0) {
    readUE(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (picOrderCntType === 1) {
    readBit(); // delta_pic_order_always_zero_flag
    readUE(); // offset_for_non_ref_pic (se, but skip)
    readUE(); // offset_for_top_to_bottom_field (se, but skip)
    const numRefFrames = readUE();
    for (let i = 0; i < numRefFrames; i++) readUE(); // offset_for_ref_frame
  }
  readUE(); // max_num_ref_frames
  readBit(); // gaps_in_frame_num_value_allowed_flag

  const picWidthInMbs = readUE() + 1;
  const picHeightInMapUnits = readUE() + 1;
  const frameMbsOnly = readBit();
  if (!frameMbsOnly) readBit(); // mb_adaptive_frame_field_flag

  readBit(); // direct_8x8_inference_flag

  const frameCropping = readBit();
  let cropLeft = 0,
    cropRight = 0,
    cropTop = 0,
    cropBottom = 0;
  if (frameCropping) {
    cropLeft = readUE();
    cropRight = readUE();
    cropTop = readUE();
    cropBottom = readUE();
  }

  const width = picWidthInMbs * 16 - (cropLeft + cropRight) * 2;
  const height =
    (2 - frameMbsOnly) * picHeightInMapUnits * 16 - (cropTop + cropBottom) * 2;

  return { width, height };
}
