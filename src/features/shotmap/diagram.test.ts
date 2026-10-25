import { describe, expect, it } from 'vitest';
import { createDefaultScene, createLight } from '../../scene/document';
import { renderDiagramSvg } from './diagram';

describe('shotmap diagram', () => {
  it('draws one marked element per light plus camera, subject and backdrop', () => {
    const doc = createDefaultScene();
    doc.lights.push(createLight('rim', 'Rim', { position: [0, 2, -1.2] }));
    const svg = renderDiagramSvg(doc);
    expect((svg.match(/data-light-id=/g) ?? []).length).toBe(doc.lights.length);
    expect(svg).toContain('data-light-id="key"');
    expect(svg).toContain('data-light-id="rim"');
    expect(svg).toContain('data-kind="camera"');
    expect(svg).toContain('data-kind="subject"');
    expect(svg).toContain('data-kind="backdrop"');
  });

  it('shows the camera settings label and a 1 m scale bar', () => {
    const svg = renderDiagramSvg(createDefaultScene());
    expect(svg).toContain('85 mm · f/8 · 1/125 · ISO 100');
    expect(svg).toContain('>1 m<');
  });

  it('draws disabled lights greyed out and dashed', () => {
    const doc = createDefaultScene();
    doc.lights.push(createLight('off', 'Off light', { enabled: false, position: [-1.5, 2, 1.5] }));
    const svg = renderDiagramSvg(doc);
    expect(svg).toMatch(/<g data-light-id="off"[^>]*stroke-dasharray/);
    expect(svg).toMatch(/<g data-light-id="off"[^>]*#9aa0a6/);
    expect(svg).not.toMatch(/<g data-light-id="key"[^>]*stroke-dasharray/);
  });

  it('escapes user text in labels', () => {
    const doc = createDefaultScene();
    doc.lights[0]!.name = '<b>key & fill</b>';
    doc.subject.modelName = 'Uma "<t>"';
    const svg = renderDiagramSvg(doc);
    expect(svg).toContain('&lt;b&gt;key &amp; fill&lt;/b&gt;');
    expect(svg).toContain('Uma &quot;&lt;t&gt;&quot;');
    expect(svg).not.toContain('<b>key');
    expect(svg).not.toContain('fill</b>');
  });

  it('scales the viewBox to the plan bounds', () => {
    const svg = renderDiagramSvg(createDefaultScene());
    const viewBox = /viewBox="([^"]+)"/.exec(svg);
    expect(viewBox).not.toBeNull();
    const values = viewBox![1]!.split(' ').map(Number);
    expect(values).toHaveLength(4);
    expect(values[2]!).toBeGreaterThan(0);
    expect(values[3]!).toBeGreaterThan(0);
    expect(svg).toMatch(/width="\d+(\.\d+)?" height="\d+(\.\d+)?"/);
  });
});
