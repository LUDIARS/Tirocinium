import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

resources.get('/ob-messages', (c) => {
  const messages = readJson<ObMessage[]>('general/ob-messages.json');
  return c.json({ messages });
});
