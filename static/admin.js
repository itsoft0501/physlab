// PhysLab админ
const main = $("#main");
const KIND = { placement: "Түвшин тогтоох", exercise: "Дасгал", level_exam: "Түвшний шалгалт" };
const SEC = { onol: "Онол", bodlogo: "Бодлого", turshilt: "Туршилт" };
const QT = { mcq: "Сонгох (A-D)", numeric: "Тоон", truefalse: "Үнэн/Худал" };
const SIM = { "": "—", pendulum: "Дүүжин", projectile: "Шидэгдсэн бие", ohm: "Омын хууль" };
let LEVELS = [], LESSONS = [];

$("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); location.href = "/"; };

async function loadRefs() {
  [LEVELS, LESSONS] = await Promise.all([api("/api/admin/levels"), api("/api/admin/lessons")]);
}
const opts = (list, val, label = (x) => x[1], value = (x) => x[0]) => list.map((x) => `<option value="${esc(value(x))}" ${String(value(x)) === String(val ?? "") ? "selected" : ""}>${esc(label(x))}</option>`).join("");
const lvOpts = (val, blank) => (blank ? `<option value="">${blank}</option>` : "") + opts(LEVELS, val, (l) => `${l.ord}. ${l.name}`, (l) => l.id);
const lsOpts = (val, levelId) => opts(LESSONS.filter((l) => !levelId || l.level_id == levelId), val, (l) => `${l.level_ord}. ${SEC[l.section]} — ${l.title}`, (l) => l.id);

function modal(title, bodyHtml, onSave) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">${title}</h2><span class="spacer"></span><button class="btn ghost sm" data-x>✕</button></div>
    <form>${bodyHtml}<div class="err"></div><div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn ghost" data-x>Болих</button><button class="btn">Хадгалах</button></div></form></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $$("[data-x]", m).forEach((b) => (b.onclick = close));
  m.onclick = (e) => { if (e.target === m) close(); };
  $("form", m).onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try { await onSave(fd, m); close(); } catch (err) { $(".err", m).textContent = err.message; }
  };
  return m;
}

