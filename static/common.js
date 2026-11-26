// Хоёр хуудсанд (сурагч/админ) ашиглах туслах функцууд
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const o = { credentials: "same-origin", ...opts };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== "string") {
    o.body = JSON.stringify(o.body);
    o.headers = { "Content-Type": "application/json", ...(o.headers || {}) };
  }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    const e = new Error((data && data.detail) || `Алдаа (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return data;
}

function toast(msg, isErr = false) {
  let box = $("#toast");
  if (!box) { box = document.createElement("div"); box.id = "toast"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// Markdown + KaTeX (CDN ачаалагдаагүй бол энгийн текст)
function renderMd(src) {
  let html;
  const math = [];
  // томьёог markdown-аас хамгаалах
  let s = String(src || "").replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (m) => { math.push(m); return `@@M${math.length - 1}@@`; });
  if (window.marked) html = marked.parse(s);
  else html = "<p>" + esc(s).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
  html = html.replace(/@@M(\d+)@@/g, (_, i) => {
    const m = math[+i];
    const disp = m.startsWith("$$");
    const tex = disp ? m.slice(2, -2) : m.slice(1, -1);
    if (window.katex) {
      try { return katex.renderToString(tex, { displayMode: disp, throwOnError: false }); } catch { /* ignore */ }
    }
    return `<code>${esc(tex)}</code>`;
  });
  return html;
}

// Inline текстэд $..$ томьёо
function renderInline(src) {
  return esc(src).replace(/\$([^$\n]+?)\$/g, (m, tex) => {
    if (window.katex) { try { return katex.renderToString(tex.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), { throwOnError: false }); } catch { /* */ } }
    return `<code>${tex}</code>`;
  });
}

// Оддын дэвсгэр
function starfield() {
  const c = document.createElement("canvas");
  c.id = "stars";
  document.body.prepend(c);
  const ctx = c.getContext("2d");
  let pts = [];
  const resize = () => {
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
    pts = Array.from({ length: Math.min(160, (innerWidth * innerHeight) / 9000) }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.4 * devicePixelRatio + .3, p: Math.random() * 6,
    }));
  };
  resize(); addEventListener("resize", resize);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function draw(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of pts) {
      ctx.globalAlpha = .35 + .45 * Math.sin(t / 900 + s.p) ** 2;
      ctx.fillStyle = "#cfe3ff";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
    }
    if (!reduce) requestAnimationFrame(draw);
  })(0);
}

function confetti(n = 140) {
  const c = document.createElement("canvas");
  c.id = "confetti"; document.body.appendChild(c);
  c.width = innerWidth; c.height = innerHeight;
  const ctx = c.getContext("2d");
  const cols = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24"];
  const ps = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight / 2.5, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4,
    s: Math.random() * 7 + 4, c: cols[(Math.random() * cols.length) | 0], r: Math.random() * 6, vr: (Math.random() - .5) * .3,
  }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of ps) {
      p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= .99;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (++f < 160) requestAnimationFrame(tick); else c.remove();
  })();
}

function xpPop(x, y, txt) {
  const d = document.createElement("div");
  d.className = "xp-pop"; d.textContent = txt;
  d.style.left = x + "px"; d.style.top = y + "px";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1000);
}

function starsHtml(n, max = 3) {
  return `<span class="stars">${Array.from({ length: max }, (_, i) => `<span class="${i < n ? "on" : ""}">★</span>`).join("")}</span>`;
}

// theme
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem("theme"); } catch { /* */ }
  if (t) document.documentElement.dataset.theme = t;
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = cur;
  try { localStorage.setItem("theme", cur); } catch { /* */ }
}
applyTheme();
