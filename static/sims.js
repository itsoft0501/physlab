// Виртуал туршилтууд: pendulum, projectile, ohm
window.SIMS = (() => {
  const W = 800, H = 420;
  const C = { cyan: "#38bdf8", violet: "#a78bfa", pink: "#f472b6", green: "#34d399", amber: "#fbbf24", grid: "rgba(148,163,255,.12)", text: "#cbd5ff" };

  function shell(el, title, ctrls) {
    el.innerHTML = `<div class="sim"><div class="row" style="margin-bottom:10px"><b>🧪 ${title}</b><span class="spacer"></span><span class="chip small">Виртуал лаборатори</span></div>
      <canvas width="${W}" height="${H}"></canvas><div class="ctrls">${ctrls}</div><div class="readout"></div></div>`;
    const cv = el.querySelector("canvas");
    return { cv, ctx: cv.getContext("2d"), q: (s) => el.querySelector(s), out: el.querySelector(".readout") };
  }
  const slider = (id, label, min, max, step, val, unit) =>
    `<div><label>${label}<b id="${id}v">${val} ${unit}</b></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  const gsel = (id) => `<div><label>Чөлөөт уналтын хурдатгал g</label><select id="${id}">
    <option value="9.8">Дэлхий — 9.8 м/с²</option><option value="10">Дэлхий (бодлого) — 10 м/с²</option>
    <option value="1.62">Сар — 1.62 м/с²</option><option value="3.71">Ангараг — 3.71 м/с²</option><option value="24.79">Бархасбадь — 24.79 м/с²</option></select></div>`;
  const chip = (t) => `<span class="chip">${t}</span>`;
  const fmt = (x, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toString();

  // ---------------- шидэгдсэн бие ----------------
  function projectile(el) {
    const s = shell(el, "Шидэгдсэн биеийн хөдөлгөөн",
      slider("v", "Анхны хурд v₀", 1, 40, 1, 20, "м/с") + slider("a", "Өнцөг α", 0, 90, 1, 45, "°") + gsel("g") +
      `<div style="display:flex;align-items:end;gap:8px"><button class="btn" id="fire">🚀 Шидэх</button><button class="btn ghost" id="clr">Цэвэрлэх</button></div>`);
    let raf = 0, trails = [], anim = null;
    const P = () => ({ v: +s.q("#v").value, a: +s.q("#a").value, g: +s.q("#g").value });
    const calc = ({ v, a, g }) => {
      const r = (a * Math.PI) / 180;
      return { T: (2 * v * Math.sin(r)) / g, L: (v * v * Math.sin(2 * r)) / g, Hm: (v * Math.sin(r)) ** 2 / (2 * g), r };
    };
    let scale = 8;
    function fit() {
      const all = [...trails.map((t) => t.c), calc(P())];
      const L = Math.max(10, ...all.map((c) => c.L)), Hm = Math.max(5, ...all.map((c) => c.Hm));
      scale = Math.min((W - 90) / L, (H - 80) / Hm);
    }
    function draw(now) {
      const { ctx } = s;
      ctx.fillStyle = "#050816"; ctx.fillRect(0, 0, W, H);
      const ox = 50, oy = H - 40;
      // grid
      const stepM = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((m) => m * scale > 60) || 1000;
      ctx.font = "12px Inter, sans-serif"; ctx.fillStyle = C.text; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      for (let x = 0; ox + x * scale < W; x += stepM) { ctx.beginPath(); ctx.moveTo(ox + x * scale, 0); ctx.lineTo(ox + x * scale, oy); ctx.stroke(); ctx.fillText(x + " м", ox + x * scale - 8, oy + 18); }
      for (let y = stepM; oy - y * scale > 0; y += stepM) { ctx.beginPath(); ctx.moveTo(ox, oy - y * scale); ctx.lineTo(W, oy - y * scale); ctx.stroke(); ctx.fillText(y + " м", 6, oy - y * scale + 4); }
      ctx.strokeStyle = C.green; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
      // cannon
      const p = P(), r = (p.a * Math.PI) / 180;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(-r); ctx.fillStyle = C.violet; ctx.fillRect(0, -7, 36, 14); ctx.restore();
      ctx.fillStyle = C.cyan; ctx.beginPath(); ctx.arc(ox, oy, 12, Math.PI, 0); ctx.fill();
      // trails
      const cols = [C.cyan, C.pink, C.amber, C.green, C.violet];
      trails.forEach((t, k) => {
        const tt = t === anim ? Math.min(t.c.T, (now - t.t0) / 1000) : t.c.T;
        ctx.strokeStyle = cols[k % 5]; ctx.lineWidth = 2.5; ctx.setLineDash(t === anim ? [] : [6, 5]); ctx.beginPath();
        for (let x = 0; x <= tt + 1e-9; x += Math.max(t.c.T / 120, 0.005)) {
          const px = ox + t.v * Math.cos(t.c.r) * x * scale, py = oy - (t.v * Math.sin(t.c.r) * x - (t.g * x * x) / 2) * scale;
          x ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke(); ctx.setLineDash([]);
        const bx = ox + t.v * Math.cos(t.c.r) * tt * scale, by = oy - (t.v * Math.sin(t.c.r) * tt - (t.g * tt * tt) / 2) * scale;
        ctx.fillStyle = cols[k % 5]; ctx.shadowColor = cols[k % 5]; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        if (tt >= t.c.T) { ctx.fillStyle = C.text; ctx.fillText(`${fmt(t.c.L, 1)} м`, bx - 14, oy - 12); }
      });
      if (anim && (now - anim.t0) / 1000 < anim.c.T) raf = requestAnimationFrame(draw);
      else { anim = null; raf = 0; }
    }
    function readout() {
      const c = calc(P());
      s.out.innerHTML = chip(`📏 Тусах зай L = ${fmt(c.L)} м`) + chip(`⛰️ Max өндөр H = ${fmt(c.Hm)} м`) + chip(`⏱ Нислэгийн хугацаа t = ${fmt(c.T)} с`);
    }
    function upd() {
      const p = P();
      s.q("#vv").textContent = p.v + " м/с"; s.q("#av").textContent = p.a + "°";
      readout(); fit(); if (!raf) draw(performance.now());
    }
    ["#v", "#a", "#g"].forEach((id) => (s.q(id).oninput = upd));
    s.q("#fire").onclick = () => {
      const p = P(); const t = { ...p, c: calc(p), t0: performance.now() };
      trails.push(t); if (trails.length > 5) trails.shift();
      anim = t; fit(); cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
    };
    s.q("#clr").onclick = () => { trails = []; anim = null; upd(); };
    upd();
    return { stop: () => cancelAnimationFrame(raf) };
  }

  // ---------------- дүүжин ----------------
  function pendulum(el) {
    const s = shell(el, "Математик дүүжин",
      slider("L", "Утасны урт L", 0.1, 3, 0.05, 1, "м") + slider("m", "Бөмбөлгийн масс m", 0.1, 5, 0.1, 1, "кг") + gsel("g") +
      `<div><label>Хугацааны хурд</label><select id="sp"><option value="1">x1 (бодит)</option><option value="2">x2</option><option value="5">x5</option></select></div>` +
      `<div style="display:flex;align-items:end;gap:8px"><button class="btn" id="go">⏱ 10 хэлбэлзэл хэмжих</button></div>`);
    s.q("#g").value = "9.8";
    let raf = 0, t = 0, last = performance.now(), meas = null, result = null;
    const P = () => ({ L: +s.q("#L").value, m: +s.q("#m").value, g: +s.q("#g").value, sp: +s.q("#sp").value });
    const th0 = 0.35;
    function frame(now) {
      const p = P();
      const dt = Math.min(0.05, (now - last) / 1000) * p.sp; last = now; t += dt;
      const w = Math.sqrt(p.g / p.L), T = (2 * Math.PI) / w;
      const th = th0 * Math.cos(w * t);
      const { ctx } = s;
      ctx.fillStyle = "#050816"; ctx.fillRect(0, 0, W, H);
      const px = W / 2, py = 30, len = 40 + (p.L / 3) * (H - 110);
      ctx.fillStyle = "#334155"; ctx.fillRect(px - 120, py - 10, 240, 10);
      // arc of swing
      ctx.strokeStyle = C.grid; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(px, py, len, Math.PI / 2 - th0, Math.PI / 2 + th0); ctx.stroke(); ctx.setLineDash([]);
      const bx = px + len * Math.sin(th), by = py + len * Math.cos(th);
      ctx.strokeStyle = C.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
      const rad = 10 + Math.sqrt(p.m) * 8;
      const grd = ctx.createRadialGradient(bx - rad / 3, by - rad / 3, 2, bx, by, rad);
      grd.addColorStop(0, "#fff"); grd.addColorStop(.3, C.pink); grd.addColorStop(1, "#7c3aed");
      ctx.fillStyle = grd; ctx.shadowColor = C.pink; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(bx, by, rad, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      // stopwatch
      ctx.font = "bold 28px Montserrat, sans-serif"; ctx.fillStyle = C.amber;
      if (meas) {
        const el2 = t - meas.t0, n = Math.floor(el2 / T);
        if (n >= 10) { result = { time: 10 * T, T }; meas = null; s.q("#go").disabled = false; readout(); }
        else { ctx.fillText(`⏱ ${el2.toFixed(2)} с`, 24, H - 50); ctx.font = "16px Inter"; ctx.fillStyle = C.text; ctx.fillText(`Хэлбэлзэл: ${n} / 10`, 24, H - 22); }
      } else if (result) { ctx.fillText(`⏱ ${result.time.toFixed(2)} с`, 24, H - 50); ctx.font = "16px Inter"; ctx.fillStyle = C.text; ctx.fillText(`10 хэлбэлзэл дууслаа`, 24, H - 22); }
      ctx.font = "14px Inter"; ctx.fillStyle = C.text; ctx.fillText(`L = ${p.L.toFixed(2)} м`, px + 10, py + len / 2);
      raf = requestAnimationFrame(frame);
    }
    function readout() {
      const p = P();
      s.q("#Lv").textContent = p.L.toFixed(2) + " м"; s.q("#mv").textContent = p.m.toFixed(1) + " кг";
      s.out.innerHTML = (result ? chip(`⏱ 10 хэлбэлзэл: ${result.time.toFixed(2)} с`) + chip(`🔁 Үе T = ${(result.time / 10).toFixed(3)} с`) + chip(`〰️ Давтамж f = ${(10 / result.time).toFixed(3)} Гц`)
        : chip("«10 хэлбэлзэл хэмжих» товчийг дарж үеийг хэмжээрэй")) + chip("Томьёо: T = 2π√(L/g)");
    }
    ["#L", "#m", "#g"].forEach((id) => (s.q(id).oninput = () => { result = null; meas = null; s.q("#go").disabled = false; t = 0; readout(); }));
    s.q("#go").onclick = () => {
      // Хэлбэлзлийг хамгийн их хазайлтаас эхлүүлнэ
      t = 0; result = null; meas = { t0: 0 }; s.q("#go").disabled = true; readout();
    };
    readout();
    raf = requestAnimationFrame(frame);
    return { stop: () => cancelAnimationFrame(raf) };
  }

  // ---------------- Омын хууль ----------------
  function ohm(el) {
    const s = shell(el, "Цахилгаан хэлхээ — Омын хууль",
      slider("U", "Хүчдэл U", 0, 24, 0.5, 9, "В") + slider("R", "Эсэргүүцэл R", 1, 30, 0.5, 3, "Ом"));
    let raf = 0, phase = 0, last = performance.now();
    const P = () => ({ U: +s.q("#U").value, R: +s.q("#R").value });
    const x0 = 110, y0 = 70, x1 = 690, y1 = 340;
    const per = 2 * (x1 - x0 + y1 - y0);
    function pt(d) {
      d = ((d % per) + per) % per;
      const w = x1 - x0, h = y1 - y0;
      if (d < w) return [x0 + d, y0];
      if ((d -= w) < h) return [x1, y0 + d];
      if ((d -= h) < w) return [x1 - d, y1];
      d -= w; return [x0, y1 - d];
    }
    function frame(now) {
      const p = P(), I = p.U / p.R, Pw = p.U * I;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      phase += dt * I * 40;
      const { ctx } = s;
      ctx.fillStyle = "#050816"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#64748b"; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      // electrons (сөрөг -> гүйдлийн эсрэг)
      ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = 10;
      for (let k = 0; k < per; k += 34) { const [x, y] = pt(k - phase); ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }
      ctx.shadowBlur = 0;
      // battery (left)
      const by = (y0 + y1) / 2;
      ctx.fillStyle = "#050816"; ctx.fillRect(x0 - 40, by - 40, 80, 80);
      ctx.fillStyle = C.amber; ctx.fillRect(x0 - 30, by - 14, 60, 6); ctx.fillRect(x0 - 18, by + 8, 36, 6);
      ctx.font = "bold 16px Montserrat"; ctx.fillStyle = C.amber; ctx.fillText(`${p.U} В`, x0 - 95, by + 6);
      ctx.font = "14px Inter"; ctx.fillStyle = C.text; ctx.fillText("+", x0 + 34, by - 10); ctx.fillText("−", x0 + 22, by + 20);
      // resistor (top)
      const rx = (x0 + x1) / 2 - 80;
      ctx.fillStyle = "#050816"; ctx.fillRect(rx - 6, y0 - 22, 172, 44);
      ctx.strokeStyle = C.pink; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(rx - 6, y0);
      for (let k = 0; k <= 8; k++) ctx.lineTo(rx + k * 20, y0 + (k % 2 ? -16 : 16));
      ctx.lineTo(rx + 166, y0); ctx.stroke();
      ctx.font = "bold 16px Montserrat"; ctx.fillStyle = C.pink; ctx.fillText(`R = ${p.R} Ом`, rx + 30, y0 - 30);
      // bulb (bottom)
      const bx = (x0 + x1) / 2, glow = Math.min(1, Pw / 60);
      ctx.fillStyle = "#050816"; ctx.fillRect(bx - 40, y1 - 40, 80, 80);
      ctx.shadowColor = C.amber; ctx.shadowBlur = 60 * glow;
      ctx.fillStyle = `rgba(251,191,36,${0.15 + 0.85 * glow})`; ctx.beginPath(); ctx.arc(bx, y1, 26, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = "14px Inter"; ctx.fillStyle = C.text; ctx.fillText("Чийдэн", bx - 24, y1 + 50);
      // ammeter (right)
      ctx.fillStyle = "#0f172a"; ctx.strokeStyle = C.green; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x1, by, 40, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.green; ctx.font = "bold 18px Montserrat"; ctx.textAlign = "center"; ctx.fillText("A", x1, by - 10);
      ctx.font = "bold 16px Montserrat"; ctx.fillText(`${fmt(I)}`, x1, by + 16); ctx.textAlign = "left";
      ctx.font = "13px Inter"; ctx.fillStyle = C.text; ctx.fillText("Цэнхэр цэгүүд = электронууд", 20, H - 16);
      raf = requestAnimationFrame(frame);
    }
    function readout() {
      const p = P(), I = p.U / p.R;
      s.q("#Uv").textContent = p.U + " В"; s.q("#Rv").textContent = p.R + " Ом";
      s.out.innerHTML = chip(`🅰️ Гүйдэл I = U/R = ${fmt(I, 3)} А`) + chip(`💡 Чадал P = UI = ${fmt(p.U * I)} Вт`);
    }
    ["#U", "#R"].forEach((id) => (s.q(id).oninput = readout));
    readout();
    raf = requestAnimationFrame(frame);
    return { stop: () => cancelAnimationFrame(raf) };
  }

  return { projectile, pendulum, ohm };
})();
