import { gateway } from 'ai';
import { getSetting } from '../config/settings.js';

export function getSearchTool() {
  const provider = getSetting('search') || 'perplexity';
  if (provider === 'parallel') {
    return {
      parallel_search: gateway.tools.parallelSearch(),
    };
  }
  return {
    perplexity_search: gateway.tools.perplexitySearch(),
  };
}
