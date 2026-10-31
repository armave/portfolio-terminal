import { describe, expect, it } from 'vitest';
import { getDialogFocusableElements, trapDialogTabKey } from './dialogFocus';

function makeFocusable(name: string, hidden = false): HTMLElement {
  return {
    name,
    tabIndex: 0,
    focus: () => { focused.push(name); },
    getClientRects: () => hidden ? [] : [{}] as unknown as DOMRectList,
    closest: () => hidden ? ({} as Element) : null
  } as unknown as HTMLElement;
}

let focused: string[] = [];

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
  it('excludes hidden, inert, aria-hidden, and negative-tabindex elements', () => {
    const visible = makeFocusable('visible');
    const hidden = makeFocusable('hidden', true);
    const negative = { ...makeFocusable('negative'), tabIndex: -1 } as HTMLElement;
    const dialog = {
      querySelectorAll: () => [visible, hidden, negative]
    } as unknown as HTMLElement;

    expect(getDialogFocusableElements(dialog)).toEqual([visible]);
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
