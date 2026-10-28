import { expect, it } from 'vitest';
import { noteExcerpt } from '../src/shared/note-excerpt.js';

it('shows readable labels instead of attachment URLs and metadata', () => {
  const source = '![能力地图](/demo/overview.svg)\n\n**记录想法**\n\n[项目附件](</api/assets/abc/content> "moki-resource:file:card:abc")';
  expect(noteExcerpt(source)).toBe('能力地图 记录想法 项目附件');
  expect(noteExcerpt('[说明](https://example.com/a(b))')).toBe('说明');
});
it('keeps meaningful symbols and text while omitting layout markers and HTML', () => {
  expect(noteExcerpt(':::moki-columns\n:::column\n# C# 与 C++\n\n`a > b`\n\n- [x] 完成\n\n<script>private()</script>\n:::end-columns')).toBe('C# 与 C++ a > b 完成');
  expect(noteExcerpt('| 名称 | 状态 |\n| --- | --- |\n| 测试 | ✅ |')).toBe('名称 状态 测试 ✅');
  expect(noteExcerpt('普通文本', 2)).toBe('普通');
});
