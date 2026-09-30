export const siteName = "ai-cli";
export const siteUrl = "https://ai-cli.dev";
export const description =
  "Generate anything from your terminal. Create text, images, video, and audio, and evaluate typed questions with composable commands.";
export const githubUrl = "https://github.com/vercel-labs/ai-cli";

export function canonicalUrlFor(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return siteUrl;
  }
  return `${siteUrl}${pathname}`;
}
