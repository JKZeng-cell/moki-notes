import type {} from 'mdast-util-to-hast';
import type { Processor } from 'unified';
import type { Construct, State, Tokenizer } from 'micromark-util-types';
import type { Extension } from 'mdast-util-from-markdown';

// Only these three inline formats are admitted. Arbitrary HTML/styles remain
// inert; the same syntax is used by the editor, preview and document exports.
export const inlineMarks = [
  { name: 'underline', open: '<u>', close: '</u>', tag: 'u' },
  { name: 'highlight', open: '==', close: '==', tag: 'mark' },
  { name: 'textColor', open: '{{color:#', close: '{{/color}}', tag: 'span' },
] as const;

export function matchInlineMark(source: string, mark: typeof inlineMarks[number]) {
  const opener = mark.name === 'textColor' ? /^\{\{color:#[\da-fA-F]{6}\}\}/.exec(source)?.[0] : source.startsWith(mark.open) ? mark.open : undefined;
  if (!opener) return;
  let ticks = 0;
  for (let i = opener.length; i < source.length; i++) {
    if (source[i] === '\n') return;
    if (source[i] === '\\' && !ticks) { i++; continue; }
    if (source[i] === '`') {
      let count = 1; while (source[i + count] === '`') count++;
      ticks = ticks === count ? 0 : ticks || count; i += count - 1; continue;
    }
    if (!ticks && source.startsWith(mark.close, i)) {
      if (i === opener.length) return;
      return { raw: source.slice(0, i + mark.close.length), text: source.slice(opener.length, i), color: opener.match(/#[\da-fA-F]{6}/)?.[0] };
    }
  }
}

declare module 'mdast' { interface Data { mokiMark?: string; color?: string } }

declare module 'micromark-util-types' {
  interface TokenTypeMap { mokiInline: 'mokiInline'; mokiDelimiter: 'mokiDelimiter' }
  interface Token { mokiName?: string; mokiColor?: string }
}

export function remarkMokiMarks(this: Processor) {
  const text: Record<number, Construct[]> = {};
  for (const mark of inlineMarks) {
    const tokenize: Tokenizer = function (effects, ok, nok) {
      const token = effects.enter('mokiInline'); token.mokiName = mark.name;
      let offset = 0, color = '', length = 0, escaped = false, ticks = 0, tickRun = 0;
      const opener = mark.name === 'textColor' ? '{{color:#xxxxxx}}' : mark.open;
      effects.enter('mokiDelimiter');
      const opening: State = code => {
        if (offset === opener.length) {
          effects.exit('mokiDelimiter'); token.mokiColor = color ? `#${color}` : undefined;
          effects.enter('chunkText', { contentType: 'text' }); return body(code);
        }
        if (code === null || code < 0) return nok(code);
        if (mark.name === 'textColor' && offset >= 9 && offset < 15) {
          if (!/[\da-fA-F]/.test(String.fromCharCode(code))) return nok(code);
          color += String.fromCharCode(code);
        } else if (code !== opener.charCodeAt(offset)) return nok(code);
        effects.consume(code); offset++; return opening;
      };
      const closer: Construct = { tokenize(e, yes, no) {
        let i = 0;
        const next: State = code => {
          if (i === mark.close.length) return yes(code);
          if (code !== mark.close.charCodeAt(i)) return no(code);
          e.consume(code); i++; return next;
        }; return next;
      } };
      const closing: State = code => {
        effects.exit('chunkText'); effects.enter('mokiDelimiter'); let i = 0;
        const next: State = c => {
          if (i === mark.close.length) { effects.exit('mokiDelimiter'); effects.exit('mokiInline'); return ok(c); }
          effects.consume(c!); i++; return next;
        }; return next(code);
      };
      const consume: State = code => { effects.consume(code!); length++; return body; };
      const body: State = code => {
        if (code === null || code < 0) return nok(code);
        if (escaped) { escaped = false; return consume(code); }
        if (code === 96) { tickRun++; return consume(code); }
        if (tickRun) { ticks = ticks === tickRun ? 0 : ticks || tickRun; tickRun = 0; }
        if (code === 92 && !ticks) { escaped = true; return consume(code); }
        if (!ticks && code === mark.close.charCodeAt(0)) return length ? effects.check(closer, closing, consume)(code) : nok(code);
        return consume(code);
      };
      return opening;
    };
    (text[mark.open.charCodeAt(0)] ??= []).push({ name: `moki-${mark.name}`, tokenize });
  }
  const fromMarkdown: Extension = {
    enter: { mokiInline(token) {
      const mark = inlineMarks.find(m => m.name === token.mokiName)!;
      this.enter({ type: 'emphasis', children: [], data: {
        mokiMark: mark.name, color: token.mokiColor, hName: mark.tag,
        hProperties: token.mokiColor ? { style: `color:${token.mokiColor}` } : {},
      } }, token);
    } },
    exit: { mokiInline(token) { this.exit(token); } },
  };
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ text });
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
}
