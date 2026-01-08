import { setModel } from '../../config/index.js';
import { fetchModels, scoreMatch } from '../../utils/models.js';
import type { CommandHandler } from './types.js';

export const list: CommandHandler = async (ctx, args) => {
  const search = args?.trim().toLowerCase() || '';

  let allModels: { id: string; type: string }[];
  try {
    allModels = await fetchModels();
  } catch {
    return { output: 'failed to fetch models' };
  }

  if (search) {
    const scored = allModels
      .map((m) => ({ model: m, score: scoreMatch(m.id, search) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (scored.length === 0) {
      return { output: `no models matching "${search}"` };
    }

    if (scored.length === 1) {
      const newModel = scored[0].model.id;
      setModel(newModel);
      return { model: newModel, output: `switched to ${newModel}` };
    }

    const lines = [`models matching "${search}":`];
    for (const { model } of scored) {
      const prefix = model.id === ctx.model ? '› ' : '  ';
      lines.push(`${prefix}${model.id}`);
    }
    lines.push('\n/list <model> to switch');
    return { output: lines.join('\n') };
  }

  const lines = ['models (showing first 15):'];
  const shown = allModels.slice(0, 15);
  for (const model of shown) {
    const prefix = model.id === ctx.model ? '› ' : '  ';
    lines.push(`${prefix}${model.id}`);
  }
  lines.push(`\n/list <search> to filter (${allModels.length} total)`);
  return { output: lines.join('\n') };
};
