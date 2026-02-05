import { tool } from 'ai';
import { z } from 'zod';

export const weather = tool({
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name or location'),
  }),
  execute: async ({ location }) => {
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { error: 'failed to fetch weather' };
      }
      const data = await res.json();
      const current = data.current_condition?.[0];
      if (!current) {
        return { error: 'no weather data' };
      }
      return {
        location: data.nearest_area?.[0]?.areaName?.[0]?.value || location,
        condition: current.weatherDesc?.[0]?.value || 'unknown',
        temperature: `${current.temp_C}°C / ${current.temp_F}°F`,
        feelsLike: `${current.FeelsLikeC}°C / ${current.FeelsLikeF}°F`,
        humidity: `${current.humidity}%`,
        wind: `${current.windspeedKmph} km/h ${current.winddir16Point}`,
      };
    } catch {
      return { error: 'weather service unavailable' };
    }
  },
});
