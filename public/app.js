// public/app.js
const dot = document.getElementById("dot");
const connText = document.getElementById("connText");
const threadListEl = document.getElementById("threadList");
const postListEl = document.getElementById("postList");
const activeThreadTitleEl = document.getElementById("activeThreadTitle");
const activeThreadMetaEl = document.getElementById("activeThreadMeta");
const ttlHintEl = document.getElementById("ttlHint");

const btnPost = document.getElementById("btnPost");
const btnRefresh = document.getElementById("btnRefresh");
const btnCreateThread = document.getElementById("btnCreateThread");

const authorEl = document.getElementById("author");
const titleEl = document.getElementById("title");
const contentEl = document.getElementById("content");
const newThreadNameEl = document.getElementById("newThreadName");

const toastEl = document.getElementById("toast");

let ws;
let state = { threads: [], serverTime: Date.now(), postTtlMs: 10 * 60 * 1000 };
let activeThreadId = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function timeLeft(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener("open", () => {
    dot.classList.add("on");
    connText.textContent = "Live";
  });

  ws.addEventListener("close", () => {
    dot.classList.remove("on");
    connText.textContent = "Disconnected";
    toast("연결이 끊겼어요. 새로고침하거나 잠시 후 다시 시도하세요.");
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === "welcome" || msg.type === "state") {
      state = msg.payload;
      renderThreads();
      if (!activeThreadId) {
        activeThreadId = state.threads[0]?.id ?? null;
      } else {
        // 선택한 쓰레드가 사라졌으면 fallback
        if (!state.threads.some((t) => t.id === activeThreadId)) {
          activeThreadId = state.threads[0]?.id ?? null;
        }
      }
      renderActiveThread();
      return;
    }

    if (msg.type === "postCreated") {
      const post = msg.payload.post;
      // 로컬 상태에 반영
      const t = state.threads.find((x) => x.id === post.threadId);
      if (t) {
        t.posts = [post, ...(t.posts || [])];
      }
      // UI 갱신
      renderThreads();
      if (post.threadId === activeThreadId) {
        renderPosts(activeThreadId);
      }
      return;
    }

    if (msg.type === "postsExpired") {
      // 서버가 정리 후 state 보내주므로 그걸로 동기화
      state = msg.payload.state;
      renderThreads();
      renderActiveThread();
      return;
    }

    if (msg.type === "error") {
      toast(`에러: ${msg.payload.message}`);
    }
  });
}

function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast("서버 연결이 아직이에요.");
    return;
  }
  ws.send(JSON.stringify({ type, payload }));
}

function renderThreads() {
  threadListEl.innerHTML = "";

  for (const t of state.threads) {
    const btn = document.createElement("button");
    btn.className = "thread-item" + (t.id === activeThreadId ? " active" : "");
    btn.innerHTML = `
      <div class="thread-name">${escapeHtml(t.name)}</div>
      <div class="thread-meta">${(t.posts?.length ?? 0)} posts</div>
    `;
    btn.addEventListener("click", () => {
      activeThreadId = t.id;
      renderThreads();
      renderActiveThread();
    });
    threadListEl.appendChild(btn);
  }
}

function renderActiveThread() {
  const t = state.threads.find((x) => x.id === activeThreadId);
  if (!t) {
    activeThreadTitleEl.textContent = "—";
    activeThreadMetaEl.textContent = "Select a thread";
    postListEl.innerHTML = "";
    return;
  }

  activeThreadTitleEl.textContent = t.name;
  activeThreadMetaEl.textContent = `#${t.id} · posts auto-expire`;
  ttlHintEl.textContent = `게시글은 약 ${Math.round(state.postTtlMs / 60000)}분 뒤 자동 삭제됩니다.`;

  renderPosts(t.id);
}

function renderPosts(threadId) {
  const t = state.threads.find((x) => x.id === threadId);
  const posts = (t?.posts || []).slice().sort((a, b) => b.createdAt - a.createdAt);

  postListEl.innerHTML = "";

  if (posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `<div class="empty-title">아직 게시글이 없어요</div><div class="empty-sub">첫 글을 올려보세요 ✨</div>`;
    postListEl.appendChild(empty);
    return;
  }

  for (const p of posts) {
    const card = document.createElement("div");
    card.className = "post";

    card.innerHTML = `
      <div class="post-head">
        <div class="post-title">${escapeHtml(p.title)}</div>
        <div class="badge">⏳ ${timeLeft(p.expiresAt)}</div>
      </div>
      <div class="post-meta">
        <span class="author">${escapeHtml(p.author || "익명")}</span>
        <span class="sep">·</span>
        <span>${formatTime(p.createdAt)}</span>
      </div>
      <div class="post-body">${escapeHtml(p.content).replace(/\n/g, "<br/>")}</div>
    `;

    postListEl.appendChild(card);
  }
}

// TTL 배지 갱신
setInterval(() => {
  if (!activeThreadId) return;
  renderPosts(activeThreadId);
}, 1000);

btnPost.addEventListener("click", () => {
  if (!activeThreadId) return toast("쓰레드를 먼저 선택하세요.");

  const author = authorEl.value.trim();
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();

  if (!title) return toast("제목을 입력하세요.");
  if (!content) return toast("내용을 입력하세요.");

  send("createPost", { threadId: activeThreadId, author, title, content });

  titleEl.value = "";
  contentEl.value = "";
  contentEl.focus();
});

btnRefresh.addEventListener("click", () => {
  send("getState", {});
});

btnCreateThread.addEventListener("click", () => {
  const name = newThreadNameEl.value.trim();
  if (!name) return toast("쓰레드 이름을 입력하세요.");
  send("createThread", { name });
  newThreadNameEl.value = "";
});

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

connect();