// ---------------- router ----------------
async function route() {
  const v = (location.hash || "#dash").slice(1).split("?")[0];
  $$("#side a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + v));
  main.innerHTML = `<div class="spinner"></div>`;
  main.onclick = null;
  try {
    await loadRefs();
    await ({ dash, import: importView, questions, lessons, levels, users }[v] || dash)();
  } catch (e) {
    main.innerHTML = `<div class="card"><h3>Алдаа</h3><p>${esc(e.message)}</p></div>`;
  }
}
addEventListener("hashchange", route);

// ---------------- dashboard ----------------
async function dash() {
  const s = await api("/api/admin/stats");
  const qn = Object.fromEntries(s.questions.map((x) => [x.kind, x.n]));
  const mx = Math.max(1, ...s.by_level.map((x) => x.n));
  main.innerHTML = `<h1>📊 Хяналтын самбар</h1>
  <div class="grid g3" style="margin-bottom:18px">
    <div class="card stat"><b>${s.students}</b><span class="muted small">Сурагч</span></div>
    <div class="card stat"><b>${s.placed}</b><span class="muted small">Шалгалт өгсөн</span></div>
    <div class="card stat"><b>${s.active7}</b><span class="muted small">7 хоногт идэвхтэй</span></div>
    <div class="card stat"><b>${s.levels} / ${s.lessons}</b><span class="muted small">Түвшин / Хичээл</span></div>
    <div class="card stat"><b>${qn.placement || 0}</b><span class="muted small">Түвшин тогтоох асуулт</span></div>
    <div class="card stat"><b>${(qn.exercise || 0) + (qn.level_exam || 0)}</b><span class="muted small">Дасгал + шалгалтын асуулт</span></div>
  </div>
  <div class="grid g2" style="margin-bottom:18px">
    <div class="card"><h3>Түвшин тус бүрийн сурагч</h3>${s.by_level.map((l) => `<div style="margin:10px 0"><div class="row small"><b>${esc(l.icon)} ${l.ord}. ${esc(l.name)}</b><span class="spacer"></span>${l.n}</div>
      <div class="progress"><i style="width:${(100 * l.n) / mx}%"></i></div></div>`).join("") || `<p class="muted">—</p>`}</div>
    <div class="card"><h3>Ангиар</h3>${s.by_grade.map((g) => `<span class="chip" style="margin:4px">${g.grade ?? "?"}-р анги: <b>${g.n}</b></span>`).join("") || `<p class="muted">—</p>`}</div>
  </div>
  <div class="card tbl"><h3>Сүүлийн оролдлогууд</h3><table><thead><tr><th>Сурагч</th><th>Төрөл</th><th>Түвшин / хичээл</th><th>Оноо</th><th>Огноо</th></tr></thead><tbody>
    ${s.recent.map((a) => `<tr><td>${esc(a.name)} <span class="muted small">${a.grade ?? ""}</span></td><td>${{ placement: "🧭 Түвшин тогтоох", lesson: "📘 Хичээл", level_exam: "🚀 Түвшний шалгалт" }[a.kind]}</td>
      <td>${esc(a.lesson || a.level || "")}</td><td>${a.score}/${a.total} ${a.passed ? "✅" : ""}</td><td class="small muted">${esc(a.created_at)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Одоохондоо алга</td></tr>`}
  </tbody></table></div>`;
}

// ---------------- import ----------------
function importView() {
  main.innerHTML = `<h1>📥 Excel импорт</h1>
  <div class="card" style="margin-bottom:18px">
    <h3>1. Template татах</h3>
    <p class="muted small">Excel файл 4 sheet-тэй: <b>Шалгалт</b> (түвшин тогтоох), <b>Дасгал</b> (Онол/Бодлого/Туршилт/Түвшний шалгалт), <b>Хичээл</b> (видео, онол текст), <b>Түвшин</b>.
      Төрөл: <code>mcq</code> (A-D), <code>numeric</code> (тоо, алдааны хязгаартай), <code>truefalse</code> (Үнэн/Худал). Томьёог <code>$v = s/t$</code> гэж бичиж болно.</p>
    <div class="row"><a class="btn" href="/api/admin/template.xlsx">⬇️ Template (.xlsx)</a><a class="btn ghost" href="/api/admin/export.xlsx">⬇️ Одоогийн бүх өгөгдлийг экспортлох</a></div>
  </div>
  <div class="card" style="margin-bottom:18px">
    <h3>2. Файл оруулах</h3>
    <label class="drop" id="drop"><input type="file" id="file" accept=".xlsx,.xlsm" hidden>
      <div style="font-size:2.4rem">📄</div><b>Excel файлаа энд чирж оруулах эсвэл дарж сонгох</b><div class="muted small">.xlsx</div></label>
  </div>
  <div id="pv"></div>`;
  const drop = $("#drop"), file = $("#file");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && upload(file.files[0]);
}

async function upload(f) {
  const pv = $("#pv");
  pv.innerHTML = `<div class="spinner"></div>`;
  const fd = new FormData(); fd.append("file", f);
  let r;
  try { r = await api("/api/admin/import/preview", { method: "POST", body: fd }); }
  catch (e) { pv.innerHTML = `<div class="card errrow">${esc(e.message)}</div>`; return; }
  const c = r.counts, p = r.preview;
  const qrow = (q, extra = "") => `<tr><td>${esc(q.row)}</td><td>${esc(q.level)}</td>${extra}<td>${esc(QT[q.qtype])}</td><td>${renderInline(q.text)}</td>
    <td class="small">${q.qtype === "mcq" ? ["A", "B", "C", "D"].filter((k) => q["opt_" + k.toLowerCase()]).map((k) => `${k}. ${esc(q["opt_" + k.toLowerCase()])}`).join("<br>") : ""}</td>
    <td><b>${esc(q.qtype === "truefalse" ? (q.answer === "T" ? "Үнэн" : "Худал") : q.answer)}</b>${q.tolerance != null ? ` ±${q.tolerance}` : ""}</td></tr>`;
  pv.innerHTML = `<div class="card" style="margin-bottom:18px">
    <h3>3. Шалгаад баталгаажуулах — <span class="muted">${esc(f.name)}</span></h3>
    <div class="row" style="margin-bottom:12px">
      <span class="chip">🪐 Түвшин: ${c.levels}</span><span class="chip">🎬 Хичээл: ${c.lessons}</span>
      <span class="chip">🧭 Түвшин тогтоох: ${c.placement}</span><span class="chip">🎯 Дасгал/шалгалт: ${c.exercises}</span>
      <span class="chip" style="color:${r.errors.length ? "var(--red)" : "var(--green)"}">${r.errors.length ? "⚠️ Алдаа: " + r.errors.length : "✓ Алдаагүй"}</span>
    </div>
    ${r.errors.length ? `<div class="tbl" style="max-height:240px;overflow:auto;margin-bottom:12px"><table><thead><tr><th>Sheet</th><th>Мөр</th><th>Алдаа</th></tr></thead><tbody>
      ${r.errors.map((e) => `<tr class="errrow"><td>${esc(e.sheet)}</td><td>${e.row}</td><td>${esc(e.msg)}</td></tr>`).join("")}</tbody></table>
      <p class="small muted">Алдаатай мөрүүд алгасагдана. Засаад дахин оруулж болно.</p></div>` : ""}
    <div class="row">
      <label class="row" style="margin:0;gap:6px"><input type="radio" name="mode" value="add" checked style="width:auto"> Нэмэх (одоо байгаа дээр)</label>
      <label class="row" style="margin:0;gap:6px"><input type="radio" name="mode" value="replace" style="width:auto"> Солих (бүх хичээл, асуултыг устгаад шинээр)</label>
      <span class="spacer"></span><button class="btn green" id="commit" ${c.levels + c.lessons + c.placement + c.exercises ? "" : "disabled"}>✓ Импортлох</button>
    </div></div>
  <div class="card tbl" style="margin-bottom:18px"><div class="tabs" id="pt">
    <button data-t="placement" class="on">Шалгалт (${c.placement})</button><button data-t="exercises">Дасгал (${c.exercises})</button><button data-t="lessons">Хичээл (${c.lessons})</button><button data-t="levels">Түвшин (${c.levels})</button></div>
    <div id="ptb"></div><p class="small muted">Эхний 200 мөрийг харуулав.</p></div>`;
  const tabs = {
    placement: () => `<table><thead><tr><th>Мөр</th><th>Түвшин</th><th>Төрөл</th><th>Асуулт</th><th>Сонголт</th><th>Хариулт</th></tr></thead><tbody>${p.placement.map((q) => qrow(q)).join("")}</tbody></table>`,
    exercises: () => `<table><thead><tr><th>Мөр</th><th>Түвшин</th><th>Хэсэг / хичээл</th><th>Төрөл</th><th>Асуулт</th><th>Сонголт</th><th>Хариулт</th></tr></thead><tbody>
      ${p.exercises.map((q) => qrow(q, `<td class="small">${q.section === "exam" ? "🚀 Түвшний шалгалт" : esc(SEC[q.section]) + "<br>" + esc(q.lesson_title)}</td>`)).join("")}</tbody></table>`,
    lessons: () => `<table><thead><tr><th>Мөр</th><th>Түвшин</th><th>Хэсэг</th><th>Гарчиг</th><th>Видео</th><th>Симуляц</th></tr></thead><tbody>
      ${p.lessons.map((l) => `<tr><td>${l.row}</td><td>${esc(l.level)}</td><td>${SEC[l.section]}</td><td>${esc(l.title)}</td><td class="small">${esc(l.youtube_url)}</td><td>${SIM[l.sim_key]}</td></tr>`).join("")}</tbody></table>`,
    levels: () => `<table><thead><tr><th>Дугаар</th><th>Нэр</th><th>Тэнцэх %</th></tr></thead><tbody>${p.levels.map((l) => `<tr><td>${l.ord}</td><td>${esc(l.icon)} ${esc(l.name)}</td><td>${l.pass_pct}</td></tr>`).join("")}</tbody></table>`,
  };
  const show = (t) => { $("#ptb").innerHTML = tabs[t](); $$("#pt button").forEach((b) => b.classList.toggle("on", b.dataset.t === t)); };
  $("#pt").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.t); };
  show("placement");
  $("#commit").onclick = async () => {
    const mode = $("input[name=mode]:checked").value;
    if (mode === "replace" && !confirm("Бүх хичээл, асуулт, сурагчдын хичээлийн явц устна. Үргэлжлүүлэх үү?")) return;
    try {
      const res = await api("/api/admin/import/commit", { method: "POST", body: { token: r.token, mode } });
      const s = res.stats;
      pv.innerHTML = `<div class="card"><h3 style="color:var(--green)">✓ Амжилттай импортлолоо</h3>
        <div class="row"><span class="chip">Шинэ түвшин: ${s.levels_new}</span><span class="chip">Шинэ хичээл: ${s.lessons_new}</span>
        <span class="chip">Түвшин тогтоох: ${s.placement}</span><span class="chip">Дасгал: ${s.exercises}</span><span class="chip">Түвшний шалгалт: ${s.exam}</span></div>
        <div class="row" style="margin-top:14px"><a class="btn" href="#questions">Асуултын сан руу →</a></div></div>`;
      toast("Импорт дууслаа ✓");
    } catch (e) { toast(e.message, true); }
  };
}

