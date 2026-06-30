import { getAllDocs } from "fromsrc";
import { MobileNav, Search, Sidebar, ThemeProvider } from "fromsrc/client";
import { AdapterProvider, nextAdapter } from "fromsrc/next";

const navigation = [
  {
    title: "Getting Started",
    items: [
      { type: "item" as const, title: "Introduction", href: "/docs" },
      {
        type: "item" as const,
        title: "Installation",
        href: "/docs/installation",
      },
      {
        type: "item" as const,
        title: "Configuration",
        href: "/docs/configuration",
      },
    ],
  },
  {
    title: "Usage",
    items: [
      { type: "item" as const, title: "Commands", href: "/docs/commands" },
      { type: "item" as const, title: "Models", href: "/docs/models" },
      {
        type: "item" as const,
        title: "Piping & Output",
        href: "/docs/single",
      },
      {
        type: "item" as const,
        title: "Terminal Previews",
        href: "/docs/images",
      },
    ],
  },
];

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M4 17L10 11L4 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 19H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default async function DocsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const docs = await getAllDocs("docs");

  return (
    <ThemeProvider defaultTheme="dark">
      <AdapterProvider adapter={nextAdapter}>
        <Search docs={docs} basePath="/docs" hidden />
        <MobileNav
          title="ai-cli"
          logo={<Logo />}
          navigation={navigation}
          docs={docs}
          basePath="/docs"
          github="https://github.com/vercel-labs/ai-cli"
        />
        <div className="docs-shell min-h-screen">
          <div className="flex min-h-screen">
            <aside className="docs-left hidden lg:block shrink-0">
              <div className="docs-wrap">
                <Sidebar
                  title="ai-cli"
                  logo={<Logo />}
                  navigation={navigation}
                  basePath="/docs"
                  github="https://github.com/vercel-labs/ai-cli"
                  collapsible
                  defaultOpenLevel={2}
                />
              </div>
            </aside>
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </AdapterProvider>
    </ThemeProvider>
  );
}
