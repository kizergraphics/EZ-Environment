import { validateTriangleTargets } from '../generators/triangle-targets.js';

export function createTriangleControls(onGenerate, onPreview, onError) {
  const element = document.createElement('div');
  element.className = 'triangle-controls';
  const hint = document.createElement('p');
  hint.textContent = 'Leave targets blank for automatic detail. Actual counts can vary with mesh topology.';
  element.append(hint);

  const rows = [0, 1, 2].map((level) => {
    const row = document.createElement('div');
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'studio-button';
    preview.textContent = `LOD ${level}`;
    preview.title = `Preview LOD ${level}`;
    preview.addEventListener('click', () => onPreview(level));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = 'Auto';
    input.setAttribute('aria-label', `LOD ${level} triangle target`);
    const count = document.createElement('output');
    count.setAttribute('aria-label', `LOD ${level} actual triangles`);
    row.append(preview, input, count);
    element.append(row);
    return { preview, input, count };
  });

  const generate = document.createElement('button');
  generate.type = 'button';
  generate.className = 'studio-button';
  generate.textContent = 'Generate LODs';
  generate.addEventListener('click', async () => {
    generate.disabled = true;
    try {
      const targets = rows.map(({ input }) => input.value === '' && !input.validity.badInput ? null : input.valueAsNumber);
      await onGenerate(validateTriangleTargets(targets));
    } catch (error) {
      onError(error.message);
    } finally {
      generate.disabled = false;
    }
  });
  element.append(generate);
  return {
    element,
    setTargets(targets) {
      rows.forEach(({ input }, level) => { input.value = targets?.[level] ?? ''; });
    },
    showCounts(counts, selected) {
      rows.forEach(({ count, preview }, level) => {
        const actual = counts?.[level];
        count.textContent = actual === undefined ? '—' : `${actual.toLocaleString()} tris`;
        preview.setAttribute('aria-pressed', String(level === selected));
      });
    },
  };
}
