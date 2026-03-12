/**
 * Cloudflare D1 REST API client using fetch()
 * Workers環境で `cloudflare` npmパッケージが動かないため、
 * fetch() を使って直接D1 REST APIを叩くカスタムクライアント
 */
export function createD1FetchClient(config: {
  accountId: string;
  databaseId: string;
  apiToken: string;
}) {
  return {
    query: async ({ sql, params }: { sql: string; params?: unknown[] }) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params: params || [] }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`D1 REST API error (${response.status}): ${text}`);
      }

      return response.json();
    },
  };
}
