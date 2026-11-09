#!/usr/bin/env python3
"""Einfacher Dev-Server ohne Browser-Cache (damit das iPhone immer die neueste Version lädt)."""
import http.server
import sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()
