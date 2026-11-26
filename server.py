"""PhysLab — Физикийн тоглоомжуулсан сургалтын сайт.

Run:  python server.py   ->  http://127.0.0.1:47650
"""
from __future__ import annotations

import os
import re
import json
import secrets
import threading
import time
import uuid
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.responses import FileResponse, RedirectResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from starlette.middleware.sessions import SessionMiddleware  # noqa: E402

import auth  # noqa: E402
import db  # noqa: E402
import excel_io  # noqa: E402
import game  # noqa: E402

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "47650"))
PLACEMENT_PER_LEVEL = int(os.getenv("PLACEMENT_PER_LEVEL", "5"))
EXAM_SIZE = int(os.getenv("EXAM_SIZE", "10"))
SITE_NAME = os.getenv("SITE_NAME", "PhysLab")


def _secret() -> str:
    s = os.getenv("SECRET_KEY")
    if s:
        return s
    if db.IS_PG:  # Vercel: SECRET_KEY өгөөгүй бол DB-д нэг удаа үүсгэж хадгална
        with db.tx() as con:
            con.execute("INSERT INTO settings(key,value) VALUES('secret_key',?) ON CONFLICT(key) DO NOTHING",
                        (secrets.token_hex(32),))
        return db.get_setting("secret_key")
    f = db.DATA / "secret.key"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
    return f.read_text().strip()


db.init()
app = FastAPI(title=SITE_NAME, docs_url=None, redoc_url=None)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AVATARS = ["🚀", "🪐", "⚛️", "🔭", "🧲", "⚡", "🌌", "🛸", "🧪", "🤖", "🦾", "🌋"]

_ready = False
_ready_lock = threading.Lock()


def ensure_ready():
    """Хүснэгт, жишээ контент, эхний админ. Serverless дээр startup event найдваргүй тул эхний хүсэлтээр."""
    global _ready
    if _ready:
        return
    with _ready_lock:
        if _ready:
            return
        db.init()
        with db.tx() as con:
            empty = con.execute("SELECT COUNT(*) FROM levels").fetchone()[0] == 0
        if empty and os.getenv("SEED_SAMPLE", "1") == "1" and db.claim("seed_sample"):
            import sample_data
            sample_data.seed()
        email, pw = os.getenv("ADMIN_EMAIL", "").strip().lower(), os.getenv("ADMIN_PASSWORD", "")
        if email and pw:
            with db.tx() as con:
                con.execute("INSERT INTO users(email,pw_hash,name,role) VALUES(?,?,?,'admin') ON CONFLICT(email) DO NOTHING",
                            (email, auth.hash_pw(pw), "Админ"))
        _ready = True


@app.middleware("http")
async def _ready_mw(request: Request, call_next):
    if not _ready:
        await run_in_threadpool(ensure_ready)
    return await call_next(request)


# SessionMiddleware хамгийн гадна талд (сүүлд нэмэгдсэн нь гадна)
app.add_middleware(SessionMiddleware, secret_key=_secret(), session_cookie="physlab", max_age=60 * 60 * 24 * 30,
                   same_site="lax", https_only=os.getenv("COOKIE_SECURE", "0") == "1")


# ---------------- rate limit (энгийн) ----------------
_hits: dict[str, list] = {}


def limit(request: Request, key: str, n: int, per: int = 300):
    ip = request.client.host if request.client else "-"
    now = time.time()
    lst = [t for t in _hits.get(f"{key}:{ip}", []) if now - t < per]
    if len(lst) >= n:
        raise HTTPException(429, "Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.")
    lst.append(now)
    _hits[f"{key}:{ip}"] = lst


# ---------------- auth ----------------
@app.post("/api/register")
async def register(request: Request):
    limit(request, "reg", 10)
    b = await request.json()
    email = str(b.get("email", "")).strip().lower()
    pw = str(b.get("password", ""))
    name = str(b.get("name", "")).strip()
    grade = b.get("grade")
    avatar = b.get("avatar") if b.get("avatar") in AVATARS else "🚀"
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Мэйл хаяг буруу байна")
    if len(pw) < 6:
        raise HTTPException(400, "Нууц үг дор хаяж 6 тэмдэгт")
    if not name:
        raise HTTPException(400, "Нэрээ оруулна уу")
    try:
        grade = int(grade)
    except (TypeError, ValueError):
        grade = None
    if grade not in range(7, 13):
        raise HTTPException(400, "Анги 7–12 байх ёстой")
    with db.tx() as con:
        if db.row(con, "SELECT id FROM users WHERE email=?", (email,)):
            raise HTTPException(400, "Энэ мэйлээр бүртгэл байна. Нэвтэрнэ үү.")
        uid = con.execute("INSERT INTO users(email,pw_hash,name,grade,avatar) VALUES(?,?,?,?,?)",
                          (email, auth.hash_pw(pw), name[:60], grade, avatar)).lastrowid
    request.session["uid"] = uid
    return {"ok": True}


