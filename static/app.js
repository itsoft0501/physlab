// PhysLab — сурагчийн SPA
const S = { me: null, avatars: [], timer: null, sim: null };
const app = $("#app");
starfield();

function clearTimers() {
  if (S.timer) { clearInterval(S.timer); S.timer = null; }
  if (S.sim && S.sim.stop) S.sim.stop();
  S.sim = null;
  document.onkeydown = null;
}

async function loadMe() {
  const r = await api("/api/me");
  S.me = r.user; S.avatars = r.avatars;
  renderTop();
}

function renderTop() {
  const u = S.me;
  const h = location.hash;
  const navItems = u && u.placed_at ? [["#/map", "🗺️", "Газрын зураг"], ["#/leaderboard", "🏆", "Тэргүүлэгчид"], ["#/profile", "👤", "Профайл"]] : [];
  $("#nav").innerHTML = navItems.map(([href, , t]) => `<a href="${href}" class="${h.startsWith(href) ? "on" : ""}">${t}</a>`).join("")
    + `<a href="#/guide" class="${h.startsWith("#/guide") ? "on" : ""}">📖 Тусламж</a>`
    + (u && u.role === "admin" ? `<a href="/admin">⚙️ Админ</a>` : "");
  const bn = $("#bottomnav");
  bn.classList.toggle("hide", !navItems.length);
  bn.innerHTML = navItems.map(([href, ic, t]) => `<a href="${href}" class="${h.startsWith(href) ? "on" : ""}"><span>${ic}</span>${t}</a>`).join("");
  $("#userbox").innerHTML = u
    ? `<span class="chip fire" title="Өдөр дараалан">🔥 ${u.streak}</span>
       <span class="chip xp" title="Туршлагын оноо">⚡ ${u.xp} XP</span>
       <button class="btn ghost sm" onclick="toggleTheme()" title="Өнгө солих">◐</button>
       <a class="avatar" href="#/profile" title="${esc(u.name)}" style="text-decoration:none">${esc(u.avatar)}</a>`
    : `<button class="btn ghost sm" onclick="toggleTheme()" title="Өнгө солих">◐</button>
       <a class="btn ghost sm" href="#/login">Нэвтрэх</a><a class="btn sm" href="#/register">Бүртгүүлэх</a>`;
}

async function refreshMe() { try { await loadMe(); } catch { /* */ } }

// ---------------- router ----------------
async function route() {
  clearTimers();
  scrollTo(0, 0);
  const [path, query] = location.hash.slice(1).split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const qs = new URLSearchParams(query || "");
  renderTop();
  try {
    if (parts[0] === "guide") return await guideView(qs);
    if (!S.me) {
      if (parts[0] === "login") return await loginView(qs);
      if (parts[0] === "register") return await registerView();
      return await landing();
    }
    if (!S.me.placed_at && !["placement", "profile"].includes(parts[0])) return (location.hash = "#/placement");
    switch (parts[0]) {
      case "placement": return await placementView();
      case "lesson": return await lessonView(+parts[1]);
      case "exam": return await examView(+parts[1]);
      case "profile": return await profileView();
      case "leaderboard": return await leaderboardView(qs);
      case "login": case "register":
        if (qs.get("next") === "admin" && S.me.role === "admin") return (location.href = "/admin");
        return (location.hash = "#/map");
      default: return await mapView();
    }
  } catch (e) {
    if (e.status === 401) { S.me = null; renderTop(); return await loginView(qs); }
    if (e.status === 409) return (location.hash = "#/placement");
    app.innerHTML = `<div class="card center"><h2>😵 Алдаа</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/map">Буцах</a></div>`;
  }
}
addEventListener("hashchange", route);

// ---------------- landing ----------------
function landing() {
  app.innerHTML = `
  <section class="hero">
    <div>
      <span class="chip">🚀 7–12-р анги · Физик</span>
      <h1 style="margin-top:16px">Физикийг <span class="grad">тоглож</span> сур.</h1>
      <p>Түвшин тогтоох шалгалт өгөөд өөрийн гариг дээрээ буу. Видео хичээл үз, бодлого бодож XP цуглуул, виртуал лабораторид туршилт хий — дараагийн гариг руу хөөр!</p>
      <div class="row" style="margin-top:22px">
        <a class="btn big" href="#/register">Аяллаа эхлэх →</a>
        <a class="btn ghost big" href="#/login">Нэвтрэх</a>
      </div>
    </div>
    <div class="orbit"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="core"></div></div>
  </section>
  <section class="grid g3" style="margin-top:10px">
    ${[["🧭", "Түвшин тогтоох", "Эхний шалгалтаар чиний мэдлэгт тохирох түвшинг олно."],
      ["🎬", "Онол", "Богино видео хичээл, томьёо, жишээ."],
      ["🎯", "Бодлого", "3 амьтай тоглоом: combo, XP, од цуглуул."],
      ["🧪", "Туршилт", "Дүүжин, шидэлт, цахилгаан хэлхээний виртуал лаб."],
      ["🚀", "Түвшин ахих", "Түвшний шалгалт давж шинэ гариг нээ."],
      ["🏆", "Тэргүүлэгчид", "Ангийнхантайгаа XP-ээр өрсөлд."]]
      .map(([i, t, d]) => `<div class="card feat"><div class="ic">${i}</div><h3>${t}</h3><p class="muted small">${d}</p></div>`).join("")}
  </section>
  <p class="center" style="margin-top:24px"><a class="btn ghost" href="#/guide">📖 Гарын авлага</a></p>`;
}

