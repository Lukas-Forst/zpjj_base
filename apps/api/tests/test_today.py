from app import trello

DESC = """Montag

Einführung Straight Jacket

Wiederholung + Ergänzung Rear Bodylock

Dienstag

Einführung Straight Jacket

Mittwoch

Go Behinds aus Turtle & Back Takes

Freitag

Gi: Bow & Arrow

Sonntag

Anfängerkurs

Folgewoche: Fokus Guillotinen aus der Turtle
"""


def test_parse_week():
    r = trello.parse_week(DESC)
    assert r["days"][0]["topics"] == ["Einführung Straight Jacket",
                                      "Wiederholung + Ergänzung Rear Bodylock"]
    assert r["days"][3]["topics"] == []  # Donnerstag fehlt
    assert r["days"][6]["topics"] == ["Anfängerkurs"]
    assert r["next_week"] == "Fokus Guillotinen aus der Turtle"


def test_find_card_only_in_technik():
    lists = [{"name": "Archiv", "cards": [{"name": "Woche 45", "desc": "x"}]},
             {"name": "Technik", "cards": [{"name": "Woche 44", "desc": "a"},
                                           {"name": "Woche 45 (Gi)", "desc": "b"}]}]
    assert trello.find_card(lists, 45)["desc"] == "b"
    assert trello.find_card(lists, 46) is None


def test_endpoint(app, client, add_user, as_user):
    add_user("t@example.com")
    h = as_user("t@example.com")
    assert client.get("/api/today", headers=h).json()["status"] == "unconfigured"

    s = app.state.settings
    object.__setattr__(s, "trello_key", "k")
    object.__setattr__(s, "trello_token", "t")
    object.__setattr__(s, "trello_board", "b")
    trello._cache.clear()
    wk = trello.date.today().isocalendar().week
    app.state.trello_fetch = lambda: [{"name": "Technik",
                                       "cards": [{"name": f"Woche {wk}", "desc": DESC}]}]
    r = client.get("/api/today", headers=h).json()
    assert r["status"] == "ok" and len(r["days"]) == 7 and r["next_week"]

    trello._cache.clear()
    app.state.trello_fetch = lambda: []
    assert client.get("/api/today", headers=h).json()["status"] == "no_card"
    assert client.get("/api/today").status_code in (401, 403)


def test_parse_week_markdown_bold_headers():
    r = trello.parse_week("**Montag**\nStraight Jacket, 4 Point\n\n**Donnerstag**\n"
                          "_Tim vertritt Nico_ Straight Jacket\n\n**Freitag**\nA\nGi: B\n"
                          "\n**Folgewoche:** Fokus Turtle")
    assert r["days"][0]["topics"] == ["Straight Jacket, 4 Point"]
    assert r["days"][3]["topics"] == ["Tim vertritt Nico Straight Jacket"]
    assert r["days"][4]["topics"] == ["A", "Gi: B"]
    assert r["next_week"] == "Fokus Turtle"


def test_clean_md():
    assert trello.clean_md("**Back Control**\n\n- Straight Jacket\n- Control") == \
        "Back Control\n\n• Straight Jacket\n• Control"
    assert trello.clean_md("_Tim vertritt Nico_ Straight Jacket") == "Tim vertritt Nico Straight Jacket"
    assert trello.clean_md("foo_bar_baz") == "foo_bar_baz"


def test_month_theme_in_week_data():
    from datetime import date
    trello._cache.clear()
    lists = [{"name": "Technik", "cards": [
        {"name": "Themen November", "desc": "**Rear Bodylock**\n- Throws"},
        {"name": "Woche 46", "desc": "**Montag**\n_Tim_ A"}]}]
    r = trello.week_data(lambda: lists, date(2026, 11, 9))
    assert r["month_theme"] == "Rear Bodylock\n• Throws"
    assert r["days"][0]["topics"] == ["Tim A"]
    trello._cache.clear()
    r = trello.week_data(lambda: lists, date(2026, 12, 7))  # no December card
    assert r["month_theme"] is None
