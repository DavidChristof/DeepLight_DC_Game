#!/usr/bin/env python3
"""本地开发服务器（禁用缓存）

为什么不用 `python -m http.server`：
    ES Modules 会被浏览器「启发式缓存」住，改了 js 文件刷新也不生效。
    本脚本为所有响应加上 no-store，保证每次刷新都拿到最新代码。

用法：
    python serve.py [端口]      # 默认 8000
"""
import functools
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


# 音频/图片：显式声明 MIME（有些扩展名不在 Python 默认表里，浏览器会当二进制拒收）
NoCacheHandler.extensions_map.update({
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg",
    ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
    ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
})


# —— 多线程服务器 ——
# 【为什么不是单线程 TCPServer】实测过：单线程时一个没读完的 keep-alive 连接
#   （浏览器刷新/多个模块并发请求很常见）会把整个服务器	挂住 —— 之后所有请求全部超时，
#   表现为“服务器莫名没了”但其实进程还在、端口还在 LISTEN。
#   多线程：一个连接一个线程，互不阻塞；daemon_threads 让 Ctrl+C 能干净退出。
class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


handler = functools.partial(NoCacheHandler, directory=".")

with ThreadingServer(("", PORT), handler) as httpd:
    print(f"开发服务器（多线程·禁用缓存）: http://localhost:{PORT}")
    httpd.serve_forever()
