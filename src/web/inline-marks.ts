import { Mark, markInputRule, mergeAttributes, type KeyboardShortcutCommand } from '@tiptap/core';
import { inlineMarks, matchInlineMark } from '../shared/markdown-marks.js';

function normalizeColor(color: string) {
  if (/^#[\da-f]{6}$/i.test(color)) return color.toLowerCase();
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(color);
  return rgb ? '#' + rgb.slice(1).map(c => Math.min(255, Number(c)).toString(16).padStart(2, '0')).join('') : '#625bc5';
}

export const inlineMarkExtensions = inlineMarks.map(mark => Mark.create({
  name: mark.name,
  addAttributes: () => mark.name === 'textColor' ? { color: { default: '#625bc5', parseHTML: el => normalizeColor(el.style.color) } } : {},
  parseHTML: () => [{ tag: mark.name === 'textColor' ? 'span[data-moki-color]' : mark.tag }],
  renderHTML: ({ HTMLAttributes }) => [mark.tag, mergeAttributes(mark.name === 'textColor' ? {
    'data-moki-color': '', style: /^#[\da-f]{6}$/i.test(HTMLAttributes.color) ? `color:${HTMLAttributes.color}` : undefined,
  } : {}, mark.name === 'textColor' ? {} : HTMLAttributes), 0],
  markdownTokenName: mark.name,
  markdownTokenizer: { name: mark.name, level: 'inline', start: src => src.indexOf(mark.open), tokenize: (src, _tokens, lexer) => {
    const match = matchInlineMark(src, mark);
    return match ? { type: mark.name, ...match, tokens: lexer.inlineTokens(match.text) } : undefined;
  } },
  parseMarkdown: (token, h) => h.applyMark(mark.name, h.parseInline(token.tokens ?? []), mark.name === 'textColor' ? { color: token.color } : undefined),
  renderMarkdown: (node, h) => `${mark.name === 'textColor' ? `{{color:${node.attrs?.color}}}` : mark.open}${h.renderChildren(node)}${mark.close}`,
  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> { return mark.name === 'underline' ? { 'Mod-u': () => this.editor.commands.toggleMark('underline') } : {}; },
  addInputRules() { return mark.name === 'highlight' ? [markInputRule({ find: /(?:^|\s)(==(?!\s)([^=]+)==)$/, type: this.type })] : []; },
}));
