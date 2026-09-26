"""Minimal stdlib web app on port 8080 (no dependencies)."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>CodingFleet demo</title>
<style>
  body {{ margin:0; height:100vh; display:grid; place-items:center;
         font:16px/1.5 system-ui, sans-serif; background:#0b0f17; color:#e6edf3; }}
  .card {{ padding:2.5rem 3rem; border:1px solid #23303f; border-radius:14px;
           background:#111823; box-shadow:0 18px 40px rgba(0,0,0,.45); text-align:center; }}
  h1 {{ margin:0 0 .5rem; font-size:1.4rem; }}
  code {{ color:#7ee787; }}
</style></head>
<body><div class="card">
  <h1>Hello from Python 🐍</h1>
  <p>Running on <code>http://localhost:8080</code></p>
  <p>Served at {now}</p>
</div></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_error(404, "Not found")
            return
        body = PAGE.format(now=datetime.now().strftime("%Y-%m-%d %H:%M:%S")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quieter logs
        print(f"{self.address_string()} - {fmt % args}", flush=True)


if __name__ == "__main__":
    print("serving on http://localhost:8080", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
