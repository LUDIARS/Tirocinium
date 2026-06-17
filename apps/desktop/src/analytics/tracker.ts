import { SERVER_URL } from '../config.js';

type TrackEvent = {
  event_type: 'page_view' | 'company_view';
  path: string;
  entity_id?: string;
  entity_name?: string;
};

async function send(e: TrackEvent): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/api/v1/analytics/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...e, referrer: document.referrer }),
    });
  } catch {
    // 解析ログ失敗はサイレントに無視する
  }
}

export const tracker = {
  pageView: (path: string) => send({ event_type: 'page_view', path }),
  companyView: (id: string, name: string, currentPath: string) =>
    send({ event_type: 'company_view', path: currentPath, entity_id: id, entity_name: name }),
};
