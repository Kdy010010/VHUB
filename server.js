// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { nanoid } = require("nanoid");

const PORT = process.env.PORT || 3000;
const POST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 1000;

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// threads: Map<threadId, { id, name, posts: Map<postId, post> }>
const threads = new Map();

// 기본 쓰레드 몇 개
const defaultThreads = [
  { id: "general", name: "General" },
  { id: "dev", name: "Dev" },
  { id: "design", name: "Design" },
  { id: "random", name: "Random" },
];

for (const t of defaultThreads) {
  threads.set(t.id, { ...t, posts: new Map() });
}

function now() {
  return Date.now();
}

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function serializeState() {
  const threadList = [];
  for (const [, t] of threads) {
    const posts = [];
    for (const [, p] of t.posts) {
      posts.push(p);
    }
    posts.sort((a, b) => b.createdAt - a.createdAt);

    threadList.push({
      id: t.id,
      name: t.name,
      posts,
    });
  }
  return { threads: threadList, serverTime: now(), postTtlMs: POST_TTL_MS };
}

// 게시글 추가
function addPost({ threadId, author, title, content }) {
  const t = threads.get(threadId);
  if (!t) throw new Error("THREAD_NOT_FOUND");

  const createdAt = now();
  const post = {
    id: nanoid(10),
    threadId,
    author: (author || "익명").slice(0, 24),
    title: (title || "").slice(0, 60),
    content: (content || "").slice(0, 2000),
    createdAt,
    expiresAt: createdAt + POST_TTL_MS,
  };

  t.posts.set(post.id, post);
  return post;
}

// 만료 게시글 정리
function cleanupExpired() {
  const ts = now();
  let removed = 0;

  for (const [, t] of threads) {
    for (const [postId, post] of t.posts) {
      if (post.expiresAt <= ts) {
        t.posts.delete(postId);
        removed++;
      }
    }
  }

  if (removed > 0) {
    broadcast({ type: "postsExpired", payload: { removed, state: serializeState() } });
  }
}

setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);

wss.on("connection", (ws) => {
  // 새로 들어오면 전체 상태 전달 (요구사항)
  safeSend(ws, { type: "welcome", payload: serializeState() });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return safeSend(ws, { type: "error", payload: { message: "INVALID_JSON" } });
    }

    if (!msg || typeof msg.type !== "string") {
      return safeSend(ws, { type: "error", payload: { message: "INVALID_MESSAGE" } });
    }

    // 핑/퐁
    if (msg.type === "ping") {
      return safeSend(ws, { type: "pong", payload: { t: now() } });
    }

    // 쓰레드 생성 (옵션)
    if (msg.type === "createThread") {
      const name = String(msg?.payload?.name || "").trim();
      if (name.length < 2) {
        return safeSend(ws, { type: "error", payload: { message: "THREAD_NAME_TOO_SHORT" } });
      }
      const id = nanoid(8).toLowerCase();
      threads.set(id, { id, name: name.slice(0, 24), posts: new Map() });

      broadcast({ type: "state", payload: serializeState() });
      return;
    }

    // 게시글 작성
    if (msg.type === "createPost") {
      const payload = msg.payload || {};
      const threadId = String(payload.threadId || "");
      const author = String(payload.author || "익명").trim();
      const title = String(payload.title || "").trim();
      const content = String(payload.content || "").trim();

      if (!threadId) return safeSend(ws, { type: "error", payload: { message: "MISSING_THREAD" } });
      if (!title) return safeSend(ws, { type: "error", payload: { message: "MISSING_TITLE" } });
      if (!content) return safeSend(ws, { type: "error", payload: { message: "MISSING_CONTENT" } });

      try {
        const post = addPost({ threadId, author, title, content });
        // 실시간 브로드캐스트
        broadcast({ type: "postCreated", payload: { post } });
      } catch (e) {
        safeSend(ws, { type: "error", payload: { message: e.message || "CREATE_FAILED" } });
      }
      return;
    }

    // 전체 상태 요청 (옵션)
    if (msg.type === "getState") {
      return safeSend(ws, { type: "state", payload: serializeState() });
    }

    safeSend(ws, { type: "error", payload: { message: "UNKNOWN_TYPE" } });
  });
});

server.listen(PORT, () => {
  console.log(`VHUB running: http://localhost:${PORT}`);
});
