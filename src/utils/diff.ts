export function createDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      result.push(`+ ${newLine}`);
    } else if (newLine === undefined) {
      result.push(`- ${oldLine}`);
    } else if (oldLine !== newLine) {
      result.push(`- ${oldLine}`);
      result.push(`+ ${newLine}`);
    }
  }

  return result.join('\n');
}

export function createUnifiedDiff(
  oldText: string,
  newText: string,
  context: number = 3
): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const changes: { type: 'same' | 'add' | 'remove'; line: string; oldIdx?: number; newIdx?: number }[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldLine === newLine) {
      changes.push({ type: 'same', line: oldLine || '', oldIdx, newIdx });
      oldIdx++;
      newIdx++;
    } else if (oldIdx < oldLines.length && (newIdx >= newLines.length || !newLines.slice(newIdx).includes(oldLine))) {
      changes.push({ type: 'remove', line: oldLine, oldIdx });
      oldIdx++;
    } else {
      changes.push({ type: 'add', line: newLine || '', newIdx });
      newIdx++;
    }
  }

  const result: string[] = [];
  let inHunk = false;
  let hunkStart = -1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const hasNearbyChange = changes.slice(Math.max(0, i - context), i + context + 1)
      .some(c => c.type !== 'same');

    if (hasNearbyChange) {
      if (!inHunk) {
        inHunk = true;
        hunkStart = i;
      }

      if (change.type === 'same') {
        result.push(`  ${change.line}`);
      } else if (change.type === 'remove') {
        result.push(`- ${change.line}`);
      } else {
        result.push(`+ ${change.line}`);
      }
    } else if (inHunk) {
      inHunk = false;
      if (i < changes.length - 1) {
        result.push('  ...');
      }
    }
  }

  return result.join('\n');
}