// ---------------- questions ----------------
let QF = { kind: "", level_id: "", lesson_id: "", q: "" };
async function questions() {
  main.innerHTML = `<div class="row"><h1 style="margin:0">❓ Асуултын сан</h1><span class="spacer"></span><button class="btn" id="new">＋ Асуулт нэмэх</button></div>
  <div class="card row" style="margin:14px 0">
    <select id="fk" style="width:auto"><option value="">Бүх төрөл</option>${opts(Object.entries(KIND), QF.kind)}</select>
    <select id="fl" style="width:auto">${lvOpts(QF.level_id, "Бүх түвшин")}</select>
    <select id="fls" style="width:auto;max-width:300px"><option value="">Бүх хичээл</option>${lsOpts(QF.lesson_id, QF.level_id)}</select>
    <input id="fq" placeholder="🔍 Хайх" value="${esc(QF.q)}" style="width:200px">
  </div><div class="card tbl" id="qt"><div class="spinner"></div></div>`;
  const load = async () => {
    const p = new URLSearchParams(Object.entries(QF).filter(([, v]) => v));
    const rows = await api("/api/admin/questions?" + p);
    $("#qt").innerHTML = `<p class="small muted">${rows.length} асуулт</p><table><thead><tr><th>#</th><th>Төрөл</th><th>Түвшин / хичээл</th><th>Асуулт</th><th>Хариулт</th><th></th></tr></thead><tbody>
      ${rows.map((q) => `<tr><td class="muted small">${q.id}</td><td><span class="pill ${q.kind}">${KIND[q.kind]}</span><div class="small muted">${QT[q.qtype]}</div></td>
        <td class="small">${q.level_ord ?? ""}. ${esc(q.level_name || "")}${q.lesson_title ? `<br><span class="muted">${SEC[q.section] || ""} — ${esc(q.lesson_title)}</span>` : ""}</td>
        <td>${renderInline(q.text)}</td><td><b>${esc(q.qtype === "truefalse" ? (q.answer === "T" ? "Үнэн" : "Худал") : q.answer)}</b></td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-e="${q.id}">✏️</button> <button class="btn ghost sm" data-d="${q.id}">🗑</button></td></tr>`).join("")}</tbody></table>`;
    $("#qt").onclick = async (e) => {
      const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]");
      if (ed) qForm(rows.find((x) => x.id == ed.dataset.e), load);
      if (dl && confirm("Устгах уу?")) { await api(`/api/admin/questions/${dl.dataset.d}`, { method: "DELETE" }); load(); }
    };
  };
  $("#fk").onchange = (e) => { QF.kind = e.target.value; load(); };
  $("#fl").onchange = (e) => { QF.level_id = e.target.value; QF.lesson_id = ""; $("#fls").innerHTML = `<option value="">Бүх хичээл</option>${lsOpts("", QF.level_id)}`; load(); };
  $("#fls").onchange = (e) => { QF.lesson_id = e.target.value; load(); };
  let tm; $("#fq").oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { QF.q = e.target.value; load(); }, 300); };
  $("#new").onclick = () => qForm(null, load);
  load();
}

