import type { ObEsRequest } from '../companies/ob-es-requests-repo.js';

type ReviewView = Pick<ObEsRequest, 'id' | 'target_company_id' | 'target_company_name' | 'status' | 'created_at' | 'updated_at'>;

/** Deliberate public projection: internal participant identities never cross the API. */
export function reviewView(request: ObEsRequest): ReviewView {
  return {
    id: request.id,
    target_company_id: request.target_company_id,
    target_company_name: request.target_company_name,
    status: request.status,
    created_at: request.created_at,
    updated_at: request.updated_at,
  };
}