// ---------------- auth ----------------
function loginView(qs) {
  app.innerHTML = `
  <div class="card auth">
    <h2>Тавтай морил 👋</h2><p class="muted">Мэйл хаягаараа нэвтэрнэ үү.</p>
    <form id="f">
      <label>Мэйл хаяг</label><input name="email" type="email" required autocomplete="email">
      <label>Нууц үг</label><input name="password" type="password" required autocomplete="current-password">
      <div class="err" id="err"></div>
      <button class="btn block big" style="margin-top:8px">Нэвтрэх</button>
    </form>
    <p class="center muted small" style="margin-top:16px">Бүртгэлгүй юу? <a href="#/register">Бүртгүүлэх</a></p>
  </div>`;
  $("#f").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    try {
      const r = await api("/api/login", { method: "POST", body: fd });
      await loadMe();
      if (qs && qs.get("next") === "admin" && r.role === "admin") return (location.href = "/admin");
      location.hash = "#/map";
    } catch (e) { $("#err").textContent = e.message; }
  };
}

function registerView() {
  let avatar = S.avatars[0] || "🚀", grade = null;
  app.innerHTML = `
  <div class="card auth">
    <h2>Аялагч болох 🚀</h2><p class="muted">Мэйл хаягаар бүртгүүлээд түвшин тогтоох шалгалтаа өгнө.</p>
    <form id="f">
      <label>Нэр</label><input name="name" required maxlength="60" autocomplete="nickname">
      <label>Анги</label><div class="grades" id="grades">${[7, 8, 9, 10, 11, 12].map((g) => `<button type="button" data-g="${g}">${g}</button>`).join("")}</div>
      <label>Аватар</label><div class="avatars" id="avs">${S.avatars.map((a, i) => `<button type="button" data-a="${a}" class="${i ? "" : "on"}">${a}</button>`).join("")}</div>
      <label>Мэйл хаяг</label><input name="email" type="email" required autocomplete="email">
      <label>Нууц үг (6+ тэмдэгт)</label><input name="password" type="password" minlength="6" required autocomplete="new-password">
      <div class="err" id="err"></div>
      <button class="btn block big" style="margin-top:8px">Бүртгүүлэх</button>
    </form>
    <p class="center muted small" style="margin-top:16px">Бүртгэлтэй юу? <a href="#/login">Нэвтрэх</a></p>
  </div>`;
  $("#grades").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; grade = +b.dataset.g; $$("#grades button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#avs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; avatar = b.dataset.a; $$("#avs button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#f").onsubmit = async (ev) => {
    ev.preventDefault();
    if (!grade) return ($("#err").textContent = "Ангиа сонгоно уу");
    const fd = Object.fromEntries(new FormData(ev.target));
    try {
      await api("/api/register", { method: "POST", body: { ...fd, grade, avatar } });
      await loadMe();
      location.hash = "#/placement";
    } catch (e) { $("#err").textContent = e.message; }
  };
}

// ---------------- answer widget ----------------
function answerWidget(q, onPick, selected, numLabel = "Шалгах") {
  const box = document.createElement("div");
  if (q.qtype === "mcq") {
    box.className = "opts";
    box.innerHTML = q.options.map(([k, t], i) => `<button class="opt ${selected === k ? "sel" : ""}" data-v="${k}"><span class="k">${k}</span><span>${renderInline(t)}</span></button>`).join("");
    box.onclick = (e) => { const b = e.target.closest(".opt"); if (b && !b.disabled) onPick(b.dataset.v, b); };
  } else if (q.qtype === "truefalse") {
    box.className = "opts tf";
    box.innerHTML = `<button class="opt ${selected === "T" ? "sel" : ""}" data-v="T">✅ Үнэн</button><button class="opt ${selected === "F" ? "sel" : ""}" data-v="F">❌ Худал</button>`;
    box.onclick = (e) => { const b = e.target.closest(".opt"); if (b && !b.disabled) onPick(b.dataset.v, b); };
  } else {
    box.className = "numrow";
    box.innerHTML = `<input type="text" inputmode="decimal" placeholder="Хариултаа бич (тоо)" value="${esc(selected ?? "")}"><button class="btn">${numLabel}</button>`;
    const inp = $("input", box);
    const go = () => { if (inp.value.trim()) onPick(inp.value.trim(), $("button", box)); };
    $("button", box).onclick = go;
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.stopPropagation(); go(); } };
    setTimeout(() => inp.focus(), 50);
  }
  return box;
}

