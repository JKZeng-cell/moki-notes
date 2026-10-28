import type { Root } from 'mdast';

// Readable Markdown containers. Choose a fence longer than any content fence,
// so code examples and nested imported containers cannot close the outer row.
export function columnsMarkdown(columns: string[]) {
  const length = Math.max(3, ...columns.flatMap(text => [...text.matchAll(/^(:{3,})/gm)].map(m => m[1].length + 1)));
  const fence = ':'.repeat(length);
  return `${fence}moki-columns\n\n${columns.map(text => `${fence}column\n\n${text.trim()}`).join('\n\n')}\n\n${fence}end-columns`;
}
export function parseColumnsMarkdown(source: string) {
  const start = /^(:{3,})moki-columns[ \t]*\r?\n/.exec(source);
  if (!start) return;
  const fence = start[1], columns: string[] = [];
  let offset = start[0].length, current: string[] | null = null, codeFence: string | null = null;
  for (const line of source.slice(offset).match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!line) continue;
    offset += line.length;
    const value = line.trimEnd();
    const code = /^ {0,3}(`{3,}|~{3,})/.exec(value);
    if (codeFence) {
      if (new RegExp(`^ {0,3}${codeFence[0]}{${codeFence.length},}\\s*$`).test(value)) codeFence = null;
    } else if (code) codeFence = code[1];
    else if (value === `${fence}column`) { if (current) columns.push(current.join('').trim()); current = []; continue; }
    else if (value === `${fence}end-columns`) {
      if (current) columns.push(current.join('').trim());
      return columns.length >= 2 ? { raw: source.slice(0, offset), columns } : undefined;
    }
    if (current) current.push(line); else if (value.trim()) return;
  }
}

export function remarkColumns() {
  return (tree: Root) => {
    const marker = (node: any): string => node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'text' ? node.children[0].value : '';
    const visit = (parent: any) => {
      if (!parent.children) return;
      const input = parent.children, output = [];
      for (let i = 0; i < input.length; i++) {
        const start = /^(:{3,})moki-columns$/.exec(marker(input[i]));
        if (!start) { visit(input[i]); output.push(input[i]); continue; }
        const fence = start[1], columns: any[] = [];
        let end = i + 1, current: any[] | null = null, valid = false;
        for (; end < input.length; end++) {
          const text = marker(input[end]);
          if (text === `${fence}column`) { if (current) columns.push(current); current = []; }
          else if (text === `${fence}end-columns`) { if (current) columns.push(current); valid = columns.length >= 2; break; }
          else if (current) current.push(input[end]); else break;
        }
        if (!valid) { output.push(input[i]); continue; }
        const children = columns.map(children => ({ type: 'mokiColumn', data: { hName: 'div', hProperties: { className: 'moki-column' } }, children }));
        children.forEach(visit);
        output.push({ type: 'mokiColumns', data: { hName: 'div', hProperties: { className: 'moki-columns', 'data-columns': children.length, style: `--moki-column-count:${children.length}` } }, children });
        i = end;
      }
      parent.children = output;
    };
    visit(tree);
  };
}
