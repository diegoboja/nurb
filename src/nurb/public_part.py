"""A part published on nurb.app, read back into a local project.

One direction only: this fetches a public page's JSON and adopts it. Publishing goes
the other way and is not here yet.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from . import __version__, db
from .mcp_server import Refused

# A published slug: what nurb-app puts after /p/.
SLUG = re.compile(r"^[a-z0-9-]+\Z")
TIMEOUT = 10


def base():
    """Where the public pages live. Read at call time so a test can stand one up."""
    return os.environ.get("NURB_APP_URL", "https://nurb.app")


def slug_of(src):
    """The slug in a `nurb://open?src=<url>` link.

    The page's own Open in nurb link carries the STL download URL, query string and
    all, so the slug is the first path step after /p/ rather than the last step of the
    path.
    """
    link = urllib.parse.urlsplit(str(src or "").strip())
    home = urllib.parse.urlsplit(base())
    expected = f"{base()}/p/<slug>"
    if link.netloc != home.netloc:
        raise Refused(f"that link is not on {home.netloc}: a part link looks like {expected}")
    steps = [step for step in link.path.split("/") if step]
    slug = steps[1].removesuffix(".json") if len(steps) > 1 and steps[0] == "p" else ""
    if not SLUG.match(slug):
        raise Refused(f"that link names no part: a part link looks like {expected}")
    return slug


class _SameHost(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only while it stays on the host the part came from.

    An open redirect there would otherwise hand back someone else's JSON, and that
    JSON becomes Python in the project. Refusing returns None, which urllib reports
    as an HTTPError carrying the redirect's own status.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).netloc != urllib.parse.urlsplit(base()).netloc:
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _measured(entry):
    """A measurement nurb can store: a name, a number, and how it was taken."""
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("name"), str)
        and isinstance(entry.get("value"), (int, float))
        and not isinstance(entry.get("value"), bool)
        and isinstance(entry.get("how"), str)
    )


def fetch(slug):
    """The published part as nurb-app serves it.

    The answer is checked here rather than where it is read: nurb.app is another
    process, and a field it left out would otherwise surface as a traceback in
    whichever caller indexed it first.
    """
    if not SLUG.match(str(slug)):
        raise Refused(f"that names no part: a part link looks like {base()}/p/<slug>")
    url = f"{base()}/p/{slug}.json"
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": f"nurb/{__version__}"},
    )
    try:
        with urllib.request.build_opener(_SameHost).open(request, timeout=TIMEOUT) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code in (301, 302, 303, 307, 308):
            raise Refused("nurb.app redirected the part somewhere else; not following it") from None
        if exc.code == 404:
            raise Refused(
                f"no public part at {urllib.parse.urlsplit(base()).netloc}/p/{slug}"
            ) from None
        raise Refused(f"{base()} answered {exc.code} for {slug}; try the link again later") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise Refused(f"could not read {url}: {exc}") from None
    if not isinstance(data, dict) or not isinstance(data.get("revision"), dict):
        raise Refused(f"{url} answered something that is not a part")
    if not str(data["revision"].get("source") or "").strip():
        raise Refused(f"{slug} has no source to open; its owner published no revision")
    for entry in data.get("measurements") or []:
        if not _measured(entry):
            raise Refused(f"{slug} published a measurement nurb cannot read")
    # The slug that was asked for names the part, whatever the answer calls itself.
    data["slug"] = slug
    return data


def part_name_of(slug):
    """The slug as a part name: a slug may carry hyphens and a module name may not."""
    name = slug.replace("-", "_")
    return name if db.PART_NAME.match(name) else f"part_{name}"


def adopt(conn, data):
    """Take the published part into a project of its own. Returns (project_id, name).

    No build here: the first look at the part builds it.
    """
    revision = data["revision"]
    part_name = part_name_of(data["slug"])
    with db.transaction(conn):
        project_id = db.create_project(conn, str(data.get("name") or "").strip() or data["slug"])
        db.create_part(
            conn,
            project_id,
            part_name,
            revision["source"],
            card_md=revision.get("card_md"),
        )
        for measurement in data.get("measurements") or []:
            db.set_measurement(
                conn,
                project_id,
                measurement["name"],
                measurement["value"],
                measurement["how"],
                unit=measurement.get("unit") or "mm",
                provisional=bool(measurement.get("provisional")),
            )
    return project_id, part_name
