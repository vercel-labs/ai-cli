export const siteName = "ai-cli";
export const siteUrl = "https://ai-cli.dev";
export const description =
  "The AI SDK for your terminal. Generate text and media, and evaluate typed questions.";
export const githubUrl = "https://github.com/vercel-labs/ai-cli";

export function canonicalUrlFor(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return siteUrl;
  }
  return `${siteUrl}${pathname}`;
}
