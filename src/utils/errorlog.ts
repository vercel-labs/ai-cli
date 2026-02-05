const errors: { time: Date; error: unknown }[] = [];
const MAX_ERRORS = 20;

export function logError(error: unknown) {
  errors.push({ time: new Date(), error });
  if (errors.length > MAX_ERRORS) errors.shift();
}

export function getErrors() {
  return errors;
}

export function clearErrors() {
  errors.length = 0;
}

export function formatFullError(e: unknown): string {
  if (e instanceof Error) {
    let msg = `${e.name}: ${e.message}`;
    if (e.stack) msg += `\n${e.stack}`;
    if (e.cause) msg += `\n\nCause: ${formatFullError(e.cause)}`;
    const extra = Object.entries(e)
      .filter(([k]) => !['name', 'message', 'stack', 'cause'].includes(k))
      .map(([k, v]) => `${k}: ${JSON.stringify(v, null, 2)}`)
      .join('\n');
    if (extra) msg += `\n\n${extra}`;
    return msg;
  }
  return String(e);
}
