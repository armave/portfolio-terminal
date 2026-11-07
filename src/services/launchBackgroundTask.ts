/**
 * Start a long-lived connection or other best-effort task without holding up
 * the caller's foreground workflow. Rejections are always observed.
 */
export function launchBackgroundTask(
  task: () => Promise<unknown>,
  onError: (error: unknown) => void
): void {
  try {
    void Promise.resolve(task()).catch(onError);
  } catch (error) {
    onError(error);
  }
}
