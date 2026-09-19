"""Real Chromium geometry checks; Telegram host events are emulated, not a device test."""
import importlib.util
import json
import os
import re
import base64
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("support", Path(__file__).with_name("top-level-runtime.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

MOCK = """
window.__tgEvents = {};
window.Telegram = { WebApp: {
 initData: '', viewportHeight: innerHeight, viewportStableHeight: innerHeight,
 safeAreaInset: {top: 24, bottom: 34, left: 0, right: 0},
 contentSafeAreaInset: {top: 56, bottom: 0, left: 0, right: 0},
 isFullscreen: true, ready() {}, expand() {},
 onEvent(name, fn) { (window.__tgEvents[name] ||= []).push(fn); }
}};
window.__tgEmit = name => window.__tgEvents[name]?.forEach(fn => fn());
"""

class LayoutHandler(S.QuietHandler):
    # Exercise the real DOM/CSS independently of auth/catalog/network startup.
    def do_GET(self):
        if not self.path.startswith('/index.html'):
            return super().do_GET()
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S)
        styles = ['telegram-profile.css', 'telegram-profile-v45.css', 'mobile-ui-fixes-v84.css', 'mobile-navigation.css', 'artist-mobile-list.css', 'mobile-polish.css', 'player-mobile-polish.css', 'mobile-polish-final.css', 'home-discovery.css', 'recommendations-hotfix-v93.css', 'album-surface.css', 'queue-sheet-v88.css']
        html = html.replace('</head>', ''.join(f'<link rel="stylesheet" href="{p}">' for p in styles) + '</head>')
        html = html.replace('</body>', '''<script type="module">
          import './js/telegram-viewport.js';
          document.documentElement.classList.toggle('mobile-device', innerWidth <= 932);
          const list = document.querySelector('#all-tracks');
          for (let i=0; i<40; i++) {
            const card = document.createElement('article'); card.className='release-card';
            card.textContent='Test track ' + i; card.style.cssText='height:64px;display:block'; list.append(card);
          }
          window.dispatchEvent(new Event('resize'));
        </script></body>''')
        data = html.encode('utf-8')
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

def wait(c, expression):
    end = time.time() + 35
    while time.time() < end:
        if c.evaluate(expression): return
        time.sleep(.1)
    raise AssertionError(expression)

def main():
    os.chdir(ROOT)
    server = S.ThreadingHTTPServer(("127.0.0.1", 0), LayoutHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="pm-telegram-") as profile:
        process = subprocess.Popen([str(S.CHROME), "--headless=new", "--disable-gpu", "--no-first-run", "--remote-allow-origins=*", f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            c = S.DevToolsSocket(S.wait_for_debugger(port))
            c.call("Page.enable"); c.call("Runtime.enable")
            mock = c.call("Page.addScriptToEvaluateOnNewDocument", {"source": MOCK})["identifier"]
            for label, width, height, touch in [("phone", 390, 844, True), ("small phone", 360, 640, True), ("Telegram Desktop narrow", 500, 720, False), ("Telegram Desktop wide", 1200, 800, False)]:
                c.call("Emulation.setDeviceMetricsOverride", {"width":width, "height":height, "deviceScaleFactor":1, "mobile":touch})
                c.call("Emulation.setTouchEmulationEnabled", {"enabled":touch})
                c.call("Page.navigate", {"url":f"http://127.0.0.1:{server.server_port}/index.html?size={width}#tgWebAppData=geometry-test"})
                wait(c, "document.querySelectorAll('#all-tracks .release-card').length > 0 && document.documentElement.style.getPropertyValue('--pm-tg-bars-height')")
                c.evaluate("document.querySelector('.mini-player').classList.add('active'); document.documentElement.style.scrollBehavior='auto'")
                time.sleep(.6)
                metrics = c.evaluate("""(() => {
                  const r = s => document.querySelector(s).getBoundingClientRect();
                  const logo = r('.logo'), p = r('.mini-player'), n = r('.mobile-bottom-navigation');
                  return {logoTop:logo.top, playerTop:p.top, playerBottom:p.bottom, navTop:n.top, navBottom:n.bottom, navHeight:n.height};
                })()""")
                assert metrics['logoTop'] >= 80, (label, metrics)
                if width <= 932:
                    assert metrics['navHeight'] > 0, (label, metrics)
                    assert metrics['playerBottom'] <= metrics['navTop'] - 4, (label, metrics)
                    assert metrics['navBottom'] <= height - 34, (label, metrics)
                c.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
                time.sleep(.3)
                last = c.evaluate("[...document.querySelectorAll('#all-tracks .release-card')].at(-1).getBoundingClientRect().bottom")
                assert last < metrics['playerTop'], (label, last, metrics)
                c.evaluate("""document.body.classList.add('mobile-search-active');
                  document.querySelector('.search-input').focus();
                  Telegram.WebApp.viewportHeight = 350; __tgEmit('viewportChanged');""")
                time.sleep(.3)
                assert c.evaluate("document.documentElement.classList.contains('telegram-keyboard-open')") == touch
                assert c.evaluate("getComputedStyle(document.querySelector('.mini-player')).visibility") == ('hidden' if touch else 'visible')
                c.evaluate("document.querySelector('.search-input').blur(); Telegram.WebApp.viewportHeight=innerHeight; __tgEmit('viewportChanged')")
                wait(c, "!document.documentElement.classList.contains('telegram-keyboard-open')")
                # A host safe-area update must move the header immediately.
                c.evaluate("window.scrollTo(0,0); Telegram.WebApp.safeAreaInset.top=0; Telegram.WebApp.contentSafeAreaInset.top=32; __tgEmit('safeAreaChanged')")
                time.sleep(.3)
                assert c.evaluate("parseFloat(getComputedStyle(document.querySelector('.header')).paddingTop)") == (36 if width <= 932 else 52)
                c.evaluate("document.querySelector('.fullscreen-player').classList.add('open')")
                time.sleep(.4)
                assert c.evaluate("document.querySelector('.fullscreen-player').getBoundingClientRect().height") == height
                c.evaluate("document.querySelector('.fullscreen-player').classList.remove('open')")
                print('PASS', label, json.dumps(metrics))
                shot = c.call('Page.captureScreenshot', {'format':'png'})['data']
                (Path(tempfile.gettempdir()) / ('pm-' + label.replace(' ', '-') + '.png')).write_bytes(base64.b64decode(shot))
            c.call("Page.removeScriptToEvaluateOnNewDocument", {"identifier":mock})
            c.call("Page.navigate", {"url":f"http://127.0.0.1:{server.server_port}/index.html"})
            wait(c, "document.querySelectorAll('#all-tracks .release-card').length > 0")
            assert c.evaluate("document.documentElement.dataset.telegramViewport || null") is None
            assert c.evaluate("parseFloat(getComputedStyle(document.querySelector('.header')).paddingTop)") == 20
            print('PASS regular desktop unchanged')
            # Real vendored SDK path, then native host events through its bridge.
            c.call('Page.navigate', {'url':f'http://127.0.0.1:{server.server_port}/index.html?sdk=1#tgWebAppData=geometry-test&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop'})
            wait(c, "Boolean(window.Telegram?.WebApp)")
            c.evaluate("Telegram.WebView.receiveEvent('safe_area_changed', {top:24,bottom:34}); Telegram.WebView.receiveEvent('content_safe_area_changed', {top:56});")
            time.sleep(.3)
            assert c.evaluate("parseFloat(getComputedStyle(document.querySelector('.header')).paddingTop)") == 100
            print('PASS vendored SDK native safe-area events')
        finally:
            process.terminate(); process.wait(timeout=10); server.shutdown()

if __name__ == '__main__': main()
