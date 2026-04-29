const buildPaginationLinks = (basePath, queryObject, page, limit, total) => {
  const total_pages = Math.max(1, Math.ceil(total / limit));
  const flat = { ...queryObject };
  delete flat.page;
  delete flat.limit;

  const mk = (p) => {
    const params = new URLSearchParams();
    Object.entries(flat).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") params.set(k, String(v));
    });
    params.set("page", String(p));
    params.set("limit", String(limit));
    const qs = params.toString();
    return `${basePath}?${qs}`;
  };

  return {
    self: mk(page),
    next: page < total_pages ? mk(page + 1) : null,
    prev: page > 1 ? mk(page - 1) : null,
    total_pages
  };
};

module.exports = { buildPaginationLinks };