function qHead(q, i, n) {
  return `<div class="qnum">Асуулт ${i + 1} / ${n} · ${q.points} оноо</div>
    <div class="qtext">${renderInline(q.text)}</div>
    ${q.image_url ? `<img class="qimg" src="${esc(q.image_url)}" alt="">` : ""}`;
}

// ---------------- GAME (бодлого / дасгал) ----------------
function runGame(el, { questions, lives = 0, perQ = 0, onFinish }) {
  let i = 0, life = lives, combo = 0, best = 0, locked = false;
  const answers = {};
  const order = [...questions];

  function hud() {
    return `<div class="hud">
      ${lives ? `<span class="hearts">${Array.from({ length: lives }, (_, k) => `<span class="${k < life ? "" : "lost"}">❤️</span>`).join("")}</span>` : ""}
      <span class="chip">${i + 1}/${order.length}</span>
      <span class="spacer"></span>
      ${combo >= 2 ? `<span class="combo">🔥 x${combo} COMBO</span>` : ""}
    </div>
    <div class="progress" style="margin-bottom:12px"><i style="width:${(100 * i) / order.length}%"></i></div>`;
  }

  function show() {
    clearInterval(S.timer); S.timer = null;
    if (i >= order.length || (lives && life <= 0)) return finish();
    locked = false;
    const q = order[i];
    el.innerHTML = `${hud()}${perQ ? `<div class="timerbar"><i id="tb" style="width:100%"></i></div>` : ""}
      <div class="card qcard">${qHead(q, i, order.length)}<div id="aw"></div><div id="fb"></div></div>`;
    $("#aw", el).appendChild(answerWidget(q, (v, btn) => answer(q, v, btn)));
    document.onkeydown = (e) => {
      if (locked) { if (e.key === "Enter") next(); return; }
      if (e.target.tagName === "INPUT") return;
      const k = { 1: "A", 2: "B", 3: "C", 4: "D" }[e.key];
      const btn = q.qtype === "mcq" && k ? $(`.opt[data-v="${k}"]`, el) : q.qtype === "truefalse" ? $(`.opt[data-v="${e.key === "1" ? "T" : e.key === "2" ? "F" : "-"}"]`, el) : null;
      if (btn) btn.click();
    };
    if (perQ) {
      const limit = q.qtype === "numeric" ? perQ * 1.5 : perQ;
      const t0 = Date.now();
      S.timer = setInterval(() => {
        const left = 1 - (Date.now() - t0) / 1000 / limit;
        const tb = $("#tb", el);
        if (tb) tb.style.width = Math.max(0, left * 100) + "%";
        if (left <= 0) { clearInterval(S.timer); S.timer = null; answer(q, "", null, true); }
      }, 200);
    }
  }

  async function answer(q, v, btn, timeout = false) {
    if (locked) return;
    locked = true;
    clearInterval(S.timer); S.timer = null;
    answers[q.id] = v;
    $$("#aw button, #aw input", el).forEach((b) => (b.disabled = true));
    let r;
    try { r = await api("/api/check", { method: "POST", body: { id: q.id, given: v } }); }
    catch (e) { toast(e.message, true); locked = false; return; }
    if (r.correct) {
      combo++; best = Math.max(best, combo);
      if (btn && btn.classList.contains("opt")) btn.classList.add("ok");
      const rect = (btn || el).getBoundingClientRect();
      xpPop(rect.left + rect.width / 2 - 30, rect.top, `+${q.points * 10} XP`);
    } else {
      combo = 0;
      if (lives) life--;
      if (btn && btn.classList.contains("opt")) btn.classList.add("bad");
      const key = String(r.answer).split(".")[0];
      const right = q.qtype === "mcq" ? $(`.opt[data-v="${key}"]`, el) : q.qtype === "truefalse" ? $(`.opt[data-v="${r.answer === "Үнэн" ? "T" : "F"}"]`, el) : null;
      if (right) right.classList.add("ok");
    }
    const last = i + 1 >= order.length || (lives && life <= 0);
    $("#fb", el).innerHTML = `<div class="feedback ${r.correct ? "ok" : "bad"}">
      ${r.correct ? ["🎉 Зөв!", "⚡ Гайхалтай!", "🚀 Яг тийм!", "💎 Мундаг!"][Math.floor(Math.random() * 4)] : timeout ? "⏰ Хугацаа дууслаа." : "😬 Буруу."}
      ${!r.correct ? `<div class="small" style="margin-top:6px">Зөв хариулт: <b>${renderInline(r.answer)}</b></div>` : ""}
      ${r.explanation ? `<div class="small muted" style="margin-top:6px">💡 ${renderInline(r.explanation)}</div>` : ""}
      </div>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="nx">${last ? "Дуусгах 🏁" : "Дараах →"}</button></div>`;
    // hud update
    const h = $(".hud", el); if (h) h.outerHTML = hud().split('<div class="progress"')[0];
    $("#nx", el).onclick = next;
    $("#nx", el).focus();
  }
  function next() { i++; show(); }
  async function finish() {
    clearInterval(S.timer); S.timer = null; document.onkeydown = null;
    el.innerHTML = `<div class="spinner"></div>`;
    await onFinish(answers, { lives_left: life, best_combo: best, died: lives && life <= 0 });
  }
  show();
}

