import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const ollamaUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const maxBodyBytes = 1_000_000;

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function validateMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= 100 &&
    messages.every(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0 &&
        message.content.length <= 20_000,
    ) &&
    messages[messages.length - 1].role === "user"
  );
}

async function handleChat(request, response) {
  let body;
  try {
    body = await readRequestBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }

  if (!validateMessages(body.messages)) {
    sendJson(response, 400, {
      error: "Send up to 100 non-empty user/assistant messages, ending with a user message.",
    });
    return;
  }

  const controller = new AbortController();
  request.on("close", () => {
    if (!request.complete) controller.abort();
  });

  let ollamaResponse;
  try {
    ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: body.messages,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    sendJson(response, 502, {
      error: `Could not connect to Ollama at ${ollamaUrl}. Start Ollama and try again.`,
    });
    return;
  }

  if (!ollamaResponse.ok || !ollamaResponse.body) {
    const detail = await ollamaResponse.text();
    sendJson(response, 502, {
      error: detail || `Ollama returned HTTP ${ollamaResponse.status}.`,
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.message?.content) {
            response.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`);
          }
          if (chunk.error) {
            response.write(`data: ${JSON.stringify({ error: chunk.error })}\n\n`);
          }
        } catch {
          response.write(`data: ${JSON.stringify({ error: "Received an invalid response from Ollama." })}\n\n`);
        }
      }

      if (done) break;
    }
    response.end();
  } catch (error) {
    if (!controller.signal.aborted) {
      if (!response.headersSent) sendJson(response, 502, { error: error.message });
      else {
        response.write(`data: ${JSON.stringify({ error: "The connection to Ollama was interrupted." })}\n\n`);
        response.end();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok", model });
    return;
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const html = await readFile(path.join(root, "index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(html);
    } catch (error) {
      console.error("Could not read index.html:", error);
      sendJson(response, 500, { error: "The application page could not be loaded." });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

server.listen(port, host, () => {
  console.log(`Qwen Chat is running at http://${host}:${port}`);
  console.log(`Model: ${model} (Ollama: ${ollamaUrl})`);
});

server.on("error", (error) => {
  console.error("Server failed to start:", error);
  process.exitCode = 1;
});