@app.post("/api/login")
async def login(request: Request):
    limit(request, "login", 20)
    b = await request.json()
    email = str(b.get("email", "")).strip().lower()
    with db.tx() as con:
        u = db.row(con, "SELECT * FROM users WHERE email=?", (email,))
    if not u or not auth.check_pw(str(b.get("password", "")), u["pw_hash"]):
        raise HTTPException(400, "Мэйл эсвэл нууц үг буруу")
    request.session["uid"] = u["id"]
    return {"ok": True, "role": u["role"]}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    u = auth.current_user(request)
    return {"user": auth.public_user(u) if u else None, "avatars": AVATARS, "site": SITE_NAME}


@app.post("/api/me")
async def update_me(request: Request, u=Depends(auth.require_user)):
    b = await request.json()
    name = str(b.get("name", u["name"])).strip()[:60] or u["name"]
    avatar = b.get("avatar") if b.get("avatar") in AVATARS else u["avatar"]
    with db.tx() as con:
        con.execute("UPDATE users SET name=?, avatar=? WHERE id=?", (name, avatar, u["id"]))
    return {"ok": True}


# ---------------- placement ----------------
@app.get("/api/placement")
def placement_get(u=Depends(auth.require_user)):
    with db.tx() as con:
        qs = game.placement_questions(con, PLACEMENT_PER_LEVEL, u)
    return {"questions": [game.public_q(q) for q in qs], "seconds": max(60, len(qs) * 60), "done": bool(u["placed_at"])}


@app.post("/api/placement")
async def placement_submit(request: Request, u=Depends(auth.require_user)):
    b = await request.json()
    answers = b.get("answers") or {}
    with db.tx() as con:
        allowed = {r["id"] for r in db.rows(con, "SELECT id FROM questions WHERE kind='placement'")}
        score, total, details, by_level = game.grade(con, answers, allowed)
        placed, report = game.place(con, by_level, u)
        if not placed:
            raise HTTPException(400, "Түвшин тохируулаагүй байна. Админтай холбогдоно уу.")
        game.save_attempt(con, u["id"], "placement", placed["id"], None, score, total, True, details, {"report": report})
        first = not u["placed_at"]
        cur_ord = game.level_ord(con, u["current_level_id"]) if u["current_level_id"] else 0
        # Дахин өгөхөд түвшинг бууруулахгүй
        new_level = placed["id"] if (first or placed["ord"] > (cur_ord or 0)) else u["current_level_id"]
        con.execute("UPDATE users SET current_level_id=?, placed_at=? WHERE id=?",
                    (new_level, db.now_str(), u["id"]))
        xp = game.XP_PLACEMENT if first else 0
        game.add_xp(con, u["id"], xp)
        game.touch_streak(con, u)
    return {"score": score, "total": total, "placed": placed, "report": report, "details": details, "xp": xp}


# ---------------- map / lessons ----------------
def _need_placed(u):
    if not u["placed_at"]:
        raise HTTPException(409, "Эхлээд түвшин тогтоох шалгалт өгнө үү")


@app.get("/api/map")
def map_get(u=Depends(auth.require_user)):
    _need_placed(u)
    with db.tx() as con:
        return {"levels": game.map_state(con, u), "user": auth.public_user(u)}


def _lesson_access(con, u, lesson_id):
    _need_placed(u)
    for lv in game.map_state(con, u):
        for l in lv["lessons"]:
            if l["id"] == lesson_id:
                if not l["unlocked"]:
                    raise HTTPException(403, "Энэ хичээл түгжээтэй байна")
                return lv, l
    raise HTTPException(404, "Хичээл олдсонгүй")


def yt_embed(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/|live/)([A-Za-z0-9_-]{11})", url)
    return f"https://www.youtube-nocookie.com/embed/{m.group(1)}?rel=0" if m else ""


