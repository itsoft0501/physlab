"""Нууц үг hash, session-оос хэрэглэгч авах."""
from __future__ import annotations

import bcrypt
from fastapi import HTTPException, Request

import db


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode()


def check_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), h.encode())
    except ValueError:
        return False


def current_user(request: Request) -> dict | None:
    uid = request.session.get("uid")
    if not uid:
        return None
    with db.tx() as con:
        return db.row(con, "SELECT * FROM users WHERE id=?", (uid,))


def require_user(request: Request) -> dict:
    u = current_user(request)
    if not u:
        raise HTTPException(401, "Нэвтэрнэ үү")
    return u


def require_admin(request: Request) -> dict:
    u = require_user(request)
    if u["role"] != "admin":
        raise HTTPException(403, "Зөвхөн админ")
    return u


def public_user(u: dict) -> dict:
    return {k: u[k] for k in ("id", "email", "name", "grade", "avatar", "role", "xp",
                               "streak", "current_level_id", "placed_at")}
