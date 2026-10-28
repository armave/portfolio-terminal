import { useEffect, useState } from 'preact/hooks';

let aiStatus = 'READY';
const aiStatusListeners = new Set<(status: string) => void>();

/** Publish the AI runtime status without routing component state through UI events. */
export function setAiStatus(status: string): void {
  if (!status || status === aiStatus) return;
  aiStatus = status;
  aiStatusListeners.forEach((listener) => listener(aiStatus));
}

/** Subscribe to the latest AI status; returns a cleanup callback. */
export function subscribeAiStatus(listener: (status: string) => void): () => void {
  aiStatusListeners.add(listener);
  return () => aiStatusListeners.delete(listener);
}

export function useAiStatus(): string {
  const [status, setStatus] = useState(aiStatus);
  useEffect(() => subscribeAiStatus(setStatus), []);
  return status;
}
