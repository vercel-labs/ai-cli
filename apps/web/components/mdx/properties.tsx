import type { ReactNode } from "react";

export function Properties({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="not-prose my-6 divide-y divide-gray-alpha-400 border-y border-gray-alpha-400">
      {children}
    </dl>
  );
}

export function Property({
  name,
  type,
  default: defaultValue,
  required,
  children,
}: {
  readonly name: string;
  readonly type?: string;
  readonly default?: string;
  readonly required?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div id={`property-${name}`} className="scroll-mt-24 py-4">
      <dt className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm">
        <code className="font-semibold text-gray-1000">{name}</code>
        {type ? <span className="text-gray-900">{type}</span> : null}
        {required ? <span className="text-red-900">required</span> : null}
        {defaultValue ? (
          <span className="text-gray-900">default: {defaultValue}</span>
        ) : null}
      </dt>
      <dd className="mt-2 text-sm text-gray-900 [&>p]:m-0">{children}</dd>
    </div>
  );
}
