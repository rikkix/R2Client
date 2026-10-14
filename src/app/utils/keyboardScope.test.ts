import { expect, test } from 'bun:test';
import { blocksBackgroundShortcut } from './keyboardScope';
const root = (visibility: boolean[]) => ({
  querySelectorAll: () =>
    visibility.map((visible) => ({
      getClientRects: () => (visible ? [{}] : []),
    })) as unknown as NodeListOf<Element>,
});

test('file selection, delete, search, and upload shortcuts are blocked behind visible dialogs', () => {
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([true]))).toBe(true);
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([false, true]))).toBe(true);
});

test('a requested lazy dialog blocks shortcuts before any dialog DOM exists', () => {
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([]), true)).toBe(true);
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([false]), true)).toBe(true);
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([]), false)).toBe(false);
});

test('blocking app refresh also suppresses browser reload behind a dialog', () => {
  let prevented = false;
  const event = {
    defaultPrevented: false,
    key: 'r',
    ctrlKey: true,
    preventDefault: () => {
      prevented = true;
    },
  };
  expect(blocksBackgroundShortcut(event, root([]), true)).toBe(true);
  expect(prevented).toBe(true);
  prevented = false;
  expect(blocksBackgroundShortcut(event, root([]), false)).toBe(false);
  expect(prevented).toBe(false);
});

test('closed Ant Design dialogs do not block file shortcuts and handled editor events stay handled', () => {
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([false]))).toBe(false);
  expect(blocksBackgroundShortcut({ defaultPrevented: false }, root([]))).toBe(false);
  expect(blocksBackgroundShortcut({ defaultPrevented: true }, root([]))).toBe(true);
});
