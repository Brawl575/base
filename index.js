export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Обработка WebSocket
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const id = env.HUB_OBJECT.idFromName("main"); // Один общий DO для всех
      const obj = env.HUB_OBJECT.get(id);
      return obj.fetch(request);
    }

    // Обработка /ingest (POST)
    if (url.pathname === "/ingest" && request.method === "POST") {
      const id = env.HUB_OBJECT.idFromName("main");
      const obj = env.HUB_OBJECT.get(id);
      return obj.fetch(request);
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Ошибка по умолчанию
    return new Response(JSON.stringify({ error: "Use /ws or /ingest" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};

// === Durable Object ===
export class HUB_OBJECT {
  constructor() {
    this.clients = new Set();
    this.buffer = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket соединение
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();

      this.clients.add(server);
      console.log("🔗 Новый клиент. Всего:", this.clients.size);

      // Отправляем накопленные события
      for (const msg of this.buffer) {
        try { server.send(msg); } catch {}
      }

      server.addEventListener("close", () => {
        this.clients.delete(server);
        console.log("❌ Клиент отключился. Осталось:", this.clients.size);
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Получение POST /ingest
    if (url.pathname === "/ingest" && request.method === "POST") {
      const body = await request.text();

      // Добавляем в буфер (до 50 событий)
      this.buffer.push(body);
      if (this.buffer.length > 50) this.buffer.shift();

      console.log("📨 Получено событие:", body);
      console.log("📡 Клиентов для рассылки:", this.clients.size);

      // Рассылаем всем клиентам
      for (const ws of this.clients) {
        try {
          ws.send(body);
        } catch {
          this.clients.delete(ws);
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Invalid", { status: 404 });
  }
}
