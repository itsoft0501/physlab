"""Шалгалт дүгнэх, од/XP, түвшин ахих логик."""
from __future__ import annotations

import json
import random
from datetime import timedelta

import db

SECTIONS = ["onol", "bodlogo", "turshilt"]
SECTION_MN = {"onol": "Онол", "bodlogo": "Бодлого", "turshilt": "Туршилт"}
XP_PER_POINT = 10
XP_PER_STAR = 25
XP_LEVEL_UP = 200
XP_PLACEMENT = 50


# ---------- хариулт шалгах ----------
def norm_tf(v: str) -> str:
    s = str(v).strip().lower()
    if s in ("t", "true", "үнэн", "1", "тийм", "зөв", "yes"):
        return "T"
    if s in ("f", "false", "худал", "0", "үгүй", "буруу", "no"):
        return "F"
    return s.upper()


def to_float(v) -> float | None:
    try:
        return float(str(v).strip().replace(",", ".").replace(" ", ""))
    except (TypeError, ValueError):
        return None


def is_correct(q: dict, given) -> bool:
    if given is None or str(given).strip() == "":
        return False
    t = q["qtype"]
    if t == "mcq":
        return str(given).strip().upper() == str(q["answer"]).strip().upper()
    if t == "truefalse":
        return norm_tf(given) == norm_tf(q["answer"])
    if t == "numeric":
        g, a = to_float(given), to_float(q["answer"])
        if g is None or a is None:
            return False
        tol = q.get("tolerance")
        if tol is None or tol == "":
            tol = max(abs(a) * 0.01, 1e-9)
        return abs(g - a) <= float(tol) + 1e-12
    return str(given).strip().lower() == str(q["answer"]).strip().lower()


def public_q(q: dict) -> dict:
    """Хариултгүй хувилбар (клиент рүү)."""
    out = {k: q[k] for k in ("id", "qtype", "text", "image_url", "points", "level_id", "section")}
    if q["qtype"] == "mcq":
        out["options"] = [(k, q[f"opt_{k.lower()}"]) for k in "ABCD" if q.get(f"opt_{k.lower()}")]
    return out


def reveal(q: dict) -> dict:
    ans = q["answer"]
    if q["qtype"] == "truefalse":
        ans = "Үнэн" if norm_tf(ans) == "T" else "Худал"
    elif q["qtype"] == "mcq":
        txt = q.get(f"opt_{str(ans).strip().lower()}") or ""
        ans = f"{str(ans).upper()}. {txt}".strip()
    return {"answer": ans, "explanation": q.get("explanation") or ""}


def grade(con, qids_answers: dict, allowed: set[int] | None = None):
    """qids_answers: {qid: given}. Буцаах: (score, total, details, by_level)."""
    ids = [int(k) for k in qids_answers.keys()]
    if allowed is not None:
        ids = [i for i in ids if i in allowed]
    if not ids:
        return 0, 0, [], {}
    qs = {q["id"]: q for q in db.rows(con, f"SELECT * FROM questions WHERE id IN ({','.join('?'*len(ids))})", ids)}
    score = total = 0
    details, by_level = [], {}
    for qid in ids:
        q = qs.get(qid)
        if not q:
            continue
        given = qids_answers.get(str(qid), qids_answers.get(qid))
        ok = is_correct(q, given)
        pts = q["points"] or 1
        total += pts
        score += pts if ok else 0
        lv = by_level.setdefault(q["level_id"], [0, 0])
        lv[0] += pts if ok else 0
        lv[1] += pts
        details.append({"id": qid, "given": given, "correct": ok, **reveal(q)})
    return score, total, details, by_level


def save_attempt(con, uid, kind, level_id, lesson_id, score, total, passed, details, extra=None):
    cur = con.execute(
        "INSERT INTO attempts(user_id,kind,level_id,lesson_id,score,total,passed,detail) VALUES(?,?,?,?,?,?,?,?)",
        (uid, kind, level_id, lesson_id, score, total, int(bool(passed)), json.dumps(extra or {}, ensure_ascii=False)),
    )
    aid = cur.lastrowid
    con.executemany(
        "INSERT INTO answers(attempt_id,question_id,given,correct) VALUES(?,?,?,?)",
        [(aid, d["id"], None if d["given"] is None else str(d["given"]), int(d["correct"])) for d in details],
    )
    return aid


