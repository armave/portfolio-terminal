import type { ComponentChildren } from 'preact';

/** Preserve message text while rendering Stocktwits cashtags as readable ticker links/labels. */
export function renderStocktwitsBody(body: string): ComponentChildren {
  const parts = body.split(/(\$[A-Z][A-Z0-9.-]{0,9}\b)/gi);
  return parts.map((part, index) =>
    /^\$[A-Z][A-Z0-9.-]{0,9}\b$/i.test(part)
      ? <span key={index} class="inline-block rounded bg-cyan-950/80 px-1 font-bold text-cyan-300 ring-1 ring-inset ring-cyan-700/60">{part}</span>
      : part
  );
}
