interface item {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

const items: readonly item[] = [
  {
    id: "001",
    title: "Inline preview",
    body: "Images and video frames render in terminals that support the Kitty graphics protocol, and speech plays back after it's saved.",
  },
  {
    id: "002",
    title: "Predictable output",
    body: "Progress and file paths go to stderr. Stdout carries the text, the piped artifact, or JSON metadata, so scripts and agents can parse it.",
  },
  {
    id: "003",
    title: "Live model discovery",
    body: "The model list comes from AI Gateway at run time, so new models work without a CLI update. Use short names like flux-2-pro or full IDs like bfl/flux-2-pro.",
  },
  {
    id: "004",
    title: "No config file",
    body: "Set AI_GATEWAY_API_KEY and run a command. Each type has a default model, and env vars such as AI_CLI_IMAGE_MODEL change it.",
  },
];

function mark(index: number) {
  if (index === 0) {
    return (
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="h-px w-4 bg-gray-alpha-600" />
        <span className="h-px w-6 bg-gray-alpha-600" />
        <span className="h-px w-3 bg-gray-alpha-600" />
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="grid grid-cols-3 gap-1" aria-hidden="true">
        <span className="size-2 border border-gray-alpha-600" />
        <span className="size-2 border border-gray-alpha-600" />
        <span className="size-2 border border-gray-alpha-600" />
        <span className="size-2 border border-gray-alpha-600" />
        <span className="size-2 border border-gray-alpha-600" />
        <span className="size-2 border border-gray-alpha-600" />
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="flex flex-col gap-1" aria-hidden="true">
        <span className="h-1 w-8 border border-gray-alpha-600" />
        <span className="h-1 w-6 border border-gray-alpha-600" />
        <span className="h-1 w-4 border border-gray-alpha-600" />
      </div>
    );
  }

  return (
    <div className="relative h-6 w-8" aria-hidden="true">
      <span className="absolute top-0 left-0 size-2 border border-gray-alpha-600" />
      <span className="absolute top-0 right-0 size-2 border border-gray-alpha-600" />
      <span className="absolute bottom-0 left-1/2 size-2 -translate-x-1/2 border border-gray-alpha-600" />
    </div>
  );
}

export function Bento() {
  return (
    <section>
      <div className="mx-auto max-w-[1320px] border-t border-gray-alpha-400 px-6 py-20 md:py-28">
        <div className="grid gap-10 border-b border-gray-alpha-400 pb-12 md:grid-cols-[1.2fr_0.8fr] md:pb-14">
          <div>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-gray-1000 md:text-5xl leading-[1.05]">
              Made for scripts and agents.
            </h2>
          </div>
          <div className="md:pt-2">
            <p className="max-w-md text-pretty text-base leading-relaxed text-gray-900">
              Run the same commands in a terminal, a CI job, or an agent's
              tool loop.
            </p>
            <div className="mt-6">
              <div className="inline-flex items-center gap-3 rounded-lg border border-gray-alpha-400 bg-gray-alpha-100 px-4 py-2 font-mono text-sm text-gray-1000">
                <span className="text-gray-700">$</span>
                <span>ai text &quot;hello&quot;</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <article
              key={item.id}
              className={`flex h-full flex-col border-b border-gray-alpha-400 py-8 md:px-6 md:py-9 ${
                index % 2 === 1 ? "md:border-l md:border-l-gray-alpha-400" : ""
              } ${index >= 2 ? "md:border-b-0" : ""} ${
                index > 0
                  ? "lg:border-l lg:border-l-gray-alpha-400"
                  : "lg:border-l-0"
              } lg:border-b-0`}
            >
              <div className="font-mono text-[11px] text-gray-700">
                {item.id}
              </div>
              <div className="mt-7 flex h-10 items-center">{mark(index)}</div>
              <h3 className="mt-7 text-lg font-semibold tracking-tight text-gray-1000 text-balance">
                {item.title}
              </h3>
              <p className="mt-4 flex-1 text-pretty text-sm leading-relaxed text-gray-900">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
