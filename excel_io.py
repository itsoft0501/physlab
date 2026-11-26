"""Excel template, импорт (parse + validate + commit), экспорт."""
from __future__ import annotations

import io
import re

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

import db
from game import norm_tf, to_float

S_LEVEL, S_PLACE, S_EX, S_LESSON = "Түвшин", "Шалгалт", "Дасгал", "Хичээл"

COLS = {
    S_LEVEL: ["Дугаар", "Нэр", "Тайлбар", "Тэнцэх %", "Icon", "Өнгө"],
    S_LESSON: ["Түвшин", "Хэсэг", "Дараалал", "Гарчиг", "YouTube URL", "Онол текст", "Симуляц"],
    S_PLACE: ["Түвшин", "Төрөл", "Асуулт", "A", "B", "C", "D", "Зөв хариулт", "Алдааны хязгаар", "Тайлбар", "Зураг URL", "Оноо"],
    S_EX: ["Түвшин", "Хэсэг", "Хичээлийн гарчиг", "Төрөл", "Асуулт", "A", "B", "C", "D", "Зөв хариулт",
           "Алдааны хязгаар", "Тайлбар", "Зураг URL", "Оноо"],
}
HELP = {
    S_LEVEL: "Заавал биш. Түвшин байхгүй бол бусад sheet-ээс автоматаар үүснэ.",
    S_LESSON: "Хэсэг: Онол / Бодлого / Туршилт. Симуляц: pendulum / projectile / ohm (заавал биш).",
    S_PLACE: "Түвшин тогтоох шалгалт. Төрөл: mcq (A-D сонголт) / numeric (тоо) / truefalse (Үнэн/Худал).",
    S_EX: "Хэсэг: Онол / Бодлого / Туршилт / Түвшний шалгалт. Хичээл байхгүй бол автоматаар үүснэ.",
}

SECTION_MAP = {"онол": "onol", "onol": "onol", "theory": "onol",
               "бодлого": "bodlogo", "bodlogo": "bodlogo", "problem": "bodlogo",
               "туршилт": "turshilt", "turshilt": "turshilt", "experiment": "turshilt",
               "түвшний шалгалт": "exam", "шалгалт": "exam", "exam": "exam"}
SECTION_OUT = {"onol": "Онол", "bodlogo": "Бодлого", "turshilt": "Туршилт"}
TYPE_MAP = {"mcq": "mcq", "сонгох": "mcq", "сонголт": "mcq", "олон сонголт": "mcq", "test": "mcq",
            "numeric": "numeric", "тоо": "numeric", "тоон": "numeric", "number": "numeric",
            "truefalse": "truefalse", "үнэн/худал": "truefalse", "үх": "truefalse", "tf": "truefalse", "true/false": "truefalse"}
SIMS = {"", "pendulum", "projectile", "ohm"}

HEAD_FILL = PatternFill("solid", fgColor="1E293B")
HEAD_FONT = Font(bold=True, color="FFFFFF")


def _style_sheet(ws, cols, help_text):
    ws.append(cols)
    for c in ws[1]:
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.freeze_panes = "A2"
    for i, name in enumerate(cols, 1):
        w = 50 if name in ("Асуулт", "Онол текст", "Тайлбар") else 28 if name in ("Гарчиг", "Хичээлийн гарчиг", "YouTube URL", "Зураг URL", "Нэр") else 12
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w
    ws.cell(1, 1).comment = None
    if help_text:
        from openpyxl.comments import Comment
        ws.cell(1, 1).comment = Comment(help_text, "PhysLab")


