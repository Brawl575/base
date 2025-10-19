addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const clients = new Set();

async function handleRequest(request) {
  const url = new URL(request.url);

  // WebSocket endpoint
  if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
    return handleWebSocket(request);
  }

  // HTTP data ingestion endpoint
  if (url.pathname === '/ingest' && request.method === 'POST') {
    try {
      const body = await request.text();

      // Рассылаем полученные данные всем подключённым клиентам
      for (const socket of clients) {
        try {
          socket.send(body);
        } catch {
          clients.delete(socket);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }
  }

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return new Response(
    JSON.stringify({ error: 'Invalid endpoint. Use /ws or /ingest' }),
    { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
}

function handleWebSocket(request) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  clients.add(server);
  console.log("🔗 Новый клиент подключен. Всего:", clients.size);

  server.addEventListener('close', () => {
    clients.delete(server);
    console.log("❌ Клиент отключился. Осталось:", clients.size);
  });

  return new Response(null, { status: 101, webSocket: client });
}