// ---------------- TEST (түвшин тогтоох / түвшний шалгалт) ----------------
function runTest(el, { questions, seconds, title, onSubmit }) {
  let i = 0;
  const ans = {};
  const end = Date.now() + seconds * 1000;
  function render() {
    const q = questions[i];
    el.innerHTML = `
      <div class="hud"><h3 style="margin:0">${esc(title)}</h3><span class="spacer"></span><span class="chip" id="clock">⏱</span></div>
      <div class="qdots">${questions.map((x, k) => `<button data-k="${k}" class="${ans[x.id] != null ? "ans" : ""} ${k === i ? "cur" : ""}">${k + 1}</button>`).join("")}</div>
      <div class="card qcard">${qHead(q, i, questions.length)}<div id="aw"></div></div>
      <div class="row" style="margin-top:16px">
        <button class="btn ghost" id="pv" ${i ? "" : "disabled"}>← Өмнөх</button><span class="spacer"></span>
        ${i < questions.length - 1 ? `<button class="btn" id="nx">Дараах →</button>` : ""}
        <button class="btn green" id="sb">Илгээх ✓</button>
      </div>`;
    $("#aw", el).appendChild(answerWidget(q, (v, btn) => {
      ans[q.id] = v;
      if (btn && btn.classList.contains("opt")) { $$(".opt", el).forEach((b) => b.classList.toggle("sel", b === btn)); setTimeout(() => { if (i < questions.length - 1) { i++; render(); } else render(); }, 250); }
      else { if (i < questions.length - 1) { i++; } render(); }
    }, ans[q.id], "Хадгалах ✓"));
    $(".qdots", el).onclick = (e) => { const b = e.target.closest("button"); if (b) { i = +b.dataset.k; render(); } };
    $("#pv", el).onclick = () => { i--; render(); };
    if ($("#nx", el)) $("#nx", el).onclick = () => { const inp = $("#aw input", el); if (inp && inp.value.trim()) ans[q.id] = inp.value.trim(); i++; render(); };
    $("#sb", el).onclick = () => {
      const inp = $("#aw input", el); if (inp && inp.value.trim()) ans[q.id] = inp.value.trim();
      const left = questions.filter((x) => ans[x.id] == null).length;
      if (left && !confirm(`${left} асуулт хариулаагүй байна. Илгээх үү?`)) return;
      submit();
    };
    tick();
  }
  function tick() {
    const s = Math.max(0, Math.round((end - Date.now()) / 1000));
    const c = $("#clock", el); if (c) c.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s <= 0) submit();
  }
  let sent = false;
  async function submit() {
    if (sent) return; sent = true;
    clearInterval(S.timer); S.timer = null;
    el.innerHTML = `<div class="spinner"></div>`;
    // хариулаагүй асуултыг хоосноор илгээнэ (буруу гэж тооцогдоно)
    const full = Object.fromEntries(questions.map((q) => [q.id, ans[q.id] ?? ""]));
    await onSubmit(full);
  }
  S.timer = setInterval(tick, 1000);
  render();
}

function reviewHtml(details, questions) {
  const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
  return `<details style="margin-top:18px"><summary class="btn ghost sm">Хариултаа харах</summary><div class="review">
    ${details.map((d, k) => `<div class="it ${d.correct ? "ok" : "bad"}">${d.correct ? "✅" : "❌"} <b>${k + 1}.</b> ${renderInline(byId[d.id]?.text || "")}
      ${d.correct ? "" : `<div class="small muted">Зөв: <b>${renderInline(d.answer)}</b>${d.explanation ? " · 💡 " + renderInline(d.explanation) : ""}</div>`}</div>`).join("")}
  </div></details>`;
}

