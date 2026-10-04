const BASE = '/knowledge/diagnostics';

export function diagnosticsItemsQuery(options = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return `${BASE}/items?${params.toString()}`;
}

export function createKnowledgeDiagnosticsService(client) {
  return {
    async summary() { return (await client.get(`${BASE}/summary`)).data; },
    async items(options) { return (await client.get(diagnosticsItemsQuery(options))).data; },
  };
}