def stars_for(pct: float) -> int:
    if pct >= 90:
        return 3
    if pct >= 70:
        return 2
    if pct >= 50:
        return 1
    return 0


def touch_streak(con, u: dict) -> None:
    today = db.now().date()
    last = u.get("last_active")
    if last == today.isoformat():
        return
    streak = u["streak"] + 1 if last == (today - timedelta(days=1)).isoformat() else 1
    con.execute("UPDATE users SET streak=?, last_active=? WHERE id=?", (streak, today.isoformat(), u["id"]))


def add_xp(con, uid: int, xp: int) -> None:
    if xp > 0:
        con.execute("UPDATE users SET xp=xp+? WHERE id=?", (xp, uid))


# ---------- түвшин ----------
def ordered_levels(con):
    return db.rows(con, "SELECT * FROM levels ORDER BY ord, id")


def allowed_lessons(con, u: dict | None):
    """custom горимтой хэрэглэгчид админы сонгосон хичээлүүд, бусад нь None (бүгд)."""
    if not u or u.get("access_mode") != "custom":
        return None
    return {r["lesson_id"] for r in db.rows(con, "SELECT lesson_id FROM user_lessons WHERE user_id=?", (u["id"],))}


def visible_levels(con, u: dict | None = None):
    levels = ordered_levels(con)
    allowed = allowed_lessons(con, u)
    if allowed is None:
        return levels
    lv_ids = {r["level_id"] for r in db.rows(con, "SELECT DISTINCT level_id FROM lessons WHERE id IN (%s)"
                                             % (",".join(str(int(i)) for i in allowed) or "0"))}
    return [l for l in levels if l["id"] in lv_ids]


def placement_questions(con, per_level: int, u: dict | None = None):
    out = []
    for lv in visible_levels(con, u):
        qs = db.rows(con, "SELECT * FROM questions WHERE kind='placement' AND level_id=?", (lv["id"],))
        random.shuffle(qs)
        out.extend(qs[:per_level])
    return out


def place(con, by_level: dict, u: dict | None = None):
    """Доод түвшнээс эхлэн дараалан тэнцсэн хамгийн өндөр түвшин. Тэнцээгүй бол 1-р түвшин."""
    levels = visible_levels(con, u)
    if not levels:
        return None, []
    placed = levels[0]
    report = []
    chain = True
    for lv in levels:
        s, t = by_level.get(lv["id"], (0, 0))
        pct = round(100 * s / t) if t else 0
        ok = t > 0 and pct >= lv["pass_pct"]
        report.append({"level_id": lv["id"], "name": lv["name"], "pct": pct, "passed": ok, "total": t})
        if chain and ok:
            placed = lv
        elif t > 0:
            chain = False
    return placed, report


def level_ord(con, level_id):
    r = db.row(con, "SELECT ord FROM levels WHERE id=?", (level_id,))
    return r["ord"] if r else None


def lessons_of(con, level_id):
    ls = db.rows(con, "SELECT * FROM lessons WHERE level_id=?", (level_id,))
    ls.sort(key=lambda l: (SECTIONS.index(l["section"]) if l["section"] in SECTIONS else 9, l["ord"], l["id"]))
    return ls


