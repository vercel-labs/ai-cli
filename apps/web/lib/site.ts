export const siteName = "ai-cli";
export const siteUrl = "https://ai-cli.dev";
export const description =
  "Generate media and text. Filter, rank, and select records from the terminal.";
export const githubUrl = "https://github.com/vercel-labs/ai-cli";

export function canonicalUrlFor(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return siteUrl;
  }
  return `${siteUrl}${pathname}`;
}