@app.get("/api/lesson/{lesson_id}")
def lesson_get(lesson_id: int, u=Depends(auth.require_user)):
    with db.tx() as con:
        lv, st = _lesson_access(con, u, lesson_id)
        l = db.row(con, "SELECT * FROM lessons WHERE id=?", (lesson_id,))
        qs = db.rows(con, "SELECT * FROM questions WHERE lesson_id=? ORDER BY id", (lesson_id,))
    return {
        "lesson": {**l, "embed": yt_embed(l["youtube_url"]), "section_mn": game.SECTION_MN.get(l["section"])},
        "level": {k: lv[k] for k in ("id", "name", "color", "icon")},
        "stars": st["stars"], "questions": [game.public_q(q) for q in qs],
    }


@app.post("/api/check")
async def check(request: Request, u=Depends(auth.require_user)):
    """Тоглоомын үеийн шууд хариу (зөв/буруу + тайлбар)."""
    b = await request.json()
    with db.tx() as con:
        q = db.row(con, "SELECT * FROM questions WHERE id=?", (int(b.get("id", 0)),))
    if not q or q["kind"] == "placement":
        raise HTTPException(404, "Асуулт олдсонгүй")
    return {"correct": game.is_correct(q, b.get("given")), **game.reveal(q)}


@app.post("/api/lesson/{lesson_id}/finish")
async def lesson_finish(lesson_id: int, request: Request, u=Depends(auth.require_user)):
    b = await request.json()
    answers = b.get("answers") or {}
    with db.tx() as con:
        lv, st = _lesson_access(con, u, lesson_id)
        allowed = {r["id"] for r in db.rows(con, "SELECT id FROM questions WHERE lesson_id=?", (lesson_id,))}
        score, _, details, _ = game.grade(con, answers, allowed)
        total = con.execute("SELECT COALESCE(SUM(points),0) FROM questions WHERE lesson_id=?", (lesson_id,)).fetchone()[0]
        if total == 0:  # асуултгүй хичээл (зөвхөн видео/онол) — үзсэнээр 3 од
            pct = 100
        else:
            pct = 100 * score / total
        stars = game.stars_for(pct)
        old = db.row(con, "SELECT * FROM progress WHERE user_id=? AND lesson_id=?", (u["id"], lesson_id))
        old_stars, old_best = (old["stars"], old["best_score"]) if old else (0, 0)
        xp = max(0, score - old_best) * game.XP_PER_POINT + max(0, stars - old_stars) * game.XP_PER_STAR
        con.execute(
            """INSERT INTO progress(user_id,lesson_id,stars,best_score,completed_at) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id,lesson_id) DO UPDATE SET
               stars=CASE WHEN excluded.stars > progress.stars THEN excluded.stars ELSE progress.stars END,
               best_score=CASE WHEN excluded.best_score > progress.best_score THEN excluded.best_score ELSE progress.best_score END,
               completed_at=COALESCE(progress.completed_at, excluded.completed_at)""",
            (u["id"], lesson_id, stars, score, db.now_str() if stars else None))
        game.save_attempt(con, u["id"], "lesson", lv["id"], lesson_id, score, total, stars >= 1, details,
                          {"lives_left": b.get("lives_left"), "best_combo": b.get("best_combo")})
        game.add_xp(con, u["id"], xp)
        game.touch_streak(con, u)
    return {"score": score, "total": total, "pct": round(pct), "stars": stars, "xp": xp, "details": details,
            "new_best": stars > old_stars}


# ---------------- level exam ----------------
def _level_for_exam(con, u, level_id):
    _need_placed(u)
    lv = next((x for x in game.map_state(con, u) if x["id"] == level_id), None)
    if not lv:
        raise HTTPException(404, "Түвшин олдсонгүй")
    if not lv["exam_unlocked"]:
        raise HTTPException(403, "Эхлээд бүх хичээлээ дор хаяж 1 одтой дуусгана уу")
    return lv


@app.get("/api/level/{level_id}/exam")
def exam_get(level_id: int, u=Depends(auth.require_user)):
    with db.tx() as con:
        lv = _level_for_exam(con, u, level_id)
        qs = game.exam_questions(con, level_id, EXAM_SIZE)
    return {"level": lv, "questions": [game.public_q(q) for q in qs], "seconds": max(120, len(qs) * 75)}


