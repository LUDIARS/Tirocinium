import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  deleteUserCompanyRelation,
  listUserCompanyRelations,
  upsertUserCompanyRelation,
  type UserCompanyRelationType,
} from '../companies/user-company-relations-repo.js';

export const glabIntegration = new Hono();

export function isLoopbackRequest(c: Context): boolean {
  const address = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming?.socket?.remoteAddress;
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function userId(c: Context): string | null {
  const value = c.req.header('X-Cernere-User-Id')?.trim() ?? '';
  return value.length >= 1 && value.length <= 200 ? value : null;
}

function relationType(value: string): UserCompanyRelationType | null {
  return value === 'desired' || value === 'offer' ? value : null;
}

function offeredOn(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

glabIntegration.use('*', async (c, next) => {
  if (!isLoopbackRequest(c)) return c.json({ error: 'loopback_required' }, 403);
  if (!userId(c)) return c.json({ error: 'invalid_cernere_user_id' }, 400);
  await next();
});

glabIntegration.get('/career-companies', async (c) => {
  const relations = await listUserCompanyRelations(userId(c)!);
  return c.json({ relations });
});

glabIntegration.put('/career-companies/:relationType/:companyId', async (c) => {
  const type = relationType(c.req.param('relationType'));
  if (!type) return c.json({ error: 'invalid_relation_type' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const roleTitle = typeof body.roleTitle === 'string' ? body.roleTitle.trim() : '';
  const offerDate = offeredOn(body.offeredOn);
  if (roleTitle.length > 200) return c.json({ error: 'role_title_too_long' }, 400);
  if (offerDate === undefined) return c.json({ error: 'invalid_offered_on' }, 400);

  const relation = await upsertUserCompanyRelation(
    userId(c)!,
    c.req.param('companyId'),
    type,
    { roleTitle, offeredOn: offerDate },
  );
  return relation ? c.json({ ok: true, relation }) : c.json({ error: 'company_not_found' }, 404);
});

glabIntegration.delete('/career-companies/:relationType/:companyId', async (c) => {
  const type = relationType(c.req.param('relationType'));
  if (!type) return c.json({ error: 'invalid_relation_type' }, 400);
  await deleteUserCompanyRelation(userId(c)!, c.req.param('companyId'), type);
  return c.json({ ok: true });
});
