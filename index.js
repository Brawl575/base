addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const SUPABASE_URL = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : (globalThis.SUPABASE_URL || '');
const SUPABASE_KEY = (typeof SUPABASE_KEY !== 'undefined') ? SUPABASE_KEY : (globalThis.SUPABASE_KEY || '');
const SUPABASE_TABLE = (typeof SUPABASE_TABLE !== 'undefined') ? SUPABASE_TABLE : (globalThis.SUPABASE_TABLE || 'podium_events');

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

async function handleRequest(request) {
  const url = new URL(request.url);

  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (request.method === 'POST' && url.pathname === '/ingest') {
      return await handleIngest(request);
    }

    if (request.method === 'GET' && (url.pathname === '/events' || url.pathname === '/list')) {
      return await handleList(request);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}

async function handleIngest(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // Нормализуем поля, которые ожидаем от Roblox-скрипта
  const payload = {
    models_text: body.models || body.modelsText || body.models_text || '',
    place_id: body.placeId || body.place_id || null,
    job_id: body.jobId || body.job_id || null,
    player_count: Number(body.playerCount ?? body.player_count ?? null),
    max_players: Number(body.maxPlayers ?? body.max_players ?? null),
    raw_payload: body,
    created_at: new Date().toISOString()
  };

  // Отправка в Supabase via PostgREST
  const insertUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${SUPABASE_TABLE}`;
  const resp = await fetch(insertUrl, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      // Prefer: return=representation чтобы вернуть вставлённый объект
      "Prefer": "return=representation"
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'Supabase insert failed', status: resp.status, body: json }), {
      status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  return new Response(JSON.stringify({ ok: true, inserted: json }), {
    status: 201,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

async function handleList(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const limit = Number(params.get('limit') || 100);
  const since = params.get('since'); // ISO timestamp, e.g. 2025-09-30T00:00:00Z
  const order = params.get('order') || 'created_at.desc';

  // Формируем query для PostgREST
  let query = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${SUPABASE_TABLE}?select=*&order=${encodeURIComponent(order)}&limit=${encodeURIComponent(limit)}`;
  if (since) {
    query += `&created_at=gte.${encodeURIComponent(since)}`;
  }

  const resp = await fetch(query, {
    method: 'GET',
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`
    }
  });

  const result = await resp.json();
  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'Supabase query failed', status: resp.status, body: result }), {
      status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  return new Response(JSON.stringify({ ok: true, rows: result }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
