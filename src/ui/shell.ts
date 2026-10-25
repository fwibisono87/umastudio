// Page layout: a toolbar on top, the 3D viewport in the middle, a sidebar of
// collapsible panels on the right, a status bar at the bottom. Features add to it
// through the Ui interface instead of touching the DOM layout directly.

import './style.css';
import { el } from './dom';

export interface PanelOptions {
  /** Stable id, used for remembering collapsed state. */
  id: string;
  title: string;
  /** Sort key; lower comes first. Core panels use 0-99, features 100+. */
  order?: number;
  collapsed?: boolean;
}

export interface ToolbarButtonOptions {
  id: string;
  label: string;
  title?: string;
  /** 'left' (default) next to the app name, 'right' at the far end. */
  side?: 'left' | 'right';
  onClick: () => void;
}

export interface Ui {
  /** Adds a sidebar panel and returns its body element to fill. */
  addPanel(options: PanelOptions): HTMLElement;
  addToolbarButton(options: ToolbarButtonOptions): HTMLButtonElement;
  /** Puts arbitrary content in the toolbar. */
  addToolbarItem(element: HTMLElement, side?: 'left' | 'right'): void;
  /** Sets (or clears, with null) a named segment of the status bar. */
  setStatus(key: string, text: string | null): void;
  /** Shows a modal dialog; returns a function that closes it. */
  openDialog(title: string, content: HTMLElement, options?: { wide?: boolean; onClose?: () => void }): () => void;
  /** Brief non-blocking message, e.g. "Saved". */
  toast(message: string, kind?: 'info' | 'error'): void;
  /** Element stacked over the viewport canvas (pointer-events: none; children may opt in). */
  readonly viewportOverlay: HTMLElement;
  /** The element the renderer's canvas lives in. */
  readonly viewport: HTMLElement;
}

export function createShell(root: HTMLElement): Ui {
  const toolbarLeft = el('div', { class: 'toolbar-group' }, [el('span', { class: 'app-name' }, ['umastudio'])]);
  const toolbarRight = el('div', { class: 'toolbar-group' });
  const toolbar = el('header', { class: 'toolbar' }, [toolbarLeft, el('div', { class: 'toolbar-spacer' }), toolbarRight]);

  const viewportOverlay = el('div', { class: 'viewport-overlay' });
  const viewport = el('main', { class: 'viewport' }, [viewportOverlay]);
  const sidebar = el('aside', { class: 'sidebar' });
  const status = el('footer', { class: 'statusbar' });
  const toasts = el('div', { class: 'toasts' });

  root.classList.add('app');
  root.append(toolbar, viewport, sidebar, status, toasts);

  const panels: { order: number; element: HTMLElement }[] = [];
  const statusSegments = new Map<string, HTMLElement>();

  return {
    viewport,
    viewportOverlay,

    addPanel({ id, title, order = 100, collapsed = false }) {
      const storageKey = `umastudio.panel.${id}.collapsed`;
      const stored = readStorage(storageKey);
      const body = el('div', { class: 'panel-body' });
      const header = el('button', { class: 'panel-header', type: 'button' }, [title]);
      const panel = el('section', { class: 'panel', 'data-panel': id }, [header, body]);
      if (stored === null ? collapsed : stored === '1') panel.classList.add('collapsed');
      header.addEventListener('click', () => {
        const isCollapsed = panel.classList.toggle('collapsed');
        writeStorage(storageKey, isCollapsed ? '1' : '0');
      });

      const entry = { order, element: panel };
      const index = panels.findIndex((p) => p.order > order);
      if (index === -1) {
        panels.push(entry);
        sidebar.append(panel);
      } else {
        sidebar.insertBefore(panel, panels[index]!.element);
        panels.splice(index, 0, entry);
      }
      return body;
    },

    addToolbarButton({ id, label, title, side = 'left', onClick }) {
      const button = el('button', { class: 'tool-button', type: 'button', 'data-tool': id, title: title ?? label }, [label]);
      button.addEventListener('click', onClick);
      (side === 'left' ? toolbarLeft : toolbarRight).append(button);
      return button;
    },

    addToolbarItem(element, side = 'left') {
      (side === 'left' ? toolbarLeft : toolbarRight).append(element);
    },

    setStatus(key, text) {
      let segment = statusSegments.get(key);
      if (text === null) {
        segment?.remove();
        statusSegments.delete(key);
        return;
      }
      if (!segment) {
        segment = el('span', { class: 'status-segment', 'data-status': key });
        statusSegments.set(key, segment);
        status.append(segment);
      }
      segment.textContent = text;
    },

    openDialog(title, content, { wide = false, onClose } = {}) {
      const closeButton = el('button', { class: 'dialog-close', type: 'button', title: 'Close' }, ['×']);
      const dialog = el('div', { class: wide ? 'dialog wide' : 'dialog', role: 'dialog' }, [
        el('div', { class: 'dialog-header' }, [el('h2', {}, [title]), closeButton]),
        el('div', { class: 'dialog-body' }, [content]),
      ]);
      const backdrop = el('div', { class: 'dialog-backdrop' }, [dialog]);
      const close = () => {
        backdrop.remove();
        window.removeEventListener('keydown', onKey);
        onClose?.();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
      };
      closeButton.addEventListener('click', close);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
      });
      window.addEventListener('keydown', onKey);
      document.body.append(backdrop);
      return close;
    },

    toast(message, kind = 'info') {
      const t = el('div', { class: `toast ${kind}` }, [message]);
      toasts.append(t);
      setTimeout(() => t.remove(), kind === 'error' ? 6000 : 2500);
    },
  };
}

// localStorage can throw (private mode, blocked storage); panel state is a convenience.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
