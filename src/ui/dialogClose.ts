/** Schedules a modal's exit-animation completion and returns an idempotent cancellation function. */
export function scheduleDialogClose(onClose: () => void, delayMs: number): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timeoutId = null;
    onClose();
  }, delayMs);

  return () => {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };
}