// ---------------- placement ----------------
async function placementView() {
  const r = await api("/api/placement");
  if (!r.questions.length) {
    app.innerHTML = `<div class="card center narrow" style="margin:auto"><h2>🛠️ Шалгалт бэлэн биш байна</h2><p class="muted">Админ түвшин тогтоох шалгалтын асуултуудыг оруулаагүй байна.</p></div>`;
    return;
  }
  app.innerHTML = `<div class="narrow" style="margin:auto"><div class="card result">
    <div style="font-size:4rem">🧭</div>
    <h1>Түвшин тогтоох шалгалт</h1>
    <p class="muted">${r.done ? "Та шалгалтаа дахин өгч болно. Түвшин чинь буурахгүй." : `Сайн уу, ${esc(S.me.name)}! Чиний мэдлэгт тохирох гаригийг олъё.`}</p>
    <div class="grid g3" style="margin:22px 0">
      <div class="card stat"><b>${r.questions.length}</b><span class="muted small">асуулт</span></div>
      <div class="card stat"><b>${Math.round(r.seconds / 60)}</b><span class="muted small">минут</span></div>
      <div class="card stat"><b>+50</b><span class="muted small">XP</span></div>
    </div>
    <p class="small muted">Асуултууд хялбараас хэцүү рүү явна. Мэдэхгүй бол алгасаад дараагийнх руу шилж — тааж бичих хэрэггүй.</p>
    <div class="row" style="justify-content:center;margin-top:16px">
      ${r.done ? `<a class="btn ghost big" href="#/map">Буцах</a>` : ""}
      <button class="btn big" id="go">Эхлэх 🚀</button>
    </div></div></div>`;
  $("#go").onclick = () => {
    app.innerHTML = `<div class="narrow" style="margin:auto" id="t"></div>`;
    runTest($("#t"), {
      questions: r.questions, seconds: r.seconds, title: "🧭 Түвшин тогтоох",
      onSubmit: async (ans) => {
        const res = await api("/api/placement", { method: "POST", body: { answers: ans } });
        await refreshMe();
        confetti();
        $("#t").innerHTML = `<div class="card result">
          <div style="font-size:4.5rem">${res.placed.icon || "🪐"}</div>
          <p class="muted">Чиний эхлэх гариг</p>
          <h1 style="color:${esc(res.placed.color)}">${esc(res.placed.name)}</h1>
          <div class="score">${res.score}/${res.total}</div>
          <div class="lvbars">${res.report.map((l) => `<div><div class="row small"><b>${esc(l.name)}</b><span class="spacer"></span>${l.total ? l.pct + "%" : "—"} ${l.passed ? "✅" : ""}</div>
            <div class="progress"><i style="width:${l.pct}%"></i></div></div>`).join("")}</div>
          ${res.xp ? `<p class="chip xp">+${res.xp} XP</p>` : ""}
          ${reviewHtml(res.details, r.questions)}
          <div style="margin-top:20px"><a class="btn big" href="#/map">Газрын зураг руу →</a></div></div>`;
      },
    });
  };
}

// ---------------- map ----------------
const SEC_IC = { onol: "🎬", bodlogo: "🎯", turshilt: "🧪" };
async function mapView() {
  const r = await api("/api/map");
  S.me = r.user; renderTop();
  const cur = r.levels.find((l) => l.current) || r.levels[0];
  const total = r.levels.reduce((a, l) => a + l.stars, 0), max = r.levels.reduce((a, l) => a + l.max_stars, 0);
  app.innerHTML = `
    <div class="card" style="margin-bottom:22px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      <div class="avatar" style="width:64px;height:64px;font-size:2rem">${esc(S.me.avatar)}</div>
      <div style="flex:1;min-width:200px">
        <h2 style="margin:0">Сайн уу, ${esc(S.me.name)}!</h2>
        <div class="muted small">${cur ? `Одоогийн байршил: <b style="color:${esc(cur.color)}">${esc(cur.icon)} ${esc(cur.name)}</b>` : ""}</div>
        <div class="progress" style="margin-top:10px"><i style="width:${max ? (100 * total) / max : 0}%"></i></div>
        <div class="small muted" style="margin-top:4px">★ ${total} / ${max} од цуглуулсан</div>
      </div>
      <a class="btn ghost sm" href="#/placement">🧭 Шалгалт дахин өгөх</a>
    </div>
    ${r.levels.map(levelCard).join("")}`;
  const c = $(".level.current"); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
}

function levelCard(lv) {
  let nextFound = false;
  const nodes = lv.lessons.map((l) => {
    let cls = l.stars ? "done" : "";
    if (!l.unlocked) cls = "locked";
    else if (!l.stars && !nextFound) { cls = "next"; nextFound = true; }
    const href = l.unlocked ? `href="#/lesson/${l.id}"` : "";
    return `<a class="node ${cls}" ${href}>
      <div class="orb">${l.unlocked ? SEC_IC[l.section] || "📘" : "🔒"}</div>
      <div class="sec">${esc(l.section_mn)}</div><div class="t">${esc(l.title)}</div>${starsHtml(l.stars)}</a>`;
  }).join("");
  const exCls = !lv.exam_unlocked ? "locked" : lv.exam_passed ? "done" : !nextFound ? "next" : "";
  return `<section class="card level ${lv.unlocked ? "" : "locked"} ${lv.current ? "current" : ""}" style="--lc:${esc(lv.color)}">
    <div class="lv-head">
      <div class="planet">${lv.unlocked ? esc(lv.icon) : "🔒"}</div>
      <div style="flex:1">
        <div class="row"><span class="muted small" style="font-weight:800">ТҮВШИН ${lv.ord}</span>${lv.current ? `<span class="badge-cur">Чи энд байна</span>` : ""}${lv.exam_passed ? `<span class="chip small">✅ Давсан</span>` : ""}</div>
        <h2 style="margin:4px 0">${esc(lv.name)}</h2>
        <div class="muted small">${esc(lv.description || "")}</div>
      </div>
      <div class="chip">★ ${lv.stars}/${lv.max_stars}</div>
    </div>
    <div class="path">${nodes}
      <a class="node exam ${exCls}" ${lv.exam_unlocked ? `href="#/exam/${lv.id}"` : ""}>
        <div class="orb">${lv.exam_unlocked ? (lv.exam_passed ? "🏆" : "🚀") : "🔒"}</div>
        <div class="sec">Түвшний шалгалт</div><div class="t">${lv.exam_passed ? "Давсан!" : `Тэнцэх: ${lv.pass_pct}%`}</div>
        <span class="small muted">${lv.exam_unlocked ? "Дараагийн гариг руу" : "Бүх хичээлээ дуусга"}</span></a>
    </div></section>`;
}