@app.post("/api/level/{level_id}/exam")
async def exam_submit(level_id: int, request: Request, u=Depends(auth.require_user)):
    b = await request.json()
    with db.tx() as con:
        lv = _level_for_exam(con, u, level_id)
        allowed = {r["id"] for r in db.rows(con, "SELECT id FROM questions WHERE level_id=? AND kind IN ('level_exam','exercise')", (level_id,))}
        score, total, details, _ = game.grade(con, b.get("answers") or {}, allowed)
        pct = round(100 * score / total) if total else 0
        passed = total > 0 and pct >= lv["pass_pct"]
        nxt = game.next_level(con, level_id, u) if passed else None
        xp = 0
        leveled = False
        if passed and not lv["exam_passed"]:
            xp = game.XP_LEVEL_UP
        cur_ord = game.level_ord(con, u["current_level_id"]) if u["current_level_id"] else 0
        if passed and nxt and nxt["ord"] > (cur_ord or 0):
            con.execute("UPDATE users SET current_level_id=? WHERE id=?", (nxt["id"], u["id"]))
            leveled = True
        game.save_attempt(con, u["id"], "level_exam", level_id, None, score, total, passed, details)
        game.add_xp(con, u["id"], xp)
        game.touch_streak(con, u)
    return {"score": score, "total": total, "pct": pct, "passed": passed, "pass_pct": lv["pass_pct"],
            "next_level": nxt, "leveled": leveled, "xp": xp, "details": details, "final": passed and not nxt}


# ---------------- profile / leaderboard ----------------
@app.get("/api/profile")
def profile(u=Depends(auth.require_user)):
    with db.tx() as con:
        recent = db.rows(con, """SELECT a.kind,a.score,a.total,a.passed,a.created_at,l.title lesson,v.name AS level
                                 FROM attempts a LEFT JOIN lessons l ON l.id=a.lesson_id LEFT JOIN levels v ON v.id=a.level_id
                                 WHERE a.user_id=? ORDER BY a.id DESC LIMIT 15""", (u["id"],))
        stars = con.execute("SELECT COALESCE(SUM(stars),0) FROM progress WHERE user_id=?", (u["id"],)).fetchone()[0]
        level = db.row(con, "SELECT * FROM levels WHERE id=?", (u["current_level_id"],)) if u["current_level_id"] else None
        rank = con.execute("SELECT COUNT(*)+1 FROM users WHERE role='student' AND xp>?", (u["xp"],)).fetchone()[0]
        return {"user": auth.public_user(u), "badges": game.badges(con, u), "recent": recent, "stars": stars,
                "level": level, "rank": rank}


@app.get("/api/leaderboard")
def leaderboard(grade: int | None = None, u=Depends(auth.require_user)):
    with db.tx() as con:
        sql = """SELECT u.id,u.name,u.avatar,u.grade,u.xp,u.streak,v.name AS level,v.ord level_ord
                 FROM users u LEFT JOIN levels v ON v.id=u.current_level_id WHERE u.role='student'"""
        args: tuple = ()
        if grade:
            sql += " AND u.grade=?"
            args = (grade,)
        rows = db.rows(con, sql + " ORDER BY u.xp DESC, u.id LIMIT 50", args)
    for r in rows:
        r["me"] = r.pop("id") == u["id"]
    return {"rows": rows}


# ================= ADMIN =================
@app.get("/api/admin/stats")
def a_stats(a=Depends(auth.require_admin)):
    with db.tx() as con:
        c = lambda sql, args=(): con.execute(sql, args).fetchone()[0]  # noqa: E731
        return {
            "students": c("SELECT COUNT(*) FROM users WHERE role='student'"),
            "placed": c("SELECT COUNT(*) FROM users WHERE role='student' AND placed_at IS NOT NULL"),
            "active7": c("SELECT COUNT(*) FROM users WHERE role='student' AND last_active>=?", ((db.now() - timedelta(days=7)).date().isoformat(),)),
            "levels": c("SELECT COUNT(*) FROM levels"),
            "lessons": c("SELECT COUNT(*) FROM lessons"),
            "questions": db.rows(con, "SELECT kind, COUNT(*) n FROM questions GROUP BY kind"),
            "by_level": db.rows(con, """SELECT v.id, v.ord, v.name, v.icon, COUNT(u.id) n FROM levels v
                                         LEFT JOIN users u ON u.current_level_id=v.id AND u.role='student'
                                         GROUP BY v.id ORDER BY v.ord"""),
            "by_grade": db.rows(con, "SELECT grade, COUNT(*) n FROM users WHERE role='student' GROUP BY grade ORDER BY grade"),
            "recent": db.rows(con, """SELECT a.id,a.kind,a.score,a.total,a.passed,a.created_at,u.name,u.grade,v.name AS level,l.title lesson
                                       FROM attempts a JOIN users u ON u.id=a.user_id LEFT JOIN levels v ON v.id=a.level_id
                                       LEFT JOIN lessons l ON l.id=a.lesson_id ORDER BY a.id DESC LIMIT 20"""),
        }


