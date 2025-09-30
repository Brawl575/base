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

function parsePlayersValue(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    // Попытка распарсить JSON-строку
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return JSON.parse(s); } catch (e) { /* fallthrough */ }
    }
    // Попытка преобразовать в число
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
    return s;
  }
  // число или другое — вернём как есть
  return v;
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

  // Нормализация названий полей (поддержка разных регистров/вариантов)
  const name = body.Name ?? body.name ?? '';
  const generation = body.Generation ?? body.generation ?? '';
  const mutation = body.Mutation ?? body.mutation ?? '';
  const rarity = body.Rarity ?? body.rarity ?? '';
  const jobid = body.Jobid ?? body.jobId ?? body.job_id ?? body.jobid ?? '';

  const playersRaw = body.Players ?? body.players ?? null;
  const players = parsePlayersValue(playersRaw);

  // created_at: если клиент прислал — используем его; иначе генерируем текущее время (ISO => timestamptz)
  const created_at = body.created_at ?? body.timestamp ?? body.timestampz ?? new Date().toISOString();

  const payload = {
    name,
    generation,
    mutation,
    rarity,
    jobid,
    players,
    created_at
  };

  const insertUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${SUPABASE_TABLE}`;
  const resp = await fetch(insertUrl, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
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
  const since = params.get('since'); // ISO timestamp
  const order = params.get('order') || 'created_at.desc';

  // Запросим только нужные поля + created_at
  let query = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${SUPABASE_TABLE}?select=name,generation,mutation,rarity,jobid,players,created_at&order=${encodeURIComponent(order)}&limit=${encodeURIComponent(limit)}`;
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
