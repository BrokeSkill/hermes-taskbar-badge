#!/usr/bin/env python3
import ctypes
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8766
HOST = '127.0.0.1'
STATE = {'state': 0, 'color': '#3fb950', 'label': 'completed'}
LOCK = threading.Lock()
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'badge_bridge.log')

LAST_LOG = [None]

def log_change(key, message):
    if LAST_LOG[0] != key:
        LAST_LOG[0] = key
        with open(LOG, 'a', encoding='utf-8') as handle:
            handle.write('%s %s\n' % (time.strftime('%H:%M:%S'), message))


if sys.platform == 'win32':
    from ctypes import wintypes

    ole32 = ctypes.WinDLL('ole32')
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    gdi32 = ctypes.WinDLL('gdi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

    class GUID(ctypes.Structure):
        _fields_ = [('Data1', wintypes.DWORD), ('Data2', wintypes.WORD),
                    ('Data3', wintypes.WORD), ('Data4', ctypes.c_ubyte * 8)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [('biSize', wintypes.DWORD), ('biWidth', ctypes.c_long),
                    ('biHeight', ctypes.c_long), ('biPlanes', wintypes.WORD),
                    ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                    ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', ctypes.c_long),
                    ('biYPelsPerMeter', ctypes.c_long), ('biClrUsed', wintypes.DWORD),
                    ('biClrImportant', wintypes.DWORD)]

    class ICONINFO(ctypes.Structure):
        _fields_ = [('fIcon', wintypes.BOOL), ('xHotspot', wintypes.DWORD),
                    ('yHotspot', wintypes.DWORD), ('hbmMask', ctypes.c_void_p),
                    ('hbmColor', ctypes.c_void_p)]

    CLSID = GUID()
    IID = GUID()
    ole32.CLSIDFromString(ctypes.c_wchar_p('{56FDF344-FD6D-11d0-958A-006097C9A090}'), ctypes.byref(CLSID))
    ole32.CLSIDFromString(ctypes.c_wchar_p('{EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF}'), ctypes.byref(IID))

    def _com():
        ole32.CoInitialize(None)
        ptr = ctypes.c_void_p()
        hr = ole32.CoCreateInstance(ctypes.byref(CLSID), None, 1, ctypes.byref(IID), ctypes.byref(ptr))
        if hr != 0:
            raise OSError('CoCreateInstance failed: 0x%08x' % hr)
        vtbl = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents

        def call(index, *types):
            return ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *types)(vtbl[index])

        call(3)(ptr)
        return ptr, call

    TASKBAR, TASKBAR_CALL = _com()
    SET_OVERLAY = TASKBAR_CALL(18, wintypes.HWND, ctypes.c_void_p, ctypes.c_wchar_p)

    def window_pid(hwnd):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value

    def process_name(pid):
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return ''
        try:
            size = wintypes.DWORD(1024)
            buf = ctypes.create_unicode_buffer(1024)
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return buf.value.rsplit('\\', 1)[-1]
            return ''
        finally:
            kernel32.CloseHandle(handle)

    def find_window():
        found = []

        def visit(hwnd, _):
            if not user32.IsWindowVisible(hwnd):
                return True
            if not process_name(window_pid(hwnd)).lower().startswith('hermes'):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            found.append(((rect.right - rect.left) * (rect.bottom - rect.top), hwnd))
            return True

        user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(visit), 0)
        return max(found)[1] if found else None

    user32.CreateIconIndirect.restype = ctypes.c_void_p

    def make_icon(rgb, state):
        r, g, b = (int(rgb[i:i + 2], 16) for i in (1, 3, 5))
        hdc = user32.GetDC(None)
        bmi = BITMAPINFOHEADER(wintypes.DWORD(ctypes.sizeof(BITMAPINFOHEADER)), 16, -16, 1, 32, 0, 0, 0, 0, 0, 0)
        bits = ctypes.c_void_p()
        color = gdi32.CreateDIBSection(hdc, ctypes.byref(bmi), 0, ctypes.byref(bits), None, 0)
        pixels = (ctypes.c_ubyte * (16 * 16 * 4)).from_address(bits.value)
        mask = bytearray(32)
        for y in range(16):
            for x in range(16):
                dx, dy = x - 7.5, y - 7.5
                d = (dx * dx + dy * dy) ** 0.5
                if state == 3:      # upward triangle for failed
                    def side(px, py, x1, y1, x2, y2):
                        return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
                    s = (side(dx, dy, 0.0, -7.2, -7.6, 5.9),
                         side(dx, dy, -7.6, 5.9, 7.6, 5.9),
                         side(dx, dy, 7.6, 5.9, 0.0, -7.2))
                    alpha = 1.0 if min(s) >= 0 or max(s) <= 0 else 0.0
                elif state == 2:    # hollow ring for needs input
                    alpha = max(0.0, min(1.0, min(7.4 - d, d - 4.4)))
                else:               # disc for a finished turn
                    alpha = max(0.0, min(1.0, 7.4 - d))
                i = (y * 16 + x) * 4
                if alpha > 0:
                    pixels[i:i + 4] = bytes((b, g, r, int(alpha * 255)))
                else:
                    pixels[i:i + 4] = bytes((0, 0, 0, 0))
                    mask[y * 2 + x // 8] |= 0x80 >> (x % 8)
        mask_bitmap = gdi32.CreateBitmap(16, 16, 1, 1, (ctypes.c_ubyte * 32)(*mask))
        info = ICONINFO(1, 0, 0, mask_bitmap, color)
        icon = user32.CreateIconIndirect(ctypes.byref(info))
        gdi32.DeleteObject(mask_bitmap)
        gdi32.DeleteObject(color)
        user32.ReleaseDC(None, hdc)
        return icon

    ICONS = {}

    def apply(state, color, label):
        hwnd = find_window()
        if not hwnd:
            log_change('no-window', 'no window')
            return False
        if not state:
            hr = SET_OVERLAY(TASKBAR, hwnd, None, None)
            log_change(('clear', hwnd), 'clear hwnd=%s hr=0x%08x' % (hwnd, hr & 0xFFFFFFFF))
            return True
        icon = ICONS.get((state, color))
        if icon is None:
            icon = ICONS[(state, color)] = make_icon(color, state)
        hr = SET_OVERLAY(TASKBAR, hwnd, icon, label)
        log_change((state, color, hwnd, hr), 'set state=%d color=%s hwnd=%s hr=0x%08x' % (state, color, hwnd, hr & 0xFFFFFFFF))
        return True


elif sys.platform.startswith('linux'):
    LAUNCHER_ID = os.environ.get('HERMES_LAUNCHER_ID', 'hermes.desktop')

    def apply(state, color, label):
        if not shutil.which('gdbus'):
            return False
        payload = ("{'application-id': <'%s'>, 'count': <int64 %d>, 'urgent': <%s>}"
                   % (LAUNCHER_ID, 1 if state else 0, 'true' if state == 2 else 'false'))
        try:
            subprocess.run(['gdbus', 'emit', '--session',
                            '--object-path', '/com/canonical/Unity/LauncherEntry',
                            '--signal', 'com.canonical.Unity.LauncherEntry.Update', payload],
                           check=False, timeout=5, capture_output=True)
            return True
        except (OSError, subprocess.SubprocessError):
            return False

else:
    def apply(state, color, label):
        return False


def loop():
    last = None
    while True:
        with LOCK:
            state, color, label = STATE['state'], STATE['color'], STATE['label']
        try:
            if state and (state, color, label) != last:
                apply(state, color, label)
                last = (state, color, label)
            elif state:
                apply(state, color, label)
            elif last is not None:
                apply(0, color, label)
                last = None
        except Exception:
            LAST_LOG[0] = None
            log_change('error', traceback.format_exc())
        time.sleep(1)

class Handler(BaseHTTPRequestHandler):
    def _done(self, code, body=b''):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        with LOCK:
            self._done(200, json.dumps(STATE).encode())

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            data = json.loads(self.rfile.read(length) or b'{}')
            state = int(data.get('state', 0))
            color = str(data.get('color') or '#3fb950')
            if state not in (0, 1, 2, 3):
                raise ValueError('state must be 0..3')
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
                raise ValueError('color must be #rrggbb')
        except (ValueError, TypeError) as error:
            self._done(400, str(error).encode())
            return
        with LOCK:
            STATE.update(state=state, color=color, label=str(data.get('label') or '')[:64])
        self._done(204)

    def log_message(self, format, *args):
        pass

def start():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        return False
    threading.Thread(target=loop, name='taskbar-badge-apply', daemon=True).start()
    threading.Thread(target=server.serve_forever, name='taskbar-badge-http', daemon=True).start()
    return True

if __name__ == '__main__':
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    print('badge bridge on http://%s:%d (took port: %s)' % (HOST, PORT, start()), flush=True)
    try:
        threading.Event().wait()
    finally:
        apply(0, '#000000', '')
