import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { locateFeishuCli, parseCliOutput, makeCliRunner } from '../src/server/feishu-cli.js';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
it('uses the bundled executable without PATH or npm; explicit overrides remain explicit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moki-cli-')); dirs.push(dir);
  const bundled = join(dir, 'bundled.exe'), global = join(dir, 'global.exe'); writeFileSync(bundled, ''); writeFileSync(global, '');
  expect(locateFeishuCli(undefined, bundled, [])).toBe(bundled);
  expect(locateFeishuCli(undefined, bundled, [global])).toBe(bundled);
  expect(locateFeishuCli(global, bundled, [])).toBe(global);
  expect(() => locateFeishuCli(join(dir, 'missing.exe'), bundled, [])).toThrow('自定义');
  expect(() => locateFeishuCli(undefined, undefined, [])).toThrow('内置');
});
it('accepts CLI success envelopes and raw auth status without relying on code=0', () => {
  expect(parseCliOutput(0, '{"ok":true,"data":{"file_token":"abc"}}', '')).toEqual({file_token:'abc'});
  expect(parseCliOutput(0, '{"appId":"id"}', '')).toEqual({appId:'id'});
  expect(parseCliOutput(0, 'Saved configuration', '', true)).toBe('Saved configuration');
});
it('reports permission/confirmation failures and never parses an error as success', () => {
  expect(() => parseCliOutput(1, '', '{"ok":false,"error":{"message":"denied","missing_scopes":["drive:file:read"]}}')).toThrow('drive:file:read');
  expect(() => parseCliOutput(10, '', '{"ok":false}')).toThrow('额外确认');
  expect(() => parseCliOutput(0, '{"ok":false}', '')).toThrow('飞书操作失败');
  expect(() => parseCliOutput(1, 'bad', 'bad')).toThrow('无法解析');
});
it('terminates an owned polling process when cancelled and rejects already cancelled calls', async () => {
  const controller = new AbortController(), cli = makeCliRunner(process.execPath);
  const task = cli(['-e','setInterval(()=>{},1000)'], {signal:controller.signal,timeoutMs:10000});
  const rejected = expect(task).rejects.toThrow('取消');
  setTimeout(()=>controller.abort(),40); await rejected;
  await expect(cli(['-e','process.exit(0)'], {signal:controller.signal})).rejects.toThrow('取消');
});
