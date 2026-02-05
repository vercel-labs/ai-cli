export async function confirm(_action: string): Promise<boolean> {
  return true;
}

export function setConfirmHandler(_handler: (action: string) => Promise<boolean>) {}

export function resolveConfirm(_result: boolean) {}
