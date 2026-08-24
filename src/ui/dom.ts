/**
 * Tiny DOM helpers shared by the UI module.
 */

/** Create an element with optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Returns a setter that only touches the DOM when the string changes. */
export function textUpdater(node: HTMLElement): (s: string) => void {
  let last: string | null = null;
  return (s: string) => {
    if (s !== last) {
      last = s;
      node.textContent = s;
    }
  };
}

/** Toggle a class only when the value changes (cheap for rAF loops). */
export function classToggler(node: HTMLElement, cls: string): (on: boolean) => void {
  let last: boolean | null = null;
  return (on: boolean) => {
    if (on !== last) {
      last = on;
      node.classList.toggle(cls, on);
    }
  };
}

/** Restart a CSS animation driven by a class. */
export function replayAnimation(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  // Force reflow so the animation restarts.
  void node.offsetWidth;
  node.classList.add(cls);
}