# --- levels ---
@app.get("/api/admin/levels")
def a_levels(a=Depends(auth.require_admin)):
    with db.tx() as con:
        return db.rows(con, """SELECT v.*, (SELECT COUNT(*) FROM lessons WHERE level_id=v.id) lessons,
                               (SELECT COUNT(*) FROM questions WHERE level_id=v.id AND kind='placement') placement,
                               (SELECT COUNT(*) FROM questions WHERE level_id=v.id AND kind='exercise') exercises,
                               (SELECT COUNT(*) FROM questions WHERE level_id=v.id AND kind='level_exam') exam
                               FROM levels v ORDER BY ord""")


def _level_fields(b):
    name = str(b.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Нэр заавал")
    return (int(b.get("ord") or 1), name, str(b.get("description", "")), int(b.get("pass_pct") or 70),
            str(b.get("color") or "#38bdf8"), str(b.get("icon") or "🪐"))


@app.post("/api/admin/levels")
async def a_level_new(request: Request, a=Depends(auth.require_admin)):
    f = _level_fields(await request.json())
    with db.tx() as con:
        con.execute("INSERT INTO levels(ord,name,description,pass_pct,color,icon) VALUES(?,?,?,?,?,?)", f)
    return {"ok": True}


@app.put("/api/admin/levels/{lid}")
async def a_level_upd(lid: int, request: Request, a=Depends(auth.require_admin)):
    f = _level_fields(await request.json())
    with db.tx() as con:
        con.execute("UPDATE levels SET ord=?,name=?,description=?,pass_pct=?,color=?,icon=? WHERE id=?", (*f, lid))
    return {"ok": True}


@app.delete("/api/admin/levels/{lid}")
def a_level_del(lid: int, a=Depends(auth.require_admin)):
    with db.tx() as con:
        con.execute("UPDATE users SET current_level_id=NULL WHERE current_level_id=?", (lid,))
        con.execute("DELETE FROM levels WHERE id=?", (lid,))
    return {"ok": True}


# --- lessons ---
@app.get("/api/admin/lessons")
def a_lessons(level_id: int | None = None, a=Depends(auth.require_admin)):
    with db.tx() as con:
        sql = """SELECT l.*, v.name level_name, v.ord level_ord,
                 (SELECT COUNT(*) FROM questions WHERE lesson_id=l.id) questions
                 FROM lessons l JOIN levels v ON v.id=l.level_id"""
        args: tuple = ()
        if level_id:
            sql += " WHERE l.level_id=?"
            args = (level_id,)
        return db.rows(con, sql + " ORDER BY v.ord, CASE l.section WHEN 'onol' THEN 0 WHEN 'bodlogo' THEN 1 ELSE 2 END, l.ord", args)


def _lesson_fields(b):
    title = str(b.get("title", "")).strip()
    sec = b.get("section")
    if not title or sec not in game.SECTIONS:
        raise HTTPException(400, "Гарчиг, хэсэг заавал")
    sim = b.get("sim_key") or ""
    if sim not in excel_io.SIMS:
        raise HTTPException(400, "Симуляц буруу")
    return (int(b["level_id"]), sec, int(b.get("ord") or 1), title, str(b.get("youtube_url") or "").strip(),
            str(b.get("body_md") or ""), sim)


@app.post("/api/admin/lessons")
async def a_lesson_new(request: Request, a=Depends(auth.require_admin)):
    f = _lesson_fields(await request.json())
    with db.tx() as con:
        con.execute("INSERT INTO lessons(level_id,section,ord,title,youtube_url,body_md,sim_key) VALUES(?,?,?,?,?,?,?)", f)
    return {"ok": True}


@app.put("/api/admin/lessons/{lid}")
async def a_lesson_upd(lid: int, request: Request, a=Depends(auth.require_admin)):
    f = _lesson_fields(await request.json())
    with db.tx() as con:
        con.execute("UPDATE lessons SET level_id=?,section=?,ord=?,title=?,youtube_url=?,body_md=?,sim_key=? WHERE id=?", (*f, lid))
        con.execute("UPDATE questions SET level_id=?, section=? WHERE lesson_id=?", (f[0], f[1], lid))
    return {"ok": True}


@app.delete("/api/admin/lessons/{lid}")
def a_lesson_del(lid: int, a=Depends(auth.require_admin)):
    with db.tx() as con:
        con.execute("DELETE FROM lessons WHERE id=?", (lid,))
    return {"ok": True}


# --- questions ---
@app.get("/api/admin/questions")
def a_questions(kind: str | None = None, level_id: int | None = None, lesson_id: int | None = None,
                q: str | None = None, a=Depends(auth.require_admin)):
    sql = """SELECT q.*, v.name level_name, v.ord level_ord, l.title lesson_title FROM questions q
             LEFT JOIN levels v ON v.id=q.level_id LEFT JOIN lessons l ON l.id=q.lesson_id WHERE 1=1"""
    args: list = []
    if kind:
        sql += " AND q.kind=?"
        args.append(kind)
    if level_id:
        sql += " AND q.level_id=?"
        args.append(level_id)
    if lesson_id:
        sql += " AND q.lesson_id=?"
        args.append(lesson_id)
    if q:
        sql += " AND q.text LIKE ?"
        args.append(f"%{q}%")
    with db.tx() as con:
        return db.rows(con, sql + " ORDER BY v.ord, q.kind, q.lesson_id, q.id LIMIT 1000", args)


def _q_fields(con, b):
    kind = b.get("kind")
    if kind not in ("placement", "exercise", "level_exam"):
        raise HTTPException(400, "kind буруу")
    qt = b.get("qtype")
    if qt not in ("mcq", "numeric", "truefalse"):
        raise HTTPException(400, "Төрөл буруу")
    text = str(b.get("text", "")).strip()
    ans = str(b.get("answer", "")).strip()
    if not text or not ans:
        raise HTTPException(400, "Асуулт, хариулт заавал")
    lesson_id = int(b["lesson_id"]) if kind == "exercise" and b.get("lesson_id") else None
    if kind == "exercise" and not lesson_id:
        raise HTTPException(400, "Дасгалд хичээл сонгоно уу")
    if lesson_id:
        l = db.row(con, "SELECT * FROM lessons WHERE id=?", (lesson_id,))
        level_id, section = l["level_id"], l["section"]
    else:
        level_id, section = int(b.get("level_id") or 0), ""
        if not level_id:
            raise HTTPException(400, "Түвшин сонгоно уу")
    if qt == "mcq":
        ans = ans.upper()
    elif qt == "truefalse":
        ans = game.norm_tf(ans)
    elif game.to_float(ans) is None:
        raise HTTPException(400, "Тоон хариулт буруу")
    tol = game.to_float(b.get("tolerance")) if str(b.get("tolerance") or "").strip() else None
    return (kind, level_id, lesson_id, section, qt, text, b.get("opt_a") or "", b.get("opt_b") or "",
            b.get("opt_c") or "", b.get("opt_d") or "", ans, tol, b.get("explanation") or "", b.get("image_url") or "",
            int(b.get("points") or 1))


QCOLS = "kind,level_id,lesson_id,section,qtype,text,opt_a,opt_b,opt_c,opt_d,answer,tolerance,explanation,image_url,points"


@app.post("/api/admin/questions")
async def a_q_new(request: Request, a=Depends(auth.require_admin)):
    b = await request.json()
    with db.tx() as con:
        con.execute(f"INSERT INTO questions({QCOLS}) VALUES({','.join('?'*15)})", _q_fields(con, b))
    return {"ok": True}


@app.put("/api/admin/questions/{qid}")
async def a_q_upd(qid: int, request: Request, a=Depends(auth.require_admin)):
    b = await request.json()
    with db.tx() as con:
        f = _q_fields(con, b)
        con.execute(f"UPDATE questions SET {','.join(c + '=?' for c in QCOLS.split(','))} WHERE id=?", (*f, qid))
    return {"ok": True}


@app.delete("/api/admin/questions/{qid}")
def a_q_del(qid: int, a=Depends(auth.require_admin)):
    with db.tx() as con:
        con.execute("DELETE FROM questions WHERE id=?", (qid,))
    return {"ok": True}


# --- excel ---
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@app.get("/api/admin/template.xlsx")
def a_template(a=Depends(auth.require_admin)):
    return Response(excel_io.template_bytes(), media_type=XLSX,
                    headers={"Content-Disposition": "attachment; filename=physlab_template.xlsx"})


@app.get("/api/admin/export.xlsx")
def a_export(a=Depends(auth.require_admin)):
    name = f"physlab_export_{db.now():%Y%m%d_%H%M}.xlsx"
    return Response(excel_io.export_bytes(), media_type=XLSX, headers={"Content-Disposition": f"attachment; filename={name}"})


@app.post("/api/admin/import/preview")
async def a_import_preview(file: UploadFile, a=Depends(auth.require_admin)):
    data = await file.read()
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(400, "Файл хэт том (4MB хүртэл). Олон файлд хувааж оруулна уу.")
    parsed = excel_io.parse(data)
    now = time.time()
    token = uuid.uuid4().hex
    # Serverless дээр дараагийн хүсэлт өөр instance-д очиж болох тул DB-д түр хадгална
    with db.tx() as con:
        con.execute("DELETE FROM import_jobs WHERE created_at<?", (now - 3600,))
        con.execute("INSERT INTO import_jobs(token,created_at,data) VALUES(?,?,?)",
                    (token, now, json.dumps(parsed, ensure_ascii=False)))
    strip = lambda lst: lst[:200]  # noqa: E731
    return {"token": token, "errors": parsed["errors"],
            "counts": {k: len(parsed[k]) for k in ("levels", "lessons", "placement", "exercises")},
            "preview": {k: strip(parsed[k]) for k in ("levels", "lessons", "placement", "exercises")}}


@app.post("/api/admin/import/commit")
async def a_import_commit(request: Request, a=Depends(auth.require_admin)):
    b = await request.json()
    with db.tx() as con:
        item = db.row(con, "SELECT data FROM import_jobs WHERE token=? AND created_at>=?",
                      (str(b.get("token", "")), time.time() - 3600))
        con.execute("DELETE FROM import_jobs WHERE token=?", (str(b.get("token", "")),))
    if not item:
        raise HTTPException(400, "Импортын хугацаа дууссан. Файлаа дахин оруулна уу.")
    mode = "replace" if b.get("mode") == "replace" else "add"
    return {"ok": True, "stats": excel_io.commit(json.loads(item["data"]), mode)}


# --- users ---
@app.get("/api/admin/users")
def a_users(q: str | None = None, a=Depends(auth.require_admin)):
    sql = """SELECT u.id,u.email,u.name,u.grade,u.avatar,u.role,u.xp,u.streak,u.last_active,u.placed_at,u.created_at,
             u.current_level_id, v.name level_name, u.access_mode,
             (SELECT COUNT(*) FROM user_lessons WHERE user_id=u.id) lesson_count,
             (SELECT COALESCE(SUM(stars),0) FROM progress WHERE user_id=u.id) stars
             FROM users u LEFT JOIN levels v ON v.id=u.current_level_id"""
    args: tuple = ()
    if q:
        sql += " WHERE u.name LIKE ? OR u.email LIKE ?"
        args = (f"%{q}%", f"%{q}%")
    with db.tx() as con:
        return db.rows(con, sql + " ORDER BY u.id DESC LIMIT 500", args)


@app.get("/api/admin/users/{uid}")
def a_user(uid: int, a=Depends(auth.require_admin)):
    with db.tx() as con:
        u = db.row(con, "SELECT * FROM users WHERE id=?", (uid,))
        if not u:
            raise HTTPException(404)
        att = db.rows(con, """SELECT a.*, v.name AS level, l.title lesson FROM attempts a LEFT JOIN levels v ON v.id=a.level_id
                               LEFT JOIN lessons l ON l.id=a.lesson_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT 100""", (uid,))
        lessons = [r["lesson_id"] for r in db.rows(con, "SELECT lesson_id FROM user_lessons WHERE user_id=?", (uid,))]
        return {"user": auth.public_user(u), "access_mode": u["access_mode"], "lesson_ids": lessons,
                "attempts": att, "map": game.map_state(con, u) if u["placed_at"] else []}


def _set_access(con, uid: int, b: dict):
    """b.access_mode: all | custom, b.lesson_ids: [..]"""
    if "access_mode" not in b:
        return
    mode = "custom" if b.get("access_mode") == "custom" else "all"
    con.execute("UPDATE users SET access_mode=? WHERE id=?", (mode, uid))
    con.execute("DELETE FROM user_lessons WHERE user_id=?", (uid,))
    if mode == "custom":
        ids = {int(x) for x in (b.get("lesson_ids") or [])}
        valid = {r["id"] for r in db.rows(con, "SELECT id FROM lessons")}
        con.executemany("INSERT INTO user_lessons(user_id,lesson_id) VALUES(?,?)", [(uid, i) for i in ids & valid])


def _set_start_level(con, uid: int, level_id):
    """Эхлэх түвшин заавал → түвшин тогтоох шалгалтгүйгээр шууд орно."""
    if level_id:
        con.execute("UPDATE users SET current_level_id=?, placed_at=? WHERE id=?", (int(level_id), db.now_str(), uid))


@app.post("/api/admin/users")
async def a_user_new(request: Request, a=Depends(auth.require_admin)):
    b = await request.json()
    email = str(b.get("email", "")).strip().lower()
    name = str(b.get("name", "")).strip()
    pw = str(b.get("password", ""))
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Мэйл хаяг буруу байна")
    if not name:
        raise HTTPException(400, "Нэр заавал")
    if len(pw) < 6:
        raise HTTPException(400, "Нууц үг дор хаяж 6 тэмдэгт")
    try:
        grade = int(b.get("grade")) if b.get("grade") else None
    except ValueError:
        grade = None
    role = "admin" if b.get("role") == "admin" else "student"
    with db.tx() as con:
        if db.row(con, "SELECT id FROM users WHERE email=?", (email,)):
            raise HTTPException(400, "Энэ мэйлээр бүртгэл байна")
        uid = con.execute("INSERT INTO users(email,pw_hash,name,grade,role,avatar) VALUES(?,?,?,?,?,?)",
                          (email, auth.hash_pw(pw), name[:60], grade, role,
                           b.get("avatar") if b.get("avatar") in AVATARS else "🚀")).lastrowid
        _set_access(con, uid, b)
        _set_start_level(con, uid, b.get("start_level_id"))
    return {"ok": True, "id": uid}


@app.put("/api/admin/users/{uid}")
async def a_user_upd(uid: int, request: Request, a=Depends(auth.require_admin)):
    b = await request.json()
    with db.tx() as con:
        if "name" in b and str(b["name"]).strip():
            con.execute("UPDATE users SET name=? WHERE id=?", (str(b["name"]).strip()[:60], uid))
        if "grade" in b:
            try:
                g = int(b["grade"]) if b["grade"] else None
            except ValueError:
                g = None
            con.execute("UPDATE users SET grade=? WHERE id=?", (g, uid))
        if "email" in b:
            em = str(b["email"]).strip().lower()
            if not EMAIL_RE.match(em):
                raise HTTPException(400, "Мэйл хаяг буруу байна")
            if db.row(con, "SELECT id FROM users WHERE email=? AND id<>?", (em, uid)):
                raise HTTPException(400, "Энэ мэйлээр өөр бүртгэл байна")
            con.execute("UPDATE users SET email=? WHERE id=?", (em, uid))
        _set_access(con, uid, b)
        if "current_level_id" in b:
            con.execute("UPDATE users SET current_level_id=?, placed_at=COALESCE(placed_at, ?) WHERE id=?",
                        (int(b["current_level_id"]) if b["current_level_id"] else None, db.now_str(), uid))
        if b.get("role") in ("student", "admin"):
            if uid == a["id"] and b["role"] != "admin":
                raise HTTPException(400, "Өөрийгөө админаас хасах боломжгүй")
            con.execute("UPDATE users SET role=? WHERE id=?", (b["role"], uid))
        if b.get("password"):
            if len(b["password"]) < 6:
                raise HTTPException(400, "Нууц үг дор хаяж 6 тэмдэгт")
            con.execute("UPDATE users SET pw_hash=? WHERE id=?", (auth.hash_pw(b["password"]), uid))
        if b.get("reset_placement"):
            con.execute("UPDATE users SET placed_at=NULL WHERE id=?", (uid,))
        if b.get("reset_progress"):
            con.execute("DELETE FROM progress WHERE user_id=?", (uid,))
            con.execute("DELETE FROM attempts WHERE user_id=?", (uid,))
            con.execute("UPDATE users SET xp=0, streak=0, placed_at=NULL, current_level_id=NULL WHERE id=?", (uid,))
    return {"ok": True}


@app.delete("/api/admin/users/{uid}")
def a_user_del(uid: int, a=Depends(auth.require_admin)):
    if uid == a["id"]:
        raise HTTPException(400, "Өөрийгөө устгах боломжгүй")
    with db.tx() as con:
        con.execute("DELETE FROM users WHERE id=?", (uid,))
    return {"ok": True}


# ---------------- static ----------------
STATIC = BASE / "static"


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/admin")
def admin_page(request: Request):
    u = auth.current_user(request)
    if not u:
        return RedirectResponse("/#/login?next=admin")
    if u["role"] != "admin":
        raise HTTPException(403, "Зөвхөн админ")
    return FileResponse(STATIC / "admin.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")

if __name__ == "__main__":
    import uvicorn

    print(f"{SITE_NAME}: http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT)
