ROLE_USER = "user"
ROLE_ADMIN = "admin"

ADMIN_EMAILS = frozenset({"go.teamchai@gmail.com"})


def is_admin_role(role: str | None) -> bool:
    return (role or "").lower() == ROLE_ADMIN
