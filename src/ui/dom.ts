/*
 * Tiny DOM helpers. We don't pull in a framework, so a hand-rolled `el()`
 * keeps the renderer terse. Children can be strings, nodes, or arrays.
 */

type Child = string | Node | null | undefined | false;

type AttrValue = string | number | boolean | undefined | ((ev: Event) => void);

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k.startsWith('data-')) node.setAttribute(k, String(v));
    else if (k.startsWith('aria-')) node.setAttribute(k, String(v));
    else if (k === 'html') node.innerHTML = String(v);
    else if (typeof v === 'function') {
      // onclick / oninput / etc → bind as a real event listener.
      const eventName = k.startsWith('on') ? k.slice(2).toLowerCase() : k;
      node.addEventListener(eventName, v as EventListener);
    } else {
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function mount(parent: HTMLElement, child: HTMLElement): void {
  parent.replaceChildren(child);
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}
