export const PAGE_TITLES: Record<string, string> = {
  "": "Generate Anything\nfrom Your Terminal",
  installation: "Installation",
  commands: "Commands",
  models: "Models",
  configuration: "Configuration",
  single: "Piping & Output",
  images: "Inline Preview",
};

export function getPageTitle(slug: string): string | null {
  return slug in PAGE_TITLES ? PAGE_TITLES[slug]! : null;
}
