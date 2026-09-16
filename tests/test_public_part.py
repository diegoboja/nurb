"""Opening a part published on nurb.app, against a stand-in for it."""

import http.server
import json
import threading
import urllib.error

import pytest

from nurb import db, mcp_server, public_part

CUBE = """from nurb import *


@part
def cube(width=20.0):
    return Box(width, width, width)
"""

PUBLISHED = {
    "slug": "sturdy-cube",
    "name": "Sturdy Cube",
    "description": "A cube, for calibration.",
    "visibility": "public",
    "tags": ["calibration"],
    "published_at": "2026-09-01T00:00:00Z",
    "canonical": "https://nurb.app/p/sturdy-cube",
    "publisher": {"handle": "shop"},
    "revision": {
        "id": "rev1",
        "source": CUBE,
        "card_md": "# Sturdy Cube\n\nPrints flat.\n",
        "params": [{"name": "width", "default": 20.0}],
    },
    "measurements": [
        {"name": "shelf_width", "value": 25.16, "unit": "mm", "how": "calipers", "provisional": False}
    ],
    "build": None,
    "license": "CC-BY-4.0",
}


# What a broken or hostile nurb.app could answer instead. Every one of these used to
# reach a bare index in adopt or in the tool, which is a 500 with a traceback.
BROKEN = {
    "no-revision": {"slug": "no-revision", "revision": None},
    "no-source": {"slug": "no-source", "revision": {"id": "r1"}},
    "empty-source": {"slug": "empty-source", "revision": {"source": "  "}},
    "not-a-part": ["sturdy-cube"],
    "no-value": {
        "slug": "no-value",
        "revision": {"source": CUBE},
        "measurements": [{"name": "w", "value": None, "how": "calipers"}],
    },
    "no-how": {
        "slug": "no-how",
        "revision": {"source": CUBE},
        "measurements": [{"name": "w", "value": 3}],
    },
    "renamed": {"slug": "../../etc/passwd", "revision": {"source": CUBE}},
}


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == f"/p/{PUBLISHED['slug']}.json":
            body = json.dumps(PUBLISHED).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        for slug, payload in BROKEN.items():
            if self.path == f"/p/{slug}.json":
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        if self.path in ("/p/off-host.json", "/p/moved.json"):
            elsewhere = "http://example.invalid/p/x.json"
            here = f"/p/{PUBLISHED['slug']}.json"
            self.send_response(302)
            self.send_header("Location", elsewhere if "off-host" in self.path else here)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(404)

    def log_message(self, *args):
        pass


@pytest.fixture
def app(monkeypatch):
    """A stand-in for nurb.app, so no test reaches the real one."""
    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    monkeypatch.setenv("NURB_APP_URL", url)
    yield url
    server.shutdown()
    server.server_close()


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("NURB_HOME", str(tmp_path / "home"))
    conn = db.connect(tmp_path / "x.db")
    yield conn
    conn.close()


def test_a_slug_comes_out_of_every_shape_of_link(app):
    for src in (
        f"{app}/p/sturdy-cube",
        f"{app}/p/sturdy-cube.json",
        f"{app}/p/sturdy-cube/stl?width=30",
    ):
        assert public_part.slug_of(src) == "sturdy-cube"

    with pytest.raises(mcp_server.Refused) as foreign:
        public_part.slug_of("https://example.com/p/sturdy-cube")
    assert "/p/<slug>" in str(foreign.value)

    with pytest.raises(mcp_server.Refused):
        public_part.slug_of(f"{app}/about")


def test_fetch_answers_the_part_and_names_a_missing_one(app):
    data = public_part.fetch("sturdy-cube")
    assert data["name"] == "Sturdy Cube"
    assert data["revision"]["source"] == CUBE

    with pytest.raises(mcp_server.Refused) as missing:
        public_part.fetch("no-such-part")
    assert str(missing.value).startswith("no public part at")