function qForm(q, done) {
  q = q || { kind: QF.kind || "exercise", qtype: "mcq", level_id: QF.level_id, lesson_id: QF.lesson_id, points: 1 };
  const m = modal(q.id ? "Асуулт засах" : "Шинэ асуулт", `
    <div class="f2">
      <div><label>Төрөл</label><select name="kind">${opts(Object.entries(KIND), q.kind)}</select></div>
      <div><label>Асуултын хэлбэр</label><select name="qtype">${opts(Object.entries(QT), q.qtype)}</select></div>
      <div data-show="lv"><label>Түвшин</label><select name="level_id">${lvOpts(q.level_id)}</select></div>
      <div data-show="ls"><label>Хичээл</label><select name="lesson_id">${lsOpts(q.lesson_id)}</select></div>
    </div>
    <label>Асуулт (томьёо: $F = ma$)</label><textarea name="text" rows="3" required>${esc(q.text || "")}</textarea>
    <div class="f2" data-show="mcq">${["a", "b", "c", "d"].map((k) => `<div><label>${k.toUpperCase()}</label><input name="opt_${k}" value="${esc(q["opt_" + k] || "")}"></div>`).join("")}</div>
    <div class="f2">
      <div><label>Зөв хариулт <span class="muted" id="ah"></span></label><input name="answer" required value="${esc(q.qtype === "truefalse" ? (q.answer === "T" ? "Үнэн" : q.answer === "F" ? "Худал" : "") : q.answer || "")}"></div>
      <div data-show="num"><label>Алдааны хязгаар (±)</label><input name="tolerance" value="${esc(q.tolerance ?? "")}" placeholder="хоосон = 1%"></div>
      <div><label>Оноо</label><input name="points" type="number" min="1" value="${q.points || 1}"></div>
      <div><label>Зураг URL</label><input name="image_url" value="${esc(q.image_url || "")}"></div>
    </div>
    <label>Тайлбар (буруу хариулахад харагдана)</label><textarea name="explanation" rows="2">${esc(q.explanation || "")}</textarea>`,
  async (fd) => {
    await api(q.id ? `/api/admin/questions/${q.id}` : "/api/admin/questions", { method: q.id ? "PUT" : "POST", body: fd });
    toast("Хадгаллаа ✓"); done();
  });
  const sync = () => {
    const k = $("[name=kind]", m).value, t = $("[name=qtype]", m).value;
    $("[data-show=lv]", m).classList.toggle("hide", k === "exercise");
    $("[data-show=ls]", m).classList.toggle("hide", k !== "exercise");
    $("[data-show=mcq]", m).classList.toggle("hide", t !== "mcq");
    $("[data-show=num]", m).classList.toggle("hide", t !== "numeric");
    $("#ah", m).textContent = { mcq: "(A / B / C / D)", numeric: "(тоо)", truefalse: "(Үнэн / Худал)" }[t];
  };
  $("[name=kind]", m).onchange = sync; $("[name=qtype]", m).onchange = sync; sync();
}