// ---------------- lesson ----------------
async function lessonView(id) {
  const r = await api(`/api/lesson/${id}`);
  const L = r.lesson;
  const isGame = L.section === "bodlogo";
  app.innerHTML = `<div class="narrow" style="margin:auto">
    <div class="lesson-head"><a class="back" href="#/map">← Газрын зураг</a><span class="spacer"></span>
      <span class="chip" style="color:${esc(r.level.color)}">${esc(r.level.icon)} ${esc(r.level.name)}</span></div>
    <div class="row"><span class="chip">${SEC_IC[L.section]} ${esc(L.section_mn)}</span>${starsHtml(r.stars)}</div>
    <h1 style="margin-top:10px">${esc(L.title)}</h1>
    <div id="intro">
      ${L.section !== "bodlogo" || L.embed ? (L.embed ? `<div class="video"><iframe src="${esc(L.embed)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" title="Видео хичээл"></iframe></div>`
        : L.section === "onol" ? `<div class="novideo">🎬<br>Видео хичээл удахгүй нэмэгдэнэ</div>` : "") : ""}
      ${L.sim_key ? `<div id="sim"></div>` : ""}
      ${L.body_md ? `<div class="card md" style="margin-bottom:18px">${renderMd(L.body_md)}</div>` : ""}
      <div class="card center">
        ${r.questions.length ? `<h3>${isGame ? "🎯 Бодлогын тулаан" : L.section === "turshilt" ? "🧪 Туршилтын даалгавар" : "🧠 Ойлгосон уу?"}</h3>
          <p class="muted small">${r.questions.length} асуулт${isGame ? " · ❤️❤️❤️ 3 амь · ⏱ асуулт бүрт хугацаатай" : ""}</p>
          <button class="btn big" id="start">${isGame ? "Тулаан эхлэх ⚔️" : "Эхлэх →"}</button>`
        : `<p class="muted">Энэ хичээлд дасгал алга. Үзэж дуусаад тэмдэглээрэй.</p><button class="btn big" id="start">Дуусгалаа ✓</button>`}
      </div>
    </div>
    <div id="game"></div></div>`;
  if (L.sim_key && window.SIMS && SIMS[L.sim_key]) S.sim = SIMS[L.sim_key]($("#sim"));
  $("#start").onclick = () => {
    if (isGame) { $("#intro").classList.add("hide"); if (S.sim && S.sim.stop) S.sim.stop(); }
    else $("#start").closest(".card").classList.add("hide");
    const finish = async (answers, meta) => {
      const res = await api(`/api/lesson/${id}/finish`, { method: "POST", body: { answers, ...meta } });
      await refreshMe();
      if (res.stars) confetti(res.stars * 50);
      $("#game").innerHTML = `<div class="card result">
        ${meta.died ? `<div style="font-size:3rem">💔</div><h2>Амь дууслаа!</h2>` : `<h2>${res.stars ? "Хичээл дууслаа!" : "Дахин оролдоорой"}</h2>`}
        <div class="bigstars">${[0, 1, 2].map((k) => `<span class="${k < res.stars ? "on" : ""}">★</span>`).join("")}</div>
        <div class="score">${res.pct}%</div>
        <div class="row" style="justify-content:center;margin:10px 0">
          ${res.xp ? `<span class="chip xp">+${res.xp} XP</span>` : ""}${meta.best_combo >= 2 ? `<span class="chip">🔥 Max combo x${meta.best_combo}</span>` : ""}
          ${res.new_best ? `<span class="chip">🆕 Шинэ рекорд</span>` : ""}</div>
        <p class="muted small">${res.stars ? "50%+ = ★ · 70%+ = ★★ · 90%+ = ★★★" : "Дор хаяж 50% авбал дараагийн хичээл нээгдэнэ."}</p>
        <div class="row" style="justify-content:center;margin-top:16px">
          <button class="btn ghost" onclick="route()">↻ Дахин тоглох</button><a class="btn" href="#/map">Газрын зураг →</a></div></div>`;
    };
    if (!r.questions.length) return finish({}, {});
    if (!isGame) $("#game").scrollIntoView({ behavior: "smooth" });
    runGame($("#game"), { questions: r.questions, lives: isGame ? 3 : 0, perQ: isGame ? 60 : 0, onFinish: finish });
  };
}

