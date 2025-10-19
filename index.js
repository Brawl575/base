addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Активные WebSocket-клиенты
const clients = new Set();
// Буфер последних событий
const buffer = [];

async function handleRequest(request) {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // WebSocket endpoint
  if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
    return handleWebSocket(request);
  }

  // HTTP ingest endpoint
  if (url.pathname === '/ingest' && request.method === 'POST') {
    return handleIngest(request);
  }

  // Ошибка по умолчанию
  return new Response(
    JSON.stringify({ error: 'Invalid endpoint. Use /ws or /ingest' }),
    { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
}

// 📡 Обработка WebSocket-подключений
function handleWebSocket(request) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  clients.add(server);
  console.log("🔗 Новый клиент подключен. Всего:", clients.size);

  // 🔁 Отправляем накопленные события новому клиенту
  for (const item of buffer) {
    try { server.send(item); } catch { /* игнорируем */ }
  }

  server.addEventListener('close', () => {
    clients.delete(server);
    console.log("❌ Клиент отключился. Осталось:", clients.size);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// 🧾 Обработка входящих POST-запросов
async function handleIngest(request) {
  try {
    const bodyText = await request.text();

    // Сохраняем в буфер последние 50 событий
    buffer.push(bodyText);
    if (buffer.length > 50) buffer.shift();

    // Рассылаем всем активным клиентам
    for (const socket of clients) {
      try {
        socket.send(bodyText);
      } catch {
        clients.delete(socket);
      }
    }

    console.log("📨 Ингест получен и разослан:", bodyText);

    return new Response(JSON.stringify({ ok: true }), {
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
