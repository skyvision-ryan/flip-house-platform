"""Project creation instants. Legacy naive timestamps have unknown timezone, not inferred."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

BUSINESS_ZONE = ZoneInfo('America/Los_Angeles')


def created_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def creation_instant(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        instant = datetime.fromisoformat(value)
    except ValueError:
        return None
    return instant if instant.tzinfo is not None and instant.utcoffset() is not None else None


def is_new_today(value: str | None, now: datetime | None = None) -> bool:
    instant = creation_instant(value)
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        raise ValueError('The comparison clock must have an explicit timezone')
    return instant is not None and instant.astimezone(BUSINESS_ZONE).date() == clock.astimezone(BUSINESS_ZONE).date()


def prioritize_new(projects, now: datetime | None = None):
    clock = now or datetime.now(timezone.utc)
    today = [p for p in projects if is_new_today(p.created_at, clock)]
    today.sort(key=lambda p: (creation_instant(p.created_at).timestamp(), p.id), reverse=True)
    return today + [p for p in projects if not is_new_today(p.created_at, clock)]
