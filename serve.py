#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DEMO 预览服务器：修正 .js/.mjs 的 MIME 类型，确保 ES Module 正常加载。"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

class H(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js":   "text/javascript; charset=utf-8",
        ".mjs":  "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".css":  "text/css; charset=utf-8",
        ".svg":  "image/svg+xml",
        ".webp": "image/webp",
    })

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8910
print(f"DEMO preview: http://127.0.0.1:{port}/")
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