// ---------------- lessons ----------------
async function lessons() {
  main.innerHTML = `<div class="row"><h1 style="margin:0">🎬 Хичээлүүд</h1><span class="spacer"></span><button class="btn" id="new">＋ Хичээл нэмэх</button></div>
  <div class="card tbl" style="margin-top:14px"><table><thead><tr><th>Түвшин</th><th>Хэсэг</th><th>#</th><th>Гарчиг</th><th>Видео</th><th>Симуляц</th><th>Асуулт</th><th></th></tr></thead><tbody>
  ${LESSONS.map((l) => `<tr><td>${l.level_ord}. ${esc(l.level_name)}</td><td>${SEC[l.section]}</td><td>${l.ord}</td><td><b>${esc(l.title)}</b></td>
    <td>${l.youtube_url ? `<a href="${esc(l.youtube_url)}" target="_blank" rel="noopener">▶️</a>` : `<span class="muted">—</span>`}</td><td>${SIM[l.sim_key] || "—"}</td>
    <td><a href="#questions" data-q="${l.id}">${l.questions}</a></td>
    <td style="white-space:nowrap"><button class="btn ghost sm" data-e="${l.id}">✏️</button> <button class="btn ghost sm" data-d="${l.id}">🗑</button></td></tr>`).join("") || `<tr><td colspan="8" class="muted">Хичээл алга. Excel-ээр импортлох эсвэл нэмнэ үү.</td></tr>`}
  </tbody></table></div>`;
  main.querySelector("table").onclick = async (e) => {
    const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]"), q = e.target.closest("[data-q]");
    if (q) { QF = { kind: "exercise", level_id: "", lesson_id: q.dataset.q, q: "" }; }
    if (ed) lessonForm(LESSONS.find((x) => x.id == ed.dataset.e));
    if (dl && confirm("Хичээл болон түүний бүх асуулт устна. Устгах уу?")) { await api(`/api/admin/lessons/${dl.dataset.d}`, { method: "DELETE" }); route(); }
  };
  $("#new").onclick = () => lessonForm(null);
}

function lessonForm(l) {
  l = l || { section: "onol", ord: 1, sim_key: "" };
  modal(l.id ? "Хичээл засах" : "Шинэ хичээл", `
    <div class="f2">
      <div><label>Түвшин</label><select name="level_id">${lvOpts(l.level_id)}</select></div>
      <div><label>Хэсэг</label><select name="section">${opts(Object.entries(SEC), l.section)}</select></div>
      <div><label>Дараалал</label><input name="ord" type="number" min="1" value="${l.ord}"></div>
      <div><label>Симуляц</label><select name="sim_key">${opts(Object.entries(SIM), l.sim_key)}</select></div>
    </div>
    <label>Гарчиг</label><input name="title" required value="${esc(l.title || "")}">
    <label>YouTube URL</label><input name="youtube_url" value="${esc(l.youtube_url || "")}" placeholder="https://www.youtube.com/watch?v=...">
    <label>Онолын текст (Markdown + $томьёо$)</label><textarea name="body_md" rows="10">${esc(l.body_md || "")}</textarea>`,
  async (fd) => {
    await api(l.id ? `/api/admin/lessons/${l.id}` : "/api/admin/lessons", { method: l.id ? "PUT" : "POST", body: fd });
    toast("Хадгаллаа ✓"); route();
  });
}