def map_state(con, u: dict):
    """Сурагчийн газрын зураг: түвшин бүр, хичээл бүрийн төлөв."""
    levels = visible_levels(con, u)
    allowed = allowed_lessons(con, u)
    cur_ord = level_ord(con, u["current_level_id"]) if u["current_level_id"] else None
    if levels:  # одоогийн түвшин харагдахгүй (доор) байсан ч эхний харагдах түвшин нээлттэй
        cur_ord = max(cur_ord if cur_ord is not None else 0, levels[0]["ord"])
    else:
        cur_ord = 0
    prog = {p["lesson_id"]: p for p in db.rows(con, "SELECT * FROM progress WHERE user_id=?", (u["id"],))}
    passed_exams = {r["level_id"] for r in db.rows(
        con, "SELECT DISTINCT level_id FROM attempts WHERE user_id=? AND kind='level_exam' AND passed=1", (u["id"],))}
    out = []
    for lv in levels:
        unlocked = lv["ord"] <= cur_ord
        lessons = []
        prev_done = True
        for l in lessons_of(con, lv["id"]):
            if allowed is not None and l["id"] not in allowed:
                continue
            p = prog.get(l["id"])
            stars = p["stars"] if p else 0
            nq = con.execute("SELECT COUNT(*) FROM questions WHERE lesson_id=?", (l["id"],)).fetchone()[0]
            lessons.append({
                "id": l["id"], "title": l["title"], "section": l["section"], "section_mn": SECTION_MN.get(l["section"], l["section"]),
                "stars": stars, "unlocked": unlocked and prev_done, "has_video": bool(l["youtube_url"]),
                "sim_key": l["sim_key"], "questions": nq,
            })
            prev_done = prev_done and stars >= 1
        out.append({
            "id": lv["id"], "ord": lv["ord"], "name": lv["name"], "description": lv["description"],
            "color": lv["color"], "icon": lv["icon"], "pass_pct": lv["pass_pct"],
            "unlocked": unlocked, "current": lv["id"] == u["current_level_id"],
            "lessons": lessons, "exam_unlocked": unlocked and prev_done,
            "exam_passed": lv["id"] in passed_exams,
            "stars": sum(x["stars"] for x in lessons), "max_stars": 3 * len(lessons),
        })
    return out


def exam_questions(con, level_id: int, n: int = 10):
    qs = db.rows(con, "SELECT * FROM questions WHERE kind='level_exam' AND level_id=?", (level_id,))
    if len(qs) < n:
        extra = db.rows(con, "SELECT * FROM questions WHERE kind='exercise' AND level_id=?", (level_id,))
        random.shuffle(extra)
        qs += extra[: n - len(qs)]
    random.shuffle(qs)
    return qs[:n]


def next_level(con, level_id, u: dict | None = None):
    o = level_ord(con, level_id)
    return next((l for l in visible_levels(con, u) if l["ord"] > o), None)


# ---------- badge ----------
BADGES = [
    ("placed", "🧭", "Замаа олсон", "Түвшин тогтоох шалгалт өгсөн"),
    ("first_star", "⭐", "Анхны од", "Анхны хичээлээ дүүргэсэн"),
    ("perfect", "💎", "Төгс", "Хичээлд 3 од авсан"),
    ("level_up", "🚀", "Хөөрөлт", "Түвшин ахисан"),
    ("streak3", "🔥", "Галтай", "3 өдөр дараалан"),
    ("streak7", "☄️", "Сүүлт од", "7 өдөр дараалан"),
    ("xp500", "⚡", "Энерги 500", "500 XP цуглуулсан"),
    ("xp2000", "🌌", "Галактик", "2000 XP цуглуулсан"),
    ("lab", "🧪", "Лаборант", "Туршилт дүүргэсэн"),
]


def badges(con, u: dict):
    uid = u["id"]
    stars = db.rows(con, "SELECT p.stars, l.section FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=?", (uid,))
    lvl_ups = con.execute("SELECT COUNT(*) FROM attempts WHERE user_id=? AND kind='level_exam' AND passed=1", (uid,)).fetchone()[0]
    have = {
        "placed": bool(u["placed_at"]),
        "first_star": any(s["stars"] >= 1 for s in stars),
        "perfect": any(s["stars"] == 3 for s in stars),
        "level_up": lvl_ups > 0,
        "streak3": u["streak"] >= 3,
        "streak7": u["streak"] >= 7,
        "xp500": u["xp"] >= 500,
        "xp2000": u["xp"] >= 2000,
        "lab": any(s["stars"] >= 1 and s["section"] == "turshilt" for s in stars),
    }
    return [{"key": k, "icon": i, "name": n, "desc": d, "earned": have.get(k, False)} for k, i, n, d in BADGES]
