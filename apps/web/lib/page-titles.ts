export const PAGE_TITLES: Record<string, string> = {
  "": "Generate anything\nfrom your terminal",
  installation: "Installation",
  commands: "Commands",
  evaluate: "Evaluate",
  models: "Models",
  configuration: "Configuration",
  single: "Piping & Output",
  images: "Inline Preview",
};

export function getPageTitle(slug: string): string | null {
  return slug in PAGE_TITLES ? PAGE_TITLES[slug]! : null;
}
