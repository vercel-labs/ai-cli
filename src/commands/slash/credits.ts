import { GATEWAY_URL } from '../../utils/models.js';
import type { CommandHandler } from './types.js';

export const credits: CommandHandler = async () => {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/credits`, {
      headers: {
        Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        balance: string;
        total_used: string;
      };
      const balance = Number.parseFloat(data.balance).toFixed(2);
      return { output: `balance: $${balance}` };
    }
    return { output: 'failed to fetch credits' };
  } catch {
    return { output: 'failed to fetch credits' };
  }
};
