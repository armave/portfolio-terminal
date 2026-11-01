import { describe, expect, it } from 'vitest';
import { focusElementWithoutScrolling, getDialogFocusableElements, resolveDialogRestoreTarget, trapDialogTabKey } from './dialogFocus';

interface FocusableOptions {
  rendered?: boolean;
  hiddenAncestor?: boolean;
  tabIndex?: number;
}

let focused: string[] = [];

function makeFocusable(name: string, options: FocusableOptions = {}): HTMLElement {
  const { rendered = true, hiddenAncestor = false, tabIndex = 0 } = options;
  return {
    name,
    tabIndex,
    focus: () => { focused.push(name); },
    getClientRects: () => rendered ? [{}] as unknown as DOMRectList : [],
    closest: () => hiddenAncestor ? ({} as Element) : null
  } as unknown as HTMLElement;
}

function makeDialog(items: HTMLElement[]) {
  return {
    querySelectorAll: () => items,
    contains: (target: Element | null) => items.includes(target as HTMLElement),
    focus: () => { focused.push('dialog'); }
  } as unknown as HTMLElement;
}

function makeEvent(shiftKey = false) {
  let prevented = false;
  return {
    event: {
      key: 'Tab',
      shiftKey,
      preventDefault: () => { prevented = true; }
    } as unknown as KeyboardEvent,
    wasPrevented: () => prevented
  };
}

describe('dialog focus management', () => {
  it('focuses dialog controls without allowing the browser to scroll the page', () => {
    let options: FocusOptions | undefined;
    const element = {
      focus: (nextOptions?: FocusOptions) => { options = nextOptions; }
    } as HTMLElement;

    focusElementWithoutScrolling(element);
    expect(options).toEqual({ preventScroll: true });
    expect(() => focusElementWithoutScrolling(null)).not.toThrow();
  });

  it('prefers a connected invoking control when restoring focus', () => {
    const trigger = { isConnected: true } as HTMLElement;
    const previouslyFocused = { isConnected: true } as HTMLElement;
    expect(resolveDialogRestoreTarget(trigger, previouslyFocused)).toBe(trigger);
  });

  it('falls back to the previously active element when the trigger is unavailable', () => {
    const previouslyFocused = { isConnected: true } as HTMLElement;
    const disconnectedTrigger = { isConnected: false } as HTMLElement;
    expect(resolveDialogRestoreTarget(null, previouslyFocused)).toBe(previouslyFocused);
    expect(resolveDialogRestoreTarget(disconnectedTrigger, previouslyFocused)).toBe(previouslyFocused);
  });

  it('excludes hidden, inert, aria-hidden, visually unrendered, and negative-tabindex elements', () => {
    const visible = makeFocusable('visible');
    const hiddenAncestor = makeFocusable('hidden-ancestor', { hiddenAncestor: true });
    const unrendered = makeFocusable('unrendered', { rendered: false });
    const negative = makeFocusable('negative', { tabIndex: -1 });
    const dialog = {
      querySelectorAll: () => [visible, hiddenAncestor, unrendered, negative]
    } as unknown as HTMLElement;

    expect(getDialogFocusableElements(dialog)).toEqual([visible]);
  });

  it('uses a selector that excludes disabled and hidden input controls', () => {
    const visible = makeFocusable('visible');
    let selector = '';
    const dialog = {
      querySelectorAll: (value: string) => {
        selector = value;
        return [visible];
      }
    } as unknown as HTMLElement;

    expect(getDialogFocusableElements(dialog)).toEqual([visible]);
    expect(selector).toContain('button:not(:disabled)');
    expect(selector).toContain('input:not(:disabled):not([type="hidden"])');
    expect(selector).toContain('select:not(:disabled)');
    expect(selector).toContain('textarea:not(:disabled)');
  });

  it('wraps forward Tab from the last focusable element to the first', () => {
    focused = [];
    const first = makeFocusable('first');
    const last = makeFocusable('last');
    const dialog = makeDialog([first, last]);
    const { event, wasPrevented } = makeEvent();

    expect(trapDialogTabKey(event, dialog, last)).toBe(true);
    expect(wasPrevented()).toBe(true);
    expect(focused).toEqual(['first']);
  });

  it('wraps reverse Tab from the first focusable element to the last', () => {
    focused = [];
    const first = makeFocusable('first');
    const last = makeFocusable('last');
    const dialog = makeDialog([first, last]);
    const { event, wasPrevented } = makeEvent(true);

    expect(trapDialogTabKey(event, dialog, first)).toBe(true);
    expect(wasPrevented()).toBe(true);
    expect(focused).toEqual(['last']);
  });

  it('pulls focus back inside when it has moved outside the dialog', () => {
    focused = [];
    const first = makeFocusable('first');
    const last = makeFocusable('last');
    const dialog = makeDialog([first, last]);
    const outside = makeFocusable('outside');
    const { event, wasPrevented } = makeEvent(true);

    expect(trapDialogTabKey(event, dialog, outside)).toBe(true);
    expect(wasPrevented()).toBe(true);
    expect(focused).toEqual(['last']);
  });

  it('keeps focus on the dialog when no focusable controls exist', () => {
    focused = [];
    const dialog = makeDialog([]);
    const { event, wasPrevented } = makeEvent();

    expect(trapDialogTabKey(event, dialog, null)).toBe(true);
    expect(wasPrevented()).toBe(true);
    expect(focused).toEqual(['dialog']);
  });

  it('does not intercept other keys or Tab movement within the focusable range', () => {
    focused = [];
    const first = makeFocusable('first');
    const middle = makeFocusable('middle');
    const last = makeFocusable('last');
    const dialog = makeDialog([first, middle, last]);
    const { event: tabEvent, wasPrevented: wasTabPrevented } = makeEvent();

    expect(trapDialogTabKey(tabEvent, dialog, middle)).toBe(false);
    expect(wasTabPrevented()).toBe(false);
    expect(trapDialogTabKey({ key: 'Escape', shiftKey: false, preventDefault: () => undefined }, dialog, middle)).toBe(false);
    expect(focused).toEqual([]);
  });
});
