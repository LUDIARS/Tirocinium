export type EventType = 'page_view' | 'company_view';

export type AnalyticsEvent = {
  event_type: EventType;
  path: string;
  entity_id?: string;
  entity_name?: string;
  ip: string;
  browser: string;
  user_agent: string;
  referrer: string;
};

export type DailySummary = {
  date: string;
  total_events: number;
  unique_ips: number;
  page_views: { path: string; views: number }[];
  top_companies: { entity_id: string; entity_name: string; views: number }[];
  browsers: { browser: string; count: number }[];
};

export type DailyTrend = { date: string; total: number; unique_ips: number };
