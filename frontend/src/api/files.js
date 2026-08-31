import { ApiClientError, apiFetch } from './client.js';

const SORTS = new Set(['newest', 'oldest', 'name-asc', 'name-desc', 'size-asc', 'size-desc', 'deleted-newest', 'deleted-oldest']);
const VIEWS = new Set(['active', 'recent', 'favorites', 'trash']);

function validPagination(value) {
  return value
    && Number.isSafeInteger(value.page) && value.page >= 1
    && Number.isSafeInteger(value.limit) && value.limit >= 1
    && Number.isSafeInteger(value.total) && value.total >= 0
    && Number.isSafeInteger(value.totalPages) && value.totalPages >= 0
    && typeof value.hasPrevious === 'boolean'
    && typeof value.hasNext === 'boolean';
}

export async function getFiles({
  page = 1,
  limit = 5,
  search = '',
  sort = 'newest',
  visibility = '',
  view = 'active',
  signal,
} = {}) {
  if (!SORTS.has(sort)) throw new TypeError('Unsupported file sort option.');
  if (!VIEWS.has(view)) throw new TypeError('Unsupported file view.');
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort,
    view,
  });
  if (search) query.set('search', search);
  if (visibility) query.set('visibility', visibility);
  const result = await apiFetch(`/api/files?${query}`, { signal });
  if (!Array.isArray(result?.files) || !validPagination(result.pagination)) {
    throw new ApiClientError(
      'Vaulta received an invalid file-list response.',
      502,
      'INVALID_FILE_LIST_RESPONSE',
    );
  }
  return result;
}
