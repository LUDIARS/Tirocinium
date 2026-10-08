// ホストのタイムゾーンに依存しない日次取得スケジュール。
export function newsDayAt(now: Date, hour: number, timeZone: string): string | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('invalid_job_news_daily_hour');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  if (Number(value('hour')) < hour) return null;
  return `${timeZone}:${value('year')}-${value('month')}-${value('day')}`;
}
