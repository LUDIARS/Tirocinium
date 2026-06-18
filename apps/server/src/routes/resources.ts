import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStudentMessages } from '../companies/backdoor-repo.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../data');

export const resources = new Hono();

type ListingSource = {
  id: string;
  kind: string;
  tier: string;
  urls: string[];
  enabled: boolean;
  note?: string;
};

type ReferenceLink = {
  name: string;
  url: string;
  description: string;
};

type ReferenceLinkCategory = {
  id: string;
  name: string;
  links: ReferenceLink[];
};

type ObMessage = {
  id: string;
  name: string;
  year: number;
  company: string;
  role: string;
  message: string;
  tags: string[];
};

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, relPath), 'utf-8')) as T;
}

function categorizeSources(sources: ListingSource[]) {
  const active = sources.filter((s) => s.enabled && !s.urls.some((u) => u.includes('example.com')));
  const planned = sources.filter(
    (s) => !s.enabled && !s.urls.some((u) => u.includes('example.com')),
  );
  const template = sources.filter((s) => s.urls.some((u) => u.includes('example.com')));
  return { active, planned, template };
}

resources.get('/reference-links', (c) => {
  const sources = readJson<ListingSource[]>('companies/listing-sources.json');
  const curated = readJson<ReferenceLinkCategory[]>('general/reference-links.json');
  const categorized = categorizeSources(sources);
  return c.json({ sources: categorized, curated });
});

// 卒業生からのメッセージ = 裏口で学生向けに公開された自己投稿 (DB) + 旧来の手編集 json。
// DB 由来を先頭に (最新の自己投稿)、 続けて curated な json を載せる。
resources.get('/ob-messages', async (c) => {
  const curated = readJson<ObMessage[]>('general/ob-messages.json');
  const live = await listStudentMessages();
  const fromBackdoor: ObMessage[] = live.map((e) => ({
    id: e.id,
    name: e.display_name || '卒業生',
    year: 0,
    company: e.current_company,
    role: 'general',
    message: e.message_to_students,
    tags: [],
  }));
  return c.json({ messages: [...fromBackdoor, ...curated] });
});
