"""Local dev only: serves the static web export and forwards /api/* to the local API."""
import http.server
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "web" / "out"
API = "http://127.0.0.1:8000"


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(OUT), **k)

    def _proxy(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) or None
        req = urllib.request.Request(API + self.path, data=body, method=self.command)
        if "Content-Type" in self.headers:
            req.add_header("Content-Type", self.headers["Content-Type"])
        try:
            r = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            r = e
        data = r.read()
        self.send_response(r.status if hasattr(r, "status") else r.code)
        self.send_header("Content-Type", r.headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._proxy() if self.path.startswith("/api/") else super().do_GET()

    do_POST = do_PUT = do_DELETE = do_PATCH = _proxy


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 3000), H).serve_forever()
