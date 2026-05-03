export function Footer() {
  return (
    <footer>
      <div className="mx-auto max-w-[1320px] border-t border-white/[0.06] px-6 py-14 md:py-18">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex h-full flex-col">
            <div className="text-xs font-mono uppercase tracking-widest text-white/35">
              ai-cli
            </div>
            <div className="mt-3 text-sm text-white/40">
              Generate text, images, and video from your terminal.
            </div>
            <a
              href="https://vercel.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto pt-6 block text-white/35 hover:text-white/60 transition-colors"
            >
              <svg
                viewBox="0 0 76 65"
                className="h-4"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
              </svg>
            </a>
          </div>

          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-white/35">
              Usage
            </div>
            <div className="mt-4 flex flex-col gap-2 font-mono text-sm text-white/45">
              <span>ai image &quot;prompt&quot;</span>
              <span>ai video &quot;prompt&quot;</span>
              <span>ai text &quot;prompt&quot;</span>
              <span>ai models</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-white/35">
              Features
            </div>
            <div className="mt-4 flex flex-col gap-2 font-mono text-sm text-white/45">
              <span>multi-model comparison</span>
              <span>stdin/stdout piping</span>
              <span>inline preview</span>
              <span>live model discovery</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-white/35">
              Links
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://github.com/vercel-labs/ai-cli"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 hover:text-white transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://www.npmjs.com/package/ai-cli"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 hover:text-white transition-colors"
              >
                npm
              </a>
              <a
                href="https://vercel.com/docs/ai-gateway"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 hover:text-white transition-colors"
              >
                AI Gateway
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