def _add_validations(ws, cols):
    def col(name):
        return ws.cell(1, cols.index(name) + 1).column_letter
    if "Төрөл" in cols:
        dv = DataValidation(type="list", formula1='"mcq,numeric,truefalse"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"{col('Төрөл')}2:{col('Төрөл')}2000")
    if "Хэсэг" in cols:
        opts = '"Онол,Бодлого,Туршилт,Түвшний шалгалт"' if ws.title == S_EX else '"Онол,Бодлого,Туршилт"'
        dv = DataValidation(type="list", formula1=opts, allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"{col('Хэсэг')}2:{col('Хэсэг')}2000")


def new_workbook():
    wb = Workbook()
    wb.remove(wb.active)
    for name in (S_PLACE, S_EX, S_LESSON, S_LEVEL):
        ws = wb.create_sheet(name)
        _style_sheet(ws, COLS[name], HELP[name])
        _add_validations(ws, COLS[name])
    return wb


def template_bytes() -> bytes:
    wb = new_workbook()
    wb[S_LEVEL].append([1, "Механик", "Хөдөлгөөн, хүч", 70, "🪐", "#38bdf8"])
    wb[S_LESSON].append([1, "Онол", 1, "Хурд ба хурдатгал", "https://www.youtube.com/watch?v=XXXXXXXXXXX",
                         "Хурд: $v = s/t$", ""])
    wb[S_LESSON].append([1, "Туршилт", 1, "Дүүжингийн хэлбэлзэл", "", "Дүүжингийн үеийг хэмжинэ", "pendulum"])
    wb[S_PLACE].append([1, "mcq", "Хурдны нэгж аль нь вэ?", "кг", "м/с", "Н", "Ж", "B", "", "SI системд м/с", "", 1])
    wb[S_PLACE].append([1, "numeric", "100 м-ийг 20 с-д туулсан бол хурд хэд вэ? (м/с)", "", "", "", "", 5, 0.1, "v=s/t", "", 1])
    wb[S_PLACE].append([1, "truefalse", "Хүч нь Ньютоноор хэмжигдэнэ.", "", "", "", "", "Үнэн", "", "", "", 1])
    wb[S_EX].append([1, "Онол", "Хурд ба хурдатгал", "mcq", "Хурдатгалын нэгж?", "м/с", "м/с²", "Н", "с", "B", "", "", "", 1])
    wb[S_EX].append([1, "Түвшний шалгалт", "", "numeric", "2 м/с² хурдатгалаар 5 с явсан бол хурд? (тайван төлвөөс)", "", "", "", "", 10, 0.1, "v=at", "", 2])
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# ---------------- parse ----------------
def _s(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _sheet_rows(wb, name):
    if name not in wb.sheetnames:
        return []
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    try:
        header = [(_s(h)).lower() for h in next(it)]
    except StopIteration:
        return []
    out = []
    for i, r in enumerate(it, start=2):
        if r is None or all(v is None or _s(v) == "" for v in r):
            continue
        d = {}
        for col in COLS[name]:
            key = col.lower()
            d[col] = r[header.index(key)] if key in header and header.index(key) < len(r) else None
        out.append((i, d))
    return out


def _level_key(v) -> str:
    s = _s(v)
    m = re.match(r"^\s*(\d+)", s)
    return f"#{int(m.group(1))}" if m and s.strip().isdigit() else s.lower()


def _parse_question(d, sheet, rownum, errors):
    text = _s(d.get("Асуулт"))
    if not text:
        errors.append({"sheet": sheet, "row": rownum, "msg": "Асуулт хоосон"})
        return None
    opts = {k: _s(d.get(k)) for k in "ABCD"}
    ans = _s(d.get("Зөв хариулт"))
    t_raw = _s(d.get("Төрөл")).lower()
    qtype = TYPE_MAP.get(t_raw)
    if not t_raw:
        qtype = "mcq" if any(opts.values()) else ("numeric" if to_float(ans) is not None else "truefalse")
    if not qtype:
        errors.append({"sheet": sheet, "row": rownum, "msg": f"Төрөл буруу: '{t_raw}' (mcq/numeric/truefalse)"})
        return None
    if not ans:
        errors.append({"sheet": sheet, "row": rownum, "msg": "Зөв хариулт хоосон"})
        return None
    if qtype == "mcq":
        ans = ans.upper()
        if ans not in "ABCD" or len(ans) != 1:
            errors.append({"sheet": sheet, "row": rownum, "msg": f"mcq хариулт A-D байх ёстой: '{ans}'"})
            return None
        if not opts.get(ans):
            errors.append({"sheet": sheet, "row": rownum, "msg": f"{ans} сонголт хоосон байна"})
            return None
        if sum(1 for v in opts.values() if v) < 2:
            errors.append({"sheet": sheet, "row": rownum, "msg": "mcq-д дор хаяж 2 сонголт хэрэгтэй"})
            return None
    elif qtype == "numeric":
        if to_float(ans) is None:
            errors.append({"sheet": sheet, "row": rownum, "msg": f"numeric хариулт тоо биш: '{ans}'"})
            return None
    elif qtype == "truefalse":
        ans = norm_tf(ans)
        if ans not in ("T", "F"):
            errors.append({"sheet": sheet, "row": rownum, "msg": "Үнэн/Худал хариулт буруу"})
            return None
    tol = to_float(d.get("Алдааны хязгаар")) if _s(d.get("Алдааны хязгаар")) else None
    pts = to_float(d.get("Оноо")) if _s(d.get("Оноо")) else 1
    return {
        "qtype": qtype, "text": text, "opt_a": opts["A"], "opt_b": opts["B"], "opt_c": opts["C"], "opt_d": opts["D"],
        "answer": ans, "tolerance": tol, "explanation": _s(d.get("Тайлбар")), "image_url": _s(d.get("Зураг URL")),
        "points": int(pts or 1), "row": rownum,
    }


def parse(data: bytes) -> dict:
    try:
        wb = load_workbook(io.BytesIO(data), data_only=True)
    except Exception as e:  # noqa: BLE001
        return {"errors": [{"sheet": "-", "row": 0, "msg": f"Excel уншиж чадсангүй: {e}"}], "levels": [], "lessons": [],
                "placement": [], "exercises": []}
    errors, levels, lessons, placement, exercises = [], [], [], [], []
    known = [s for s in (S_LEVEL, S_LESSON, S_PLACE, S_EX) if s in wb.sheetnames]
    if not known:
        errors.append({"sheet": "-", "row": 0, "msg": f"'{S_PLACE}', '{S_EX}', '{S_LESSON}' sheet олдсонгүй. Template ашиглана уу."})

    for rn, d in _sheet_rows(wb, S_LEVEL):
        n = to_float(d.get("Дугаар"))
        name = _s(d.get("Нэр"))
        if n is None or not name:
            errors.append({"sheet": S_LEVEL, "row": rn, "msg": "Дугаар, Нэр заавал"})
            continue
        levels.append({"ord": int(n), "name": name, "description": _s(d.get("Тайлбар")),
                       "pass_pct": int(to_float(d.get("Тэнцэх %")) or 70), "icon": _s(d.get("Icon")) or "🪐",
                       "color": _s(d.get("Өнгө")) or "", "row": rn})

    for rn, d in _sheet_rows(wb, S_LESSON):
        lv, title = _s(d.get("Түвшин")), _s(d.get("Гарчиг"))
        sec = SECTION_MAP.get(_s(d.get("Хэсэг")).lower())
        if not lv or not title:
            errors.append({"sheet": S_LESSON, "row": rn, "msg": "Түвшин, Гарчиг заавал"})
            continue
        if sec not in ("onol", "bodlogo", "turshilt"):
            errors.append({"sheet": S_LESSON, "row": rn, "msg": "Хэсэг: Онол / Бодлого / Туршилт"})
            continue
        sim = _s(d.get("Симуляц")).lower()
        if sim not in SIMS:
            errors.append({"sheet": S_LESSON, "row": rn, "msg": f"Симуляц буруу: '{sim}' (pendulum/projectile/ohm)"})
            continue
        lessons.append({"level": lv, "section": sec, "ord": int(to_float(d.get("Дараалал")) or 1), "title": title,
                        "youtube_url": _s(d.get("YouTube URL")), "body_md": _s(d.get("Онол текст")), "sim_key": sim, "row": rn})

    for rn, d in _sheet_rows(wb, S_PLACE):
        lv = _s(d.get("Түвшин"))
        if not lv:
            errors.append({"sheet": S_PLACE, "row": rn, "msg": "Түвшин хоосон"})
            continue
        q = _parse_question(d, S_PLACE, rn, errors)
        if q:
            placement.append({**q, "level": lv})

    for rn, d in _sheet_rows(wb, S_EX):
        lv = _s(d.get("Түвшин"))
        sec = SECTION_MAP.get(_s(d.get("Хэсэг")).lower())
        title = _s(d.get("Хичээлийн гарчиг"))
        if not lv:
            errors.append({"sheet": S_EX, "row": rn, "msg": "Түвшин хоосон"})
            continue
        if not sec:
            errors.append({"sheet": S_EX, "row": rn, "msg": "Хэсэг: Онол / Бодлого / Туршилт / Түвшний шалгалт"})
            continue
        if sec != "exam" and not title:
            errors.append({"sheet": S_EX, "row": rn, "msg": "Хичээлийн гарчиг хоосон"})
            continue
        q = _parse_question(d, S_EX, rn, errors)
        if q:
            exercises.append({**q, "level": lv, "section": sec, "lesson_title": title})

    return {"errors": errors, "levels": levels, "lessons": lessons, "placement": placement, "exercises": exercises}


# ---------------- commit ----------------
def commit(parsed: dict, mode: str = "add") -> dict:
    stats = {"levels_new": 0, "lessons_new": 0, "placement": 0, "exercises": 0, "exam": 0}
    with db.tx() as con:
        if mode == "replace":
            con.execute("DELETE FROM questions")
            con.execute("DELETE FROM lessons")
        lv_cache: dict[str, int] = {}
        for lv in db.rows(con, "SELECT * FROM levels"):
            lv_cache[f"#{lv['ord']}"] = lv["id"]
            lv_cache[lv["name"].lower()] = lv["id"]

        for lv in parsed["levels"]:
            ex = db.row(con, "SELECT id FROM levels WHERE ord=?", (lv["ord"],))
            if ex:
                con.execute("UPDATE levels SET name=?, description=?, pass_pct=?, icon=?, color=COALESCE(NULLIF(?,''),color) WHERE id=?",
                            (lv["name"], lv["description"], lv["pass_pct"], lv["icon"], lv["color"], ex["id"]))
                lid = ex["id"]
            else:
                lid = con.execute("INSERT INTO levels(ord,name,description,pass_pct,icon,color) VALUES(?,?,?,?,?,COALESCE(NULLIF(?,''),'#38bdf8'))",
                                  (lv["ord"], lv["name"], lv["description"], lv["pass_pct"], lv["icon"], lv["color"])).lastrowid
                stats["levels_new"] += 1
            lv_cache[f"#{lv['ord']}"] = lid
            lv_cache[lv["name"].lower()] = lid

        def level_id(v: str) -> int:
            k = _level_key(v)
            if k in lv_cache:
                return lv_cache[k]
            m = re.match(r"^\s*(\d+)\s*[.)\-:]?\s*(.*)$", v)
            if m and f"#{int(m.group(1))}" in lv_cache:
                return lv_cache[f"#{int(m.group(1))}"]
            mx = con.execute("SELECT COALESCE(MAX(ord),0) FROM levels").fetchone()[0]
            if m:
                ordv, name = int(m.group(1)), (m.group(2) or f"Түвшин {m.group(1)}")
            else:
                ordv, name = mx + 1, v
            lid = con.execute("INSERT INTO levels(ord,name) VALUES(?,?)", (ordv, name)).lastrowid
            stats["levels_new"] += 1
            lv_cache[k] = lid
            lv_cache[f"#{ordv}"] = lid
            lv_cache[name.lower()] = lid
            return lid

        ls_cache: dict[tuple, int] = {}
        for l in db.rows(con, "SELECT * FROM lessons"):
            ls_cache[(l["level_id"], l["section"], l["title"].lower())] = l["id"]

        for l in parsed["lessons"]:
            lid = level_id(l["level"])
            key = (lid, l["section"], l["title"].lower())
            if key in ls_cache:
                con.execute("UPDATE lessons SET ord=?, youtube_url=?, body_md=?, sim_key=? WHERE id=?",
                            (l["ord"], l["youtube_url"], l["body_md"], l["sim_key"], ls_cache[key]))
            else:
                ls_cache[key] = con.execute(
                    "INSERT INTO lessons(level_id,section,ord,title,youtube_url,body_md,sim_key) VALUES(?,?,?,?,?,?,?)",
                    (lid, l["section"], l["ord"], l["title"], l["youtube_url"], l["body_md"], l["sim_key"])).lastrowid
                stats["lessons_new"] += 1

        qcols = "kind,level_id,lesson_id,section,qtype,text,opt_a,opt_b,opt_c,opt_d,answer,tolerance,explanation,image_url,points"

        def ins(kind, lvid, lsid, sec, q):
            con.execute(f"INSERT INTO questions({qcols}) VALUES({','.join('?'*15)})",
                        (kind, lvid, lsid, sec, q["qtype"], q["text"], q["opt_a"], q["opt_b"], q["opt_c"], q["opt_d"],
                         q["answer"], q["tolerance"], q["explanation"], q["image_url"], q["points"]))

        for q in parsed["placement"]:
            ins("placement", level_id(q["level"]), None, "", q)
            stats["placement"] += 1

        for q in parsed["exercises"]:
            lvid = level_id(q["level"])
            if q["section"] == "exam":
                ins("level_exam", lvid, None, "", q)
                stats["exam"] += 1
                continue
            key = (lvid, q["section"], q["lesson_title"].lower())
            if key not in ls_cache:
                mx = con.execute("SELECT COALESCE(MAX(ord),0) FROM lessons WHERE level_id=? AND section=?", (lvid, q["section"])).fetchone()[0]
                ls_cache[key] = con.execute("INSERT INTO lessons(level_id,section,ord,title) VALUES(?,?,?,?)",
                                            (lvid, q["section"], mx + 1, q["lesson_title"])).lastrowid
                stats["lessons_new"] += 1
            ins("exercise", lvid, ls_cache[key], q["section"], q)
            stats["exercises"] += 1
    return stats


# ---------------- export ----------------
def _ans_out(q):
    if q["qtype"] == "truefalse":
        return "Үнэн" if norm_tf(q["answer"]) == "T" else "Худал"
    if q["qtype"] == "numeric":
        f = to_float(q["answer"])
        return int(f) if f is not None and f.is_integer() else f
    return q["answer"]


def export_bytes() -> bytes:
    wb = new_workbook()
    with db.tx() as con:
        levels = {l["id"]: l for l in db.rows(con, "SELECT * FROM levels ORDER BY ord")}
        lessons = {l["id"]: l for l in db.rows(con, "SELECT * FROM lessons ORDER BY level_id, section, ord")}
        qs = db.rows(con, "SELECT * FROM questions ORDER BY kind, level_id, lesson_id, id")
    for l in levels.values():
        wb[S_LEVEL].append([l["ord"], l["name"], l["description"], l["pass_pct"], l["icon"], l["color"]])
    for l in lessons.values():
        wb[S_LESSON].append([levels[l["level_id"]]["ord"], SECTION_OUT.get(l["section"], l["section"]), l["ord"], l["title"],
                             l["youtube_url"], l["body_md"], l["sim_key"]])
    for q in qs:
        lvo = levels[q["level_id"]]["ord"] if q["level_id"] in levels else ""
        tail = [_ans_out(q), q["tolerance"], q["explanation"], q["image_url"], q["points"]]
        opts = [q["opt_a"], q["opt_b"], q["opt_c"], q["opt_d"]]
        if q["kind"] == "placement":
            wb[S_PLACE].append([lvo, q["qtype"], q["text"], *opts, *tail])
        elif q["kind"] == "level_exam":
            wb[S_EX].append([lvo, "Түвшний шалгалт", "", q["qtype"], q["text"], *opts, *tail])
        else:
            ls = lessons.get(q["lesson_id"])
            wb[S_EX].append([lvo, SECTION_OUT.get(q["section"], q["section"]), ls["title"] if ls else "", q["qtype"], q["text"], *opts, *tail])
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()
