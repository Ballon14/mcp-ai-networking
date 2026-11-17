import http from "node:http";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, status, body) {
  if (res.destroyed) return;
  try {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  } catch {
    // Connection may already be destroyed by a client timeout.
  }
}

export async function startMockRouteros(options = {}) {
  const {
    username = "mcp-read",
    password = "test-pass",
    fixtures = {},
    forbidden = new Set(),
    delayMs = 0
  } = options;

  const requests = [];
  const expectedAuth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    requests.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      body: rawBody
    });

    if (req.headers.authorization !== expectedAuth) {
      sendJson(res, 401, { error: 401, message: "Unauthorized" });
      return;
    }

    const key = `${req.method} ${req.url}`;
    if (forbidden.has(key) || forbidden.has(req.url)) {
      sendJson(res, 403, { error: 403, message: "Forbidden" });
      return;
    }

    const fixture = fixtures[key] ?? fixtures[req.url];
    if (fixture === undefined) {
      sendJson(res, 404, { error: 404, message: "no such command" });
      return;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const body = typeof fixture === "function" ? await fixture(req, rawBody) : fixture;
    sendJson(res, 200, body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    server,
    port: address.port,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