// ---------------- levels ----------------
async function levels() {
  main.innerHTML = `<div class="row"><h1 style="margin:0">🪐 Түвшнүүд</h1><span class="spacer"></span><button class="btn" id="new">＋ Түвшин нэмэх</button></div>
  <div class="grid g3" style="margin-top:14px">
  ${LEVELS.map((l) => `<div class="card" style="border-color:${esc(l.color)}">
    <div class="row"><span style="font-size:2rem">${esc(l.icon)}</span><div><div class="muted small">ТҮВШИН ${l.ord}</div><h3 style="margin:0">${esc(l.name)}</h3></div></div>
    <p class="muted small">${esc(l.description || "")}</p>
    <div class="small">Тэнцэх: <b>${l.pass_pct}%</b> · Хичээл: ${l.lessons}<br>Түвшин тогтоох: ${l.placement} · Дасгал: ${l.exercises} · Шалгалт: ${l.exam}</div>
    <div class="row" style="margin-top:12px"><button class="btn ghost sm" data-e="${l.id}">✏️ Засах</button><button class="btn ghost sm" data-d="${l.id}">🗑</button></div></div>`).join("")}
  </div>`;
  main.onclick = async (e) => {
    const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]");
    if (ed) levelForm(LEVELS.find((x) => x.id == ed.dataset.e));
    if (dl && confirm("Түвшин, түүний бүх хичээл, асуулт устна. Устгах уу?")) { await api(`/api/admin/levels/${dl.dataset.d}`, { method: "DELETE" }); route(); }
  };
  $("#new").onclick = () => levelForm(null);
}
function levelForm(l) {
  l = l || { ord: (LEVELS.at(-1)?.ord || 0) + 1, pass_pct: 70, color: "#38bdf8", icon: "🪐" };
  modal(l.id ? "Түвшин засах" : "Шинэ түвшин", `
    <div class="f2"><div><label>Дугаар (дараалал)</label><input name="ord" type="number" min="1" value="${l.ord}"></div>
      <div><label>Тэнцэх хувь (%)</label><input name="pass_pct" type="number" min="1" max="100" value="${l.pass_pct}"></div>
      <div><label>Icon (emoji)</label><input name="icon" value="${esc(l.icon)}"></div>
      <div><label>Өнгө</label><input name="color" type="color" value="${esc(l.color)}" style="height:46px;padding:4px"></div></div>
    <label>Нэр</label><input name="name" required value="${esc(l.name || "")}">
    <label>Тайлбар</label><textarea name="description" rows="2">${esc(l.description || "")}</textarea>`,
  async (fd) => { await api(l.id ? `/api/admin/levels/${l.id}` : "/api/admin/levels", { method: l.id ? "PUT" : "POST", body: fd }); toast("Хадгаллаа ✓"); route(); });
}

// ---------------- users ----------------
// Хичээл харагдах эрхийн мод (түвшин → хичээлүүд)
function accessHtml(mode, ids) {
  const sel = new Set((ids || []).map(Number));
  const tree = LEVELS.map((lv) => {
    const ls = LESSONS.filter((l) => l.level_id === lv.id);
    const all = ls.length && ls.every((l) => sel.has(l.id));
    return `<div class="acc-lv" style="margin:8px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px">
      <label class="row" style="margin:0;color:var(--text);gap:8px"><input type="checkbox" data-lv="${lv.id}" ${all ? "checked" : ""} style="width:auto">
        <b>${esc(lv.icon)} ${lv.ord}. ${esc(lv.name)}</b><span class="muted small">(${ls.length} хичээл)</span></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 12px;margin:6px 0 0 26px">
        ${ls.map((l) => `<label class="small" style="margin:0;display:flex;align-items:flex-start;gap:8px;color:var(--text);font-weight:500"><input type="checkbox" data-ls="${l.id}" data-of="${lv.id}" ${sel.has(l.id) ? "checked" : ""} style="width:auto;margin-top:3px;flex:none">
          <span>${SEC[l.section]} — ${esc(l.title)}</span></label>`).join("") || `<span class="muted small">Хичээл алга</span>`}
      </div></div>`;
  }).join("");
  return `<label>Харагдах хичээлүүд</label>
    <div class="row">
      <label class="row" style="margin:0;gap:6px;color:var(--text)"><input type="radio" name="access_mode" value="all" ${mode !== "custom" ? "checked" : ""} style="width:auto"> Бүх хичээл</label>
      <label class="row" style="margin:0;gap:6px;color:var(--text)"><input type="radio" name="access_mode" value="custom" ${mode === "custom" ? "checked" : ""} style="width:auto"> Зөвхөн сонгосон хичээлүүд</label>
    </div>
    <div id="acctree" class="${mode === "custom" ? "" : "hide"}">
      <div class="row small" style="margin-top:8px"><button type="button" class="btn ghost sm" data-all="1">Бүгдийг сонгох</button><button type="button" class="btn ghost sm" data-all="0">Цэвэрлэх</button>
        <span class="muted" id="acccount"></span></div>${tree}</div>`;
}

