import { afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
export const png = Buffer.from(pngBase64, "base64");

export function mediaFixture() {
  const directory = mkdtempSync(join(tmpdir(), "ai-cli-media-"));
  const preload = join(directory, "gateway.mjs");
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    preload,
    `
import { appendFileSync } from 'node:fs';
const png = ${JSON.stringify(pngBase64)};
const mode = process.env.TEST_MODE;
let statuses = 0;
let imageCalls = 0;
globalThis.fetch = async (url, init) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  const headers = Object.fromEntries(new Headers(init?.headers));
  const route = new URL(String(url)).pathname;
  appendFileSync(process.env.TEST_REQUESTS, JSON.stringify({ url: String(url), route, body, headers }) + '\\n');
  if (route.endsWith('/models')) {
    if (mode === 'catalog-failure') return new Response('', { status: 503 });
    if (mode === 'catalog-malformed') return Response.json({ data: {} });
    if (mode === 'catalog-missing') return Response.json({ data: [{ id: 'openai/gpt-image-2', type: 'image' }] });
    return Response.json({ data: [
      ...(mode === 'partial' ? [{ id: 'test/fail', type: 'image' }] : []),
      { id: 'openai/gpt-image-2', type: 'image' },
      { id: 'google/gemini-3-pro-image', type: 'language', owned_by: 'google', tags: ['image-generation'] },
      { id: 'bytedance/seedance-2.0', type: 'video', video_capabilities: { durations: [4, 15] }, supported_specifications: ['video-v4'], modalities: { input: ['text', 'image'], output: ['video'] } }
    ] });
  }
  if (route.endsWith('/endpoints')) return Response.json({ data: { endpoints: [] } });
  if (mode === 'failure' || (mode === 'partial' && headers['ai-model-id']?.includes('fail'))) return Response.json({ error: { message: 'Unsupported requested setting' } }, { status: 400 });
  if (route.endsWith('/image-model')) {
    imageCalls++;
    if (mode === 'partial-image-batch' && imageCalls === 2) return Response.json({ error: { message: 'one image batch failed' } }, { status: 503 });
    const count = mode === 'short-image-batch' ? 1 : body.n;
    return Response.json({
    images: Array.from({ length: count }, () => png), usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
    warnings: mode === 'warnings' ? [{ type: 'unsupported', feature: 'style' }] : [],
    providerMetadata: { openai: { images: Array.from({ length: count }, () => ({ revisedPrompt: 'revised' })) }, gateway: { cost: '0.123' } }
  }, { headers: { 'x-request-id': 'image-id' } });
  }
  if (route.endsWith('/language-model')) return Response.json({
    content: mode === 'tool' ? [
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'image_generation', input: '{}', providerExecuted: true },
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'image_generation', result: { result: png, outputFormat: 'webp', revisedPrompt: 'tool revised' } }
    ] : [ { type: 'text', text: 'Two generated images' }, ...[1, 2].map(() => ({ type: 'file', data: { type: 'data', data: png }, mediaType: 'image/png' })) ],
    finishReason: { unified: 'stop', raw: 'STOP' }, usage: { inputTokens: { total: 12 }, outputTokens: { total: 34 } }, warnings: [],
    response: { id: 'language-id' }
  });
  if (route.endsWith('/video-model/start')) return Response.json({ operation: { id: 'job', n: body.n }, warnings: [], providerMetadata: { gateway: { asyncJob: { jobId: 'job' } } } });
  if (route.endsWith('/video-model/status')) {
    if (mode === 'stalled-status') return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    if (mode === 'status-error') return Response.json({ status: 'error', error: 'provider failed' });
    if (mode === 'pending' || (mode === 'poll' && statuses++ === 0)) return Response.json({ status: 'pending', warnings: [] });
    if (mode === 'partial-video-batch' && body.operation.n === 1) return Response.json({ status: 'error', error: 'one video batch failed' });
    if (mode === 'mixed-download') return Response.json({ status: 'completed', videos: [
      { type: 'url', url: 'https://example.com/good.webm', mediaType: 'video/webm' },
      { type: 'url', url: 'https://example.com/bad.webm', mediaType: 'video/webm' }
    ], warnings: [] });
    const count = mode === 'short-video-batch' && body.operation.n === 2 ? 1 : (body.operation.n ?? 1);
    return Response.json({ status: 'completed', videos: Array.from({ length: count }, (_, i) => mode === 'download' ? { type: 'url', url: 'https://example.com/movie.webm', mediaType: 'video/webm' } : { type: 'base64', data: Buffer.from('video' + (i+1)).toString('base64'), mediaType: 'video/webm' }), warnings: [], providerMetadata: { gateway: { cost: '0.42' } } }, { headers: { 'x-request-id': 'batch-' + (body.operation.n ?? 1) } });
  }
  if (route.endsWith('/movie.webm')) return new Response('downloaded-video', { headers: { 'content-type': 'video/webm', 'content-length': '16' } });
  if (route.endsWith('/good.webm')) return new Response('good-video', { headers: { 'content-type': 'video/webm', 'content-length': '10' } });
  if (route.endsWith('/bad.webm')) return new Response('download failed', { status: 503 });
  throw new Error('Unexpected network request: ' + route);
};
`
  );
  const json = (value: unknown) => {
    const path = join(directory, `${crypto.randomUUID()}.json`);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const image = join(directory, "image.png");
  writeFileSync(image, png);
  async function run(
    args: string[],
    options: { mode?: string; input?: Uint8Array; node?: boolean } = {}
  ) {
    const requestPath = join(directory, `${crypto.randomUUID()}.jsonl`);
    writeFileSync(requestPath, "");
    const executable = options.node
      ? [
          "node",
          "--import",
          preload,
          join(import.meta.dir, "../../dist/index.js"),
        ]
      : [
          "bun",
          "run",
          "--preload",
          preload,
          join(import.meta.dir, "../index.ts"),
        ];
    const proc = Bun.spawn([...executable, ...args], {
      cwd: directory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "test-key",
        AI_CLI_OUTPUT_DIR: "",
        TEST_REQUESTS: requestPath,
        TEST_MODE: options.mode ?? "",
      },
    });
    if (options.input) proc.stdin.write(options.input);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const requests = readFileSync(requestPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { stdout, stderr, exitCode, requests };
  }
  return { directory, image, json, run };
}
