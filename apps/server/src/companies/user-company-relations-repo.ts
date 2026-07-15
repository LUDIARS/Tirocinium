import { sql } from '../db/index.js';
import { getCompany } from './repo.js';

export type UserCompanyRelationType = 'desired' | 'offer';

export interface UserCompanyRelation {
  company_id: string;
  company_name: string;
  company_url: string;
  industry: string;
  relation_type: UserCompanyRelationType;
  role_title: string;
  offered_on: string | null;
  created_at: string;
  updated_at: string;
}

const selectRelation = () => sql`
  r.company_id, c.name AS company_name, c.url AS company_url, c.industry,
  r.relation_type, r.role_title, r.offered_on, r.created_at, r.updated_at
`;

export async function listUserCompanyRelations(
  cernereUserId: string,
): Promise<UserCompanyRelation[]> {
  return sql<UserCompanyRelation[]>`
    SELECT ${selectRelation()}
    FROM user_company_relations r
    JOIN companies c ON c.id = r.company_id
    WHERE r.cernere_user_id = ${cernereUserId}
    ORDER BY r.relation_type, r.updated_at DESC, c.name
  `;
}

export async function upsertUserCompanyRelation(
  cernereUserId: string,
  companyId: string,
  relationType: UserCompanyRelationType,
  input: { roleTitle?: string; offeredOn?: string | null } = {},
): Promise<UserCompanyRelation | null> {
  if (!await getCompany(companyId)) return null;

  const roleTitle = relationType === 'offer' ? (input.roleTitle ?? '') : '';
  const offeredOn = relationType === 'offer' ? (input.offeredOn ?? null) : null;
  await sql`
    INSERT INTO user_company_relations
      (cernere_user_id, company_id, relation_type, role_title, offered_on)
    VALUES (${cernereUserId}, ${companyId}, ${relationType}, ${roleTitle}, ${offeredOn})
    ON CONFLICT (cernere_user_id, company_id, relation_type) DO UPDATE SET
      role_title = EXCLUDED.role_title,
      offered_on = EXCLUDED.offered_on,
      updated_at = now()
  `;

  const rows = await sql<UserCompanyRelation[]>`
    SELECT ${selectRelation()}
    FROM user_company_relations r
    JOIN companies c ON c.id = r.company_id
    WHERE r.cernere_user_id = ${cernereUserId}
      AND r.company_id = ${companyId}
      AND r.relation_type = ${relationType}
  `;
  return rows[0] ?? null;
}

export async function deleteUserCompanyRelation(
  cernereUserId: string,
  companyId: string,
  relationType: UserCompanyRelationType,
): Promise<void> {
  await sql`
    DELETE FROM user_company_relations
    WHERE cernere_user_id = ${cernereUserId}
      AND company_id = ${companyId}
      AND relation_type = ${relationType}
  `;
}
