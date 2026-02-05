import { logError } from './errorlog.js';

type ApiError = Error & { statusCode?: number; cause?: Error };

export function formatError(error: unknown): string {
  logError(error);
  const err = error as ApiError;
  const msg = err.message?.toLowerCase() || '';
  const causeMsg = err.cause?.message?.toLowerCase() || '';

  if (msg.includes('authentication') || err.statusCode === 401) {
    return 'invalid key. run: ai init';
  }
  if (
    err.statusCode === 402 ||
    msg.includes('credit') ||
    msg.includes('balance') ||
    msg.includes('payment') ||
    msg.includes('insufficient')
  ) {
    return 'out of credits. top up at vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai';
  }
  if (err.statusCode === 429 || msg.includes('rate limit')) {
    return 'rate limited. try again later';
  }
  if (msg.includes('unsupported') || causeMsg.includes('unsupported')) {
    const match = msg.match(/unsupported[^:]*:\s*([^,]+)/i);
    return match ? `unsupported: ${match[1]}` : 'unsupported operation';
  }
  if (err.statusCode === 400) {
    return 'bad request. check your input';
  }
  if (err.statusCode === 403) {
    return 'forbidden. check api key permissions';
  }
  if (err.statusCode === 500 || err.statusCode === 502 || err.statusCode === 503) {
    return 'server error. try again later';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'request timed out. try again';
  }
  if (msg.includes('network') || msg.includes('econnrefused')) {
    return 'network error. check connection';
  }
  return 'error. try again';
}