// ---------------- level exam ----------------
async function examView(levelId) {
  const r = await api(`/api/level/${levelId}/exam`);
  const lv = r.level;
  app.innerHTML = `<div class="narrow" style="margin:auto" id="t"><div class="card result" style="--lc:${esc(lv.color)}">
    <div style="font-size:4rem">🚀</div><h1>Түвшний шалгалт</h1><h3 style="color:${esc(lv.color)}">${esc(lv.icon)} ${esc(lv.name)}</h3>
    <p class="muted">${r.questions.length} асуулт · ${Math.round(r.seconds / 60)} минут · тэнцэх оноо ${lv.pass_pct}%</p>
    <div class="row" style="justify-content:center;margin-top:16px"><a class="btn ghost big" href="#/map">Буцах</a><button class="btn big" id="go">Хөөрөх 🚀</button></div></div></div>`;
  $("#go").onclick = () => runTest($("#t"), {
    questions: r.questions, seconds: r.seconds, title: `🚀 ${lv.name}`,
    onSubmit: async (ans) => {
      const res = await api(`/api/level/${levelId}/exam`, { method: "POST", body: { answers: ans } });
      await refreshMe();
      if (res.passed) { confetti(220); if (res.leveled || res.final) levelUpOverlay(res); }
      $("#t").innerHTML = `<div class="card result">
        <div style="font-size:4rem">${res.passed ? "🏆" : "🛰️"}</div>
        <h1>${res.passed ? "Тэнцлээ!" : "Тэнцсэнгүй"}</h1>
        <div class="score">${res.pct}%</div><p class="muted">Тэнцэх оноо: ${res.pass_pct}%</p>
        ${res.xp ? `<span class="chip xp">+${res.xp} XP</span>` : ""}
        ${res.next_level ? `<p>Шинэ гариг нээгдлээ: <b style="color:${esc(res.next_level.color)}">${esc(res.next_level.icon)} ${esc(res.next_level.name)}</b></p>` : ""}
        ${res.final ? `<p>🌌 Чи бүх түвшнийг давлаа! Жинхэнэ физикч!</p>` : ""}
        ${!res.passed ? `<p class="muted small">Хичээлүүдээ давтаж, 3 од авахыг хичээгээд дахин оролдоорой.</p>` : ""}
        ${reviewHtml(res.details, r.questions)}
        <div class="row" style="justify-content:center;margin-top:18px">${!res.passed ? `<button class="btn ghost" onclick="route()">↻ Дахин</button>` : ""}<a class="btn big" href="#/map">Газрын зураг →</a></div></div>`;
    },
  });
}

