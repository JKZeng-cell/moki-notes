import { describe, expect, it, vi } from 'vitest';
import { copyDeveloperEmail } from '../src/desktop/copy-developer-email.js';
import { APP_DEVELOPER_EMAIL } from '../src/shared/app-metadata.js';

describe('developer email clipboard verification', () => {
  it('awaits the asynchronous write before verifying the exact email', async () => {
    let value = '';
    const clipboard = {
      writeText: vi.fn(async (text: string) => { await Promise.resolve(); value = text; }),
      readText: vi.fn(async () => value),
    };
    await copyDeveloperEmail(clipboard);
    expect(value).toBe(APP_DEVELOPER_EMAIL);
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'previous clipboard contents'])('does not report success for %j', async value => {
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => value) };
    await expect(copyDeveloperEmail(clipboard)).rejects.toThrow('无法确认邮箱已复制');
    expect(clipboard.writeText).toHaveBeenCalledTimes(3);
  });
  it('recovers from a transient clipboard lock', async () => {
    const clipboard = {
      writeText: vi.fn().mockRejectedValueOnce(Error('locked')).mockResolvedValue(undefined),
      readText: vi.fn(async () => APP_DEVELOPER_EMAIL),
    };
    await copyDeveloperEmail(clipboard);
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });
  it('surfaces permanent access denial without reading or clearing other content', async () => {
    const clipboard = { writeText: vi.fn(async () => { throw Error('denied'); }), readText: vi.fn() };
    await expect(copyDeveloperEmail(clipboard)).rejects.toThrow('无法确认邮箱已复制');
    expect(clipboard.readText).not.toHaveBeenCalled();
  });
});
