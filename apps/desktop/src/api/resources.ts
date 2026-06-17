import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type ListingSourceEntry = {
  id: string;
  kind: string;
  tier: string;
  urls: string[];
  enabled: boolean;
  note?: string;
};

export type ReferenceLink = {
  name: string;
  url: string;
  description: string;
};

export type ReferenceLinkCategory = {
  id: string;
  name: string;
  links: ReferenceLink[];
};

export type CategorizedSources = {
  active: ListingSourceEntry[];
  planned: ListingSourceEntry[];
  template: ListingSourceEntry[];
};

export type ReferenceLinksResponse = {
  sources: CategorizedSources;
  curated: ReferenceLinkCategory[];
};

export type ObMessage = {
  id: string;
  name: string;
  year: number;
  company: string;
  role: string;
  message: string;
  tags: string[];
};

export type ObMessagesResponse = {
  messages: ObMessage[];
};

export function useResourcesApi() {
  const { token } = useAuth();

  const referenceLinks = (): Promise<ReferenceLinksResponse> =>
    fetchJson('/api/v1/resources/reference-links', token);

  const obMessages = (): Promise<ObMessagesResponse> =>
    fetchJson('/api/v1/resources/ob-messages', token);

  return { referenceLinks, obMessages };
}
