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
function subscribeAiStatus(listener: (status: string) => void): () => void {
  aiStatusListeners.add(listener);
  return () => aiStatusListeners.delete(listener);
}

export function useAiStatus(): string {
  const [status, setStatus] = useState(aiStatus);
  useEffect(() => subscribeAiStatus(setStatus), []);
  return status;
}

let breakevenText = 'Combined Breakeven: 0 days';
const breakevenTextListeners = new Set<(text: string) => void>();

/** Publish the current combined-portfolio breakeven label. */
export function setBreakevenText(text: string): void {
  if (text === breakevenText) return;
  breakevenText = text;
  breakevenTextListeners.forEach((listener) => listener(breakevenText));
}

function subscribeBreakevenText(listener: (text: string) => void): () => void {
  breakevenTextListeners.add(listener);
  return () => breakevenTextListeners.delete(listener);
}

export function useBreakevenText(): string {
  const [text, setText] = useState(breakevenText);
  useEffect(() => subscribeBreakevenText(setText), []);
  return text;
}
