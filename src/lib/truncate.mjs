export function normalizePaging(paging = {}, options = {}) {
  const defaultLimit = options.defaultLimit ?? 100;
  const maxLimit = options.maxLimit ?? 500;
  const rawLimit = Number.isFinite(paging.limit) ? Math.trunc(paging.limit) : defaultLimit;
  const rawOffset = Number.isFinite(paging.offset) ? Math.trunc(paging.offset) : 0;
  return {
    limit: Math.min(Math.max(rawLimit, 1), maxLimit),
    offset: Math.max(rawOffset, 0)
  };
}

export function pageRows(rows, paging = {}, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const { limit, offset } = normalizePaging(paging, options);
  const page = list.slice(offset, offset + limit);
  return {
    rows: page,
    total: list.length,
    offset,
    limit,
    truncated: offset + page.length < list.length
  };
}

export function pagingNote(page, label) {
  if (!page.truncated) {
    return `${label}: showing ${page.rows.length} of ${page.total}.`;
  }
  return `${label}: showing ${page.rows.length} of ${page.total} (offset ${page.offset}). Narrow the query with filters or use offset/limit to see more.`;
}