function bindAccess(m) {
  const tree = $("#acctree", m);
  const count = () => ($("#acccount", m).textContent = `${$$("[data-ls]:checked", m).length} хичээл сонгосон`);
  $$("[name=access_mode]", m).forEach((r) => (r.onchange = () => tree.classList.toggle("hide", $("[name=access_mode]:checked", m).value !== "custom")));
  tree.onchange = (e) => {
    const t = e.target;
    if (t.dataset.lv) $$(`[data-of="${t.dataset.lv}"]`, m).forEach((c) => (c.checked = t.checked));
    if (t.dataset.of) { const ls = $$(`[data-of="${t.dataset.of}"]`, m); $(`[data-lv="${t.dataset.of}"]`, m).checked = ls.every((c) => c.checked); }
    count();
  };
  tree.onclick = (e) => {
    const b = e.target.closest("[data-all]"); if (!b) return;
    $$("#acctree input[type=checkbox]", m).forEach((c) => (c.checked = b.dataset.all === "1")); count();
  };
  count();
}

function accessValue(m) {
  const mode = $("[name=access_mode]:checked", m).value;
  const ids = $$("[data-ls]:checked", m).map((c) => +c.dataset.ls);
  if (mode === "custom" && !ids.length) throw new Error("Дор хаяж нэг хичээл сонгоно уу");
  return { access_mode: mode, lesson_ids: ids };
}

function newUserForm(done) {
  const m = modal("＋ Шинэ хэрэглэгч", `
    <div class="f2">
      <div><label>Нэр</label><input name="name" required maxlength="60"></div>
      <div><label>Мэйл хаяг (нэвтрэх нэр)</label><input name="email" type="email" required autocomplete="off"></div>
      <div><label>Нууц үг (6+ тэмдэгт)</label><input name="password" type="text" minlength="6" required autocomplete="new-password" value="${Math.random().toString(36).slice(2, 10)}"></div>
      <div><label>Анги</label><select name="grade"><option value="">—</option>${[7, 8, 9, 10, 11, 12].map((g) => `<option value="${g}">${g}-р анги</option>`).join("")}</select></div>
      <div><label>Эрх</label><select name="role"><option value="student">Сурагч</option><option value="admin">Админ</option></select></div>
      <div><label>Эхлэх түвшин</label><select name="start_level_id"><option value="">Түвшин тогтоох шалгалт өгнө</option>${lvOpts("")}</select></div>
    </div>
    <p class="small muted">Нууц үгийг сурагчид өгнө. Эхлэх түвшин сонговол шалгалтгүйгээр шууд тэр түвшнээс эхэлнэ.</p>
    ${accessHtml("all", [])}`,
  async (fd) => {
    const body = { ...fd, ...accessValue(m) };
    await api("/api/admin/users", { method: "POST", body });
    toast("Хэрэглэгч нэмэгдлээ ✓"); done();
  });
  bindAccess(m);
}

