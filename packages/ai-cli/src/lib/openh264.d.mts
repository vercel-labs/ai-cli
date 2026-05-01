interface OpenH264ModuleInstance {
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

interface ModuleOptions {
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  wasmBinary?: ArrayBufferLike | Uint8Array;
}

declare function Module(
  options?: ModuleOptions
): Promise<OpenH264ModuleInstance>;
export default Module;