def test_a_redirect_may_not_leave_the_host(app):
    with pytest.raises(mcp_server.Refused) as away:
        public_part.fetch("off-host")
    assert str(away.value) == "nurb.app redirected the part somewhere else; not following it"

    assert public_part.fetch("moved")["name"] == "Sturdy Cube"


def test_adopt_makes_a_project_with_the_part_its_card_and_its_measurements(app, conn):
    project_id, part_name = public_part.adopt(conn, public_part.fetch("sturdy-cube"))

    assert part_name == "sturdy_cube"
    assert db.get_project(conn, project_id)["name"] == "Sturdy Cube"
    part = db.parts_of(conn, project_id)[0]
    assert part["name"] == "sturdy_cube"
    assert part["source"] == CUBE
    assert part["card_md"].startswith("# Sturdy Cube")
    measurement = db.measurements_of(conn, project_id)[0]
    assert (measurement["name"], measurement["value"], measurement["unit"]) == (
        "shelf_width",
        25.16,
        "mm",
    )
    assert measurement["how"] == "calipers"


def test_the_tool_reads_the_part_without_creating_anything(app, conn):
    result = mcp_server.dispatch(conn, "get_public_part", {"slug": "sturdy-cube"}, "http://x")

    text = result.content[0].text
    assert result.is_error is False
    assert CUBE in text
    assert "Sturdy Cube" in text
    assert "CC-BY-4.0" in text and "shop" in text
    assert "shelf_width = 25.16 mm (calipers)" in text
    assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0

    missing = mcp_server.dispatch(conn, "get_public_part", {"slug": "nope"}, "http://x")
    assert missing.is_error is True
    assert "no public part at" in missing.content[0].text


def test_an_answer_that_is_not_a_part_is_a_sentence_not_a_crash(app, conn):
    for slug, says in (
        ("no-revision", "answered something that is not a part"),
        ("not-a-part", "answered something that is not a part"),
        ("no-source", "has no source to open"),
        ("empty-source", "has no source to open"),
        ("no-value", "published a measurement nurb cannot read"),
        ("no-how", "published a measurement nurb cannot read"),
    ):
        with pytest.raises(mcp_server.Refused) as refused:
            public_part.fetch(slug)
        assert says in str(refused.value)

        result = mcp_server.dispatch(conn, "get_public_part", {"slug": slug}, "http://x")
        assert result.is_error is True
        assert says in result.content[0].text

    # The slug that was asked for names the part, so a page that renames itself in the
    # answer cannot hand db.create_part something that is not a part name.
    project_id, part_name = public_part.adopt(conn, public_part.fetch("renamed"))
    assert part_name == "renamed"
    assert db.parts_of(conn, project_id)[0]["name"] == "renamed"

    with pytest.raises(mcp_server.Refused) as named:
        public_part.fetch("Sturdy Cube")
    assert "that names no part" in str(named.value)


def test_open_adopts_the_part_into_a_project_the_page_then_lists(app, tmp_path, monkeypatch):
    from test_serve import free_port, get, kill_serve, post, serving

    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("NURB_HOME", str(home))
    try:
        with serving(home, free_port()) as url:
            opened = json.loads(post(f"{url}/api/open", {"src": f"{app}/p/sturdy-cube/stl?x=1"})[2])
            assert opened["part"] == "sturdy_cube"

            listed = json.loads(get(f"{url}/api/projects")[2])["projects"]
            assert [(p["id"], p["name"], p["parts"]) for p in listed] == [
                (opened["project_id"], "Sturdy Cube", 1)
            ]
            detail = json.loads(get(f"{url}/api/projects/{opened['project_id']}")[2])
            assert detail["parts"][0]["source"] == CUBE

            with pytest.raises(urllib.error.HTTPError) as foreign:
                post(f"{url}/api/open", {"src": "https://example.com/p/sturdy-cube"})
            assert foreign.value.code == 400
            assert "is not on" in json.loads(foreign.value.read())["error"]
    finally:
        kill_serve(home)