async function users() {
  main.innerHTML = `<div class="row"><h1 style="margin:0">👥 Сурагчид</h1><span class="spacer"></span><input id="uq" placeholder="🔍 Нэр, мэйл" style="width:240px"><button class="btn" id="newu">＋ Хэрэглэгч нэмэх</button></div>
  <div class="card tbl" id="ut" style="margin-top:14px"><div class="spinner"></div></div>`;
  const load = async (q = "") => {
    const rows = await api("/api/admin/users" + (q ? "?q=" + encodeURIComponent(q) : ""));
    $("#ut").innerHTML = `<table><thead><tr><th></th><th>Нэр</th><th>Анги</th><th>Түвшин</th><th>XP / ★</th><th>Сүүлд</th><th></th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td style="font-size:1.3rem">${esc(u.avatar)}</td><td><b>${esc(u.name)}</b>${u.role === "admin" ? ` <span class="pill">админ</span>` : ""}<div class="small muted">${esc(u.email)}</div></td>
        <td>${u.grade ?? "—"}</td><td>${u.placed_at ? esc(u.level_name || "—") : `<span class="muted">Шалгалт өгөөгүй</span>`}
          <div class="small muted">${u.access_mode === "custom" ? `🔐 ${u.lesson_count} хичээл` : "Бүх хичээл"}</div></td>
        <td>⚡${u.xp} · ★${u.stars}</td><td class="small muted">${esc(u.last_active || "—")}</td>
        <td><button class="btn ghost sm" data-u="${u.id}">Дэлгэрэнгүй</button></td></tr>`).join("")}</tbody></table>`;
    $("#ut").onclick = (e) => { const b = e.target.closest("[data-u]"); if (b) userDetail(+b.dataset.u, () => load($("#uq").value)); };
  };
  let tm; $("#uq").oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => load(e.target.value), 300); };
  $("#newu").onclick = () => newUserForm(() => load($("#uq").value));
  load();
}

async function userDetail(id, done) {
  const r = await api(`/api/admin/users/${id}`);
  const u = r.user;
  const m = modal(`${esc(u.avatar)} ${esc(u.name)}`, `
    <p class="muted small">⚡${u.xp} XP · 🔥${u.streak}</p>
    <div class="f2">
      <div><label>Нэр</label><input name="name" required value="${esc(u.name)}"></div>
      <div><label>Мэйл хаяг (нэвтрэх нэр)</label><input name="email" type="email" required value="${esc(u.email)}"></div>
      <div><label>Анги</label><select name="grade"><option value="">—</option>${[7, 8, 9, 10, 11, 12].map((g) => `<option value="${g}" ${u.grade === g ? "selected" : ""}>${g}-р анги</option>`).join("")}</select></div>
      <div><label>Одоогийн түвшин (гараар солих)</label><select name="current_level_id"><option value="">—</option>${lvOpts(u.current_level_id)}</select></div>
      <div><label>Эрх</label><select name="role">${opts([["student", "Сурагч"], ["admin", "Админ"]], u.role)}</select></div>
      <div><label>Шинэ нууц үг (заавал биш)</label><input name="password" type="password" minlength="6" autocomplete="new-password"></div>
    </div>
    ${accessHtml(r.access_mode, r.lesson_ids)}
    <div class="row" style="margin-top:12px"><button type="button" class="btn ghost sm" id="rp">🧭 Түвшин тогтоох шалгалтыг дахин өгүүлэх</button>
      <button type="button" class="btn ghost sm" id="rall">♻️ Бүх явцыг тэглэх</button><button type="button" class="btn danger sm" id="del">Устгах</button></div>
    ${r.map.length ? `<h3 style="margin-top:18px">Явц</h3>${r.map.map((l) => `<div class="small" style="margin:6px 0"><b>${esc(l.icon)} ${esc(l.name)}</b> ★${l.stars}/${l.max_stars} ${l.exam_passed ? "✅ давсан" : l.unlocked ? "" : "🔒"}</div>`).join("")}` : ""}
    <h3 style="margin-top:18px">Оролдлогууд</h3>
    <div class="tbl" style="max-height:240px;overflow:auto"><table><tbody>${r.attempts.map((a) => `<tr><td>${{ placement: "🧭", lesson: "📘", level_exam: "🚀" }[a.kind]} ${esc(a.lesson || a.level || "")}</td><td>${a.score}/${a.total}</td><td>${a.passed ? "✅" : ""}</td><td class="small muted">${esc(a.created_at)}</td></tr>`).join("") || `<tr><td class="muted">—</td></tr>`}</tbody></table></div>`,
  async (fd) => {
    const body = { current_level_id: fd.current_level_id || null, role: fd.role, name: fd.name, email: fd.email, grade: fd.grade, ...accessValue(m) };
    if (fd.password) body.password = fd.password;
    await api(`/api/admin/users/${id}`, { method: "PUT", body }); toast("Хадгаллаа ✓"); done();
  });
  bindAccess(m);
  $("#rp", m).onclick = async () => { await api(`/api/admin/users/${id}`, { method: "PUT", body: { reset_placement: true } }); toast("Дараа нэвтрэхэд шалгалт өгнө"); m.remove(); done(); };
  $("#rall", m).onclick = async () => { if (!confirm("Энэ сурагчийн XP, од, оролдлого бүгд устна. Итгэлтэй юу?")) return; await api(`/api/admin/users/${id}`, { method: "PUT", body: { reset_progress: true } }); toast("Тэглэлээ"); m.remove(); done(); };
  $("#del", m).onclick = async () => { if (!confirm("Сурагчийг бүр мөсөн устгах уу? Буцаах боломжгүй.")) return; await api(`/api/admin/users/${id}`, { method: "DELETE" }); toast("Устгалаа"); m.remove(); done(); };
}

route();
