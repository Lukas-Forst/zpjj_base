from datetime import date, timedelta

from tests.test_calsync import FakeCalendar

D = (date.today() + timedelta(days=3)).isoformat()


def add_vac(client, h):
    return client.post("/api/vacations", headers=h, json={"start_date": D, "end_date": D})


def test_disabled_without_configuration(client, add_user, as_user):
    add_user("t@example.com", name="Tim")
    h = as_user("t@example.com")
    r = client.get("/api/sync-status", headers=h).json()
    assert r["enabled"] is False and r["ok"] is True
    assert add_vac(client, h).status_code == 201


def test_vacation_write_syncs_to_calendar(app, client, add_user, as_user):
    add_user("t@example.com", name="Tim")
    h = as_user("t@example.com")
    app.state.calendar_client = fake = FakeCalendar()
    assert add_vac(client, h).status_code == 201
    assert [e.title for e in fake.events.values()] == ["Tim Urlaub"]
    s = client.get("/api/sync-status", headers=h).json()
    assert s["enabled"] and s["ok"] and s["last_ok_at"] and s["error_since"] is None


def test_calendar_failure_flags_but_request_succeeds(app, client, add_user, as_user):
    add_user("t@example.com", name="Tim")
    h = as_user("t@example.com")
    app.state.calendar_client = fake = FakeCalendar()
    fake.fail_list = True
    assert add_vac(client, h).status_code == 201
    s = client.get("/api/sync-status", headers=h).json()
    assert s["enabled"] and s["ok"] is False and s["error_since"]
