// Shot map: a top-down lighting diagram and a settings table for the current scene, with
// PNG / SVG / print (PDF) export. Everything is derived from the scene document, so the
// dialog re-renders on every store change while it is open.

import './shotmap.css';
import type { AppContext } from '../../core/context';
import type { SceneDocument } from '../../scene/types';
import { button } from '../../ui/controls';
import { renderDiagramSvg } from './diagram';
import { renderSettingsTable, settingsRows } from './table';

export function install(ctx: AppContext): void {
  ctx.ui.addToolbarButton({ id: 'shotmap', label: 'Shot map', side: 'right', onClick: () => openShotmap(ctx) });
}

function openShotmap(ctx: AppContext): void {
  const diagram = document.createElement('div');
  diagram.className = 'shotmap-diagram';
  const tableWrap = document.createElement('div');
  tableWrap.className = 'shotmap-table-wrap';

  const refresh = () => {
    const doc = ctx.store.doc;
    diagram.innerHTML = renderDiagramSvg(doc);
    tableWrap.replaceChildren(renderSettingsTable(settingsRows(doc)));
  };
  refresh();

  const actions = document.createElement('div');
  actions.className = 'shotmap-actions';
  actions.append(
    button('Download PNG', () => downloadPng(ctx.store.doc)),
    button('Download SVG', () => downloadSvg(ctx.store.doc)),
    button('Print / PDF', () => printShotmap(ctx.store.doc)),
  );

  const layout = document.createElement('div');
  layout.className = 'shotmap-layout';
  layout.append(diagram, tableWrap);
  const content = document.createElement('div');
  content.className = 'shotmap';
  content.append(layout, actions);

  const unsubscribe = ctx.store.subscribe(() => refresh());
  ctx.ui.openDialog('Shot map', content, { wide: true, onClose: unsubscribe });
}

// ---------------------------------------------------------------- export

function downloadPng(doc: SceneDocument): void {
  // Rasterise the SVG through an Image at 2× scale; the SVG carries its own pixel size.
  const url = URL.createObjectURL(new Blob([renderDiagramSvg(doc)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    const g = canvas.getContext('2d');
    URL.revokeObjectURL(url);
    if (!g) return;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) saveBlob(blob, `${fileBase(doc)}-shotmap.png`);
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function downloadSvg(doc: SceneDocument): void {
  saveBlob(new Blob([renderDiagramSvg(doc)], { type: 'image/svg+xml' }), `${fileBase(doc)}-shotmap.svg`);
}

function printShotmap(doc: SceneDocument): void {
  // A throwaway container plus a @media print rule scoped to it (shotmap.css): the page
  // hides for the print, then the container goes away with the dialog's job done.
  const container = document.createElement('div');
  container.className = 'shotmap-print';
  container.innerHTML = renderDiagramSvg(doc);
  container.append(renderSettingsTable(settingsRows(doc)));
  document.body.append(container);
  document.body.classList.add('shotmap-printing');
  window.print();
  document.body.classList.remove('shotmap-printing');
  container.remove();
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fileBase(doc: SceneDocument): string {
  return doc.meta.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'scene';
}
