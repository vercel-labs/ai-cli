import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { fetchModels, scoreMatch } from '../utils/models.js';

interface Props {
  current: string;
  onSelect: (model: string | null) => void;
}

export function ModelSelect({ current, onSelect }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        const ids = m.map((x) => x.id);
        setModels(ids);
        const idx = ids.indexOf(current);
        if (idx !== -1) setSelected(idx);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [current]);

  const filtered = search
    ? models
        .map((id) => ({ id, score: scoreMatch(id, search) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.id)
    : models;

  const pageSize = 10;
  const start = Math.max(0, selected - Math.floor(pageSize / 2));
  const visible = filtered.slice(start, start + pageSize);

  useInput((input, key) => {
    if (key.escape) {
      onSelect(null);
      return;
    }
    if (key.return) {
      if (filtered[selected]) {
        onSelect(filtered[selected]);
      }
      return;
    }
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((s) => Math.min(filtered.length - 1, s + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setSearch((s) => s.slice(0, -1));
      setSelected(0);
      return;
    }
    if (input && input.length === 1 && input >= ' ' && input <= '~') {
      setSearch((s) => s + input);
      setSelected(0);
    }
  });

  if (loading) {
    return <Text dimColor>loading models...</Text>;
  }

  if (models.length === 0) {
    return <Text dimColor>failed to fetch models</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>{search || 'type to search...'}</Text>
      <Text dimColor>↑↓ navigate, enter select, esc cancel</Text>
      {visible.map((id, i) => {
        const globalIdx = start + i;
        const isSelected = globalIdx === selected;
        const prefix = isSelected ? '› ' : '  ';
        return (
          <Text key={id} dimColor={!isSelected}>
            {prefix}{id}
          </Text>
        );
      })}
    </Box>
  );
}
