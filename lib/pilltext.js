// Pill labels must stay pill-sized. Most pills carry text we wrote ourselves, but
// any pill that shows a *parameter value* inherits whatever the site sent: a
// dynamic-remarketing `id` can carry a whole basket, an order ref can be
// arbitrary. `.pill` is white-space: nowrap, so an unbounded value stretches the
// pill until the card header breaks. Every value-bearing pill routes through
// clip(); the untouched value stays reachable in the pill title and the detail.

export const PILL_MAX = 24;

export function clip(v, max = PILL_MAX) {
  const s = String(v == null ? '' : v).trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

// A remarketing/product id param is one id or a comma-separated basket of them.
export function idList(v) {
  return String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);
}
