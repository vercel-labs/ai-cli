import { getSetting } from '../config/settings.js';

type ConfirmResolver = (result: boolean) => void;

let pendingResolver: ConfirmResolver | null = null;
let showConfirmUI: ((action: string) => void) | null = null;

export function setConfirmHandler(handler: (action: string) => void) {
  showConfirmUI = handler;
}

export function resolveConfirm(result: boolean) {
  if (pendingResolver) {
    pendingResolver(result);
    pendingResolver = null;
  }
}

export async function confirm(action: string): Promise<boolean> {
  if (getSetting('yolo')) {
    return true;
  }

  if (!showConfirmUI) {
    return true;
  }

  return new Promise((resolve) => {
    pendingResolver = resolve;
    showConfirmUI!(action);
  });
}
