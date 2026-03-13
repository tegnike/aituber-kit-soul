const getConfig = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url, key };
};

const supabaseFetch = async (
  path: string,
  options: RequestInit,
): Promise<Response> => {
  const config = getConfig();
  if (!config) throw new Error('Supabase not configured');

  return fetch(`${config.url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
    signal: AbortSignal.timeout(5000),
  });
};

export async function ensureSession(sessionId: string): Promise<void> {
  if (!getConfig()) {
    console.warn('[supabase-message-store] SUPABASE_URL or SUPABASE_SECRET_KEY not set, skipping');
    return;
  }
  try {
    await supabaseFetch('/public_chat_sessions', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: sessionId }),
    });
  } catch (e) {
    console.error('[supabase-message-store] ensureSession failed:', e);
  }
}

export async function saveMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
}): Promise<void> {
  if (!getConfig()) {
    console.warn('[supabase-message-store] SUPABASE_URL or SUPABASE_SECRET_KEY not set, skipping');
    return;
  }
  try {
    await supabaseFetch('/public_messages', {
      method: 'POST',
      body: JSON.stringify({
        session_id: params.sessionId,
        role: params.role,
        content: params.content,
        source_id: null,
      }),
    });
  } catch (e) {
    console.error('[supabase-message-store] saveMessage failed:', e);
  }
}