function levelUpOverlay(res) {
  const d = document.createElement("div");
  d.className = "levelup";
  d.innerHTML = `<div class="box"><div class="p">🚀</div><h1 style="font-size:2.6rem">ТҮВШИН АХЛАА!</h1>
    ${res.next_level ? `<p class="muted">Дараагийн зогсоол: <b style="color:${esc(res.next_level.color)}">${esc(res.next_level.icon)} ${esc(res.next_level.name)}</b></p>` : `<p>Бүх гаригийг эзэллээ! 🌌</p>`}
    <p class="chip xp">+${res.xp} XP</p><br><br><button class="btn big">Гайхалтай!</button></div>`;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

// ---------------- profile ----------------
const KIND_MN = { placement: "🧭 Түвшин тогтоох", lesson: "📘 Хичээл", level_exam: "🚀 Түвшний шалгалт" };
async function profileView() {
  const r = await api("/api/profile");
  const u = r.user;
  app.innerHTML = `
  <div class="card" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
    <div class="avatar" style="width:84px;height:84px;font-size:2.6rem">${esc(u.avatar)}</div>
    <div style="flex:1;min-width:200px"><h1 style="margin:0">${esc(u.name)}</h1>
      <div class="muted">${u.grade ? u.grade + "-р анги · " : ""}${r.level ? `${esc(r.level.icon)} ${esc(r.level.name)}` : "Түвшин тогтоогоогүй"}</div></div>
    <div class="row"><a class="btn ghost sm" href="#/guide">📖 Тусламж</a><button class="btn ghost sm" id="edit">✏️ Засах</button><button class="btn ghost sm" id="out">Гарах</button></div>
  </div>
  <div id="editbox"></div>
  <div class="grid g3" style="margin-bottom:18px">
    <div class="card stat"><b style="color:var(--amber)">⚡ ${u.xp}</b><span class="muted small">XP</span></div>
    <div class="card stat"><b>★ ${r.stars}</b><span class="muted small">Од</span></div>
    <div class="card stat"><b style="color:#fb923c">🔥 ${u.streak}</b><span class="muted small">Өдөр дараалан</span></div>
    <div class="card stat"><b>#${r.rank}</b><span class="muted small">Нийт байр</span></div>
  </div>
  <div class="card" style="margin-bottom:18px"><h3>🏅 Badge-ууд</h3><div class="badges">
    ${r.badges.map((b) => `<div class="bdg ${b.earned ? "on" : "off"}" title="${esc(b.desc)}"><div class="i">${b.icon}</div><b class="small">${esc(b.name)}</b><div class="small muted">${esc(b.desc)}</div></div>`).join("")}
  </div></div>
  <div class="card"><h3>📜 Сүүлийн үйлдлүүд</h3>
    ${r.recent.length ? `<table><tbody>${r.recent.map((a) => `<tr><td>${KIND_MN[a.kind] || a.kind}<div class="small muted">${esc(a.lesson || a.level || "")}</div></td>
      <td>${a.score}/${a.total}</td><td>${a.passed ? "✅" : "—"}</td><td class="small muted">${esc(a.created_at)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Одоохондоо юу ч алга.</p>`}
  </div>`;
  $("#out").onclick = async () => { await api("/api/logout", { method: "POST" }); S.me = null; location.hash = "#/"; renderTop(); };
  $("#edit").onclick = () => {
    let av = u.avatar;
    $("#editbox").innerHTML = `<div class="card" style="margin-bottom:18px"><label>Нэр</label><input id="nm" value="${esc(u.name)}">
      <label>Аватар</label><div class="avatars" id="avs">${S.avatars.map((a) => `<button type="button" data-a="${a}" class="${a === av ? "on" : ""}">${a}</button>`).join("")}</div>
      <div class="row" style="margin-top:14px"><button class="btn" id="sv">Хадгалах</button></div></div>`;
    $("#avs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; av = b.dataset.a; $$("#avs button").forEach((x) => x.classList.toggle("on", x === b)); };
    $("#sv").onclick = async () => { await api("/api/me", { method: "POST", body: { name: $("#nm").value, avatar: av } }); await loadMe(); toast("Хадгаллаа ✓"); route(); };
  };
}

// ---------------- leaderboard ----------------
async function leaderboardView(qs) {
  const g = qs.get("grade") || "";
  const r = await api(`/api/leaderboard${g ? "?grade=" + g : ""}`);
  const medal = ["🥇", "🥈", "🥉"];
  app.innerHTML = `<div class="narrow" style="margin:auto">
    <h1>🏆 Тэргүүлэгчид</h1>
    <div class="tabs">${[["", "Бүгд"], ...[7, 8, 9, 10, 11, 12].map((x) => [String(x), x + "-р анги"])].map(([v, t]) => `<button data-g="${v}" class="${g === v ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="card" style="padding:8px">${r.rows.length ? `<table><thead><tr><th>#</th><th>Сурагч</th><th>Түвшин</th><th>XP</th></tr></thead><tbody>
      ${r.rows.map((x, k) => `<tr class="${x.me ? "me" : ""}"><td class="rank">${medal[k] || k + 1}</td>
        <td><span style="font-size:1.3rem">${esc(x.avatar)}</span> <b>${esc(x.name)}</b>${x.me ? " (чи)" : ""}<div class="small muted">${x.grade ? x.grade + "-р анги" : ""} ${x.streak ? "· 🔥" + x.streak : ""}</div></td>
        <td class="small">${esc(x.level || "—")}</td><td><b style="color:var(--amber)">${x.xp}</b></td></tr>`).join("")}</tbody></table>` : `<p class="muted center">Энэ ангид сурагч алга.</p>`}</div></div>`;
  $(".tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) location.hash = "#/leaderboard" + (b.dataset.g ? "?grade=" + b.dataset.g : ""); };
}

// ---------------- гарын авлага ----------------
async function guideView(qs) {
  const r = await fetch("/static/guide.md", { cache: "no-cache" });
  const src = await r.text();
  // Гарын авлагад томьёоны жишээ код хэлбэрээр харагдах ёстой тул KaTeX ашиглахгүй
  const html = window.marked ? marked.parse(src) : `<pre>${esc(src)}</pre>`;
  app.innerHTML = `<div class="narrow" style="margin:auto"><div class="card md guide">${html}</div></div>`;
  const slug = (t) => t.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
  $$(".guide h2, .guide h3", app).forEach((h) => (h.id = slug(h.textContent)));
  $$(".guide a[href^='#']", app).forEach((a) => {
    const id = decodeURIComponent(a.getAttribute("href").slice(1));
    a.onclick = (e) => { e.preventDefault(); const t = document.getElementById(id); if (t) t.scrollIntoView({ behavior: "smooth" }); };
  });
  const sec = qs && qs.get("s");
  if (sec) setTimeout(() => document.getElementById(sec)?.scrollIntoView(), 50);
}

// boot
(async () => { try { await loadMe(); } catch { /* */ } route(); })();
