const options: Intl.DateTimeFormatOptions = {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
};
const compact = new Intl.DateTimeFormat('zh-CN', options);
const full = new Intl.DateTimeFormat('zh-CN', { ...options, year: 'numeric' });

/** Display the saved edit time in the device's local time, without seconds. */
export function noteEditTime(value: string, includeYear = false) {
  return (includeYear ? full : compact).format(new Date(value));
}
