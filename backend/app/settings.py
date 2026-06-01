from __future__ import annotations

import os


def get_allowed_origins() -> list[str]:
    configured = os.getenv("FRONTEND_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://localhost:5173"]
