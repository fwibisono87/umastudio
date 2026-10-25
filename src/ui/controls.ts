// Form controls bound to getters and setters, so every panel looks and behaves alike.
//
// Each control reads its value through `get` and writes through `set`; call
// `refresh()` (or bindControls) when the document changes to pull the latest value.
// Controls skip refreshing while the user is typing in them.
//
//   const power = numberField({ label: 'Power', unit: 'Ws', min: 10, max: 2400, step: 10,
//     get: () => light().output.fullPowerWs,
//     set: (v) => store.update((d) => { ... }, { label: 'key power' }) });
//   body.append(power.element);
//   bindControls(store, [power]);

import type { SceneStore } from '../core/store';
import { el } from './dom';

export interface Control {
  element: HTMLElement;
  refresh(): void;
}

interface FieldBase<T> {
  label: string;
  get: () => T;
  set: (value: T) => void;
  title?: string;
}

function row(label: string, input: HTMLElement, title?: string, suffix?: HTMLElement): HTMLElement {
  const attrs: Record<string, string> = { class: 'control-row' };
  if (title) attrs.title = title;
  const children: HTMLElement[] = [el('span', { class: 'control-label' }, [label]), input];
  if (suffix) children.push(suffix);
  return el('label', attrs, children);
}

export interface NumberFieldOptions extends FieldBase<number> {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Digits shown after the decimal point. */
  precision?: number;
}

export function numberField(o: NumberFieldOptions): Control {
  const input = el('input', { type: 'number', class: 'control-input' });
  if (o.min !== undefined) input.min = String(o.min);
  if (o.max !== undefined) input.max = String(o.max);
  input.step = String(o.step ?? 'any');
  const unit = o.unit ? el('span', { class: 'control-unit' }, [o.unit]) : undefined;
  const commit = () => {
    let v = input.valueAsNumber;
    if (!Number.isFinite(v)) return refresh();
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    o.set(v);
  };
  input.addEventListener('change', commit);
  const refresh = () => {
    if (document.activeElement === input) return;
    const v = o.get();
    input.value = o.precision === undefined ? String(v) : v.toFixed(o.precision);
  };
  refresh();
  return { element: row(o.label, input, o.title, unit), refresh };
}

export interface SliderOptions extends FieldBase<number> {
  min: number;
  max: number;
  step?: number;
  /** Text shown next to the slider for the current value. */
  format?: (value: number) => string;
}

export function slider(o: SliderOptions): Control {
  const input = el('input', { type: 'range', class: 'control-slider' });
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step ?? 'any');
  const readout = el('span', { class: 'control-readout' });
  const show = (v: number) => (readout.textContent = o.format ? o.format(v) : String(v));
  input.addEventListener('input', () => {
    o.set(input.valueAsNumber);
    show(input.valueAsNumber);
  });
  const refresh = () => {
    const v = o.get();
    input.value = String(v);
    show(v);
  };
  refresh();
  return { element: row(o.label, input, o.title, readout), refresh };
}

export interface SelectOptions<T extends string | number> extends FieldBase<T> {
  options: readonly { value: T; label: string }[];
}

export function select<T extends string | number>(o: SelectOptions<T>): Control {
  const input = el('select', { class: 'control-input' });
  o.options.forEach((opt, i) => input.append(el('option', { value: String(i) }, [opt.label])));
  input.addEventListener('change', () => {
    const opt = o.options[Number(input.value)];
    if (opt) o.set(opt.value);
  });
  const refresh = () => {
    const i = o.options.findIndex((opt) => opt.value === o.get());
    input.value = String(Math.max(0, i));
  };
  refresh();
  return { element: row(o.label, input, o.title), refresh };
}

export function checkbox(o: FieldBase<boolean>): Control {
  const input = el('input', { type: 'checkbox', class: 'control-check' });
  input.addEventListener('change', () => o.set(input.checked));
  const refresh = () => {
    input.checked = o.get();
  };
  refresh();
  return { element: row(o.label, input, o.title), refresh };
}

export function textField(o: FieldBase<string>): Control {
  const input = el('input', { type: 'text', class: 'control-input' });
  input.addEventListener('change', () => o.set(input.value));
  const refresh = () => {
    if (document.activeElement !== input) input.value = o.get();
  };
  refresh();
  return { element: row(o.label, input, o.title), refresh };
}

/** A read-only value line, e.g. a meter reading. */
export function readout(label: string, get: () => string, title?: string): Control {
  const value = el('span', { class: 'control-value' });
  const refresh = () => {
    value.textContent = get();
  };
  refresh();
  return { element: row(label, value, title), refresh };
}

export function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'control-button', title: title ?? label }, [label]);
  b.addEventListener('click', onClick);
  return b;
}

/** A titled group of controls inside a panel. */
export function group(title: string, children: (HTMLElement | Control)[]): HTMLElement {
  return el('div', { class: 'control-group' }, [
    el('div', { class: 'control-group-title' }, [title]),
    ...children.map((c) => (c instanceof HTMLElement ? c : c.element)),
  ]);
}

/** Refreshes `controls` whenever the document changes. Returns an unsubscribe function. */
export function bindControls(store: SceneStore, controls: Control[]): () => void {
  return store.subscribe(() => controls.forEach((c) => c.refresh()));
}
