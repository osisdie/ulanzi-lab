// Minimal user32/dwm bindings via koffi (N-API, prebuilt; works on Ulanzi's bundled Node 20).
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
const HWND = koffi.pointer('HWND', koffi.opaque());

const fn = {
  SetProcessDpiAwarenessContext: user32.func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t value)'),
  GetForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
  SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(HWND hWnd)'),
  BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(HWND hWnd)'),
  GetWindowRect: user32.func('bool __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)'),
  SetWindowPos: user32.func('bool __stdcall SetWindowPos(HWND hWnd, HWND after, int X, int Y, int cx, int cy, uint32 flags)'),
  ShowWindow: user32.func('bool __stdcall ShowWindow(HWND hWnd, int cmd)'),
  IsZoomed: user32.func('bool __stdcall IsZoomed(HWND hWnd)'),
  IsIconic: user32.func('bool __stdcall IsIconic(HWND hWnd)'),
  IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(HWND hWnd)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hWnd, int index)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hWnd, _Out_ uint8_t *buf, int max)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hWnd, _Out_ uint8_t *buf, int max)'),
  GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32 *pid)'),
  GetAncestor: user32.func('HWND __stdcall GetAncestor(HWND hWnd, uint32 flags)'),
  MonitorFromWindow: user32.func('void * __stdcall MonitorFromWindow(HWND hWnd, uint32 flags)'),
  GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(void *hMon, _Inout_ MONITORINFO *mi)'),
  keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'),
  OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
  CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
  QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)'),
  DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hWnd, uint32 attr, _Out_ uint8_t *buf, uint32 size)'),
};
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hWnd, intptr_t lParam)');
const MonitorEnumProc = koffi.proto('bool __stdcall MonitorEnumProc(void *hMon, void *hdc, RECT *rc, intptr_t lParam)');
fn.EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
fn.EnumDisplayMonitors = user32.func('bool __stdcall EnumDisplayMonitors(void *hdc, void *clip, MonitorEnumProc *cb, intptr_t lParam)');

// Real pixel coordinates on mixed-DPI setups.
try { fn.SetProcessDpiAwarenessContext(-4); } catch { /* older Windows */ }

const SW_RESTORE = 9, SW_MAXIMIZE = 3;
const SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;
const GWL_STYLE = -16, GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, WS_CAPTION = 0x00C00000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

const utf16 = (buf, n) => buf.subarray(0, n * 2).toString('utf16le');
const rectObj = (r) => ({ x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top });

export function windowText(h) { const b = Buffer.alloc(1024); return utf16(b, fn.GetWindowTextW(h, b, 512)); }
export function className(h) { const b = Buffer.alloc(512); return utf16(b, fn.GetClassNameW(h, b, 256)); }

export function processPath(h) {
  const pid = [0];
  fn.GetWindowThreadProcessId(h, pid);
  const hp = fn.OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid[0]);
  if (!hp) return { pid: pid[0], exe: '' };
  try {
    const b = Buffer.alloc(2048), size = [1024];
    const ok = fn.QueryFullProcessImageNameW(hp, 0, b, size);
    return { pid: pid[0], exe: ok ? utf16(b, size[0]) : '' };
  } finally { fn.CloseHandle(hp); }
}

function isCloaked(h) {
  const b = Buffer.alloc(4);
  return fn.DwmGetWindowAttribute(h, DWMWA_CLOAKED, b, 4) === 0 && b.readUInt32LE(0) !== 0;
}

/** Visible, user-facing top-level windows in z-order (front first). */
export function listWindows({ includeMinimized = false } = {}) {
  const out = [];
  const cb = koffi.register((h) => {
    try {
      if (!fn.IsWindowVisible(h) || isCloaked(h)) return true;
      if (!includeMinimized && fn.IsIconic(h)) return true;
      const ex = Number(fn.GetWindowLongPtrW(h, GWL_EXSTYLE));
      if (ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) return true;
      const title = windowText(h);
      if (!title) return true;
      const cls = className(h);
      if (SKIP_CLASSES.has(cls)) return true;
      const { pid, exe } = processPath(h);
      out.push({ hwnd: h, title, cls, pid, exe, exeName: exe.split('\\').pop() || '', minimized: fn.IsIconic(h) });
    } catch { /* skip */ }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try { fn.EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return out;
}

export function foreground() {
  const h = fn.GetForegroundWindow();
  return h ? { hwnd: h, title: windowText(h), cls: className(h), ...processPath(h) } : null;
}

export function workAreaOf(h) {
  const mon = fn.MonitorFromWindow(h, 2 /* NEAREST */);
  const mi = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
  fn.GetMonitorInfoW(mon, mi);
  return { mon, work: rectObj(mi.rcWork), full: rectObj(mi.rcMonitor) };
}

export function monitors() {
  const out = [];
  const cb = koffi.register((hMon) => {
    const mi = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
    fn.GetMonitorInfoW(hMon, mi);
    out.push({ mon: hMon, work: rectObj(mi.rcWork), full: rectObj(mi.rcMonitor), primary: !!(mi.dwFlags & 1) });
    return true;
  }, koffi.pointer(MonitorEnumProc));
  try { fn.EnumDisplayMonitors(null, null, cb, 0); } finally { koffi.unregister(cb); }
  return out.sort((a, b) => a.full.x - b.full.x || a.full.y - b.full.y);
}

export function getRect(h) {
  const r = {};
  fn.GetWindowRect(h, r);
  return rectObj(r);
}

/** Invisible resize borders (Win10/11) so snapped windows sit flush. */
function frameInsets(h) {
  const outer = getRect(h);
  const b = Buffer.alloc(16);
  if (fn.DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, b, 16) !== 0) return { l: 0, t: 0, r: 0, b: 0 };
  const vis = { left: b.readInt32LE(0), top: b.readInt32LE(4), right: b.readInt32LE(8), bottom: b.readInt32LE(12) };
  return { l: vis.left - outer.x, t: vis.top - outer.y, r: outer.x + outer.w - vis.right, b: outer.y + outer.h - vis.bottom };
}

/** Place a window so its *visible* frame fills `rect` ({x,y,w,h} in screen px). */
export function place(h, rect) {
  if (fn.IsZoomed(h) || fn.IsIconic(h)) fn.ShowWindow(h, SW_RESTORE);
  const i = frameInsets(h);
  return fn.SetWindowPos(h, null, Math.round(rect.x - i.l), Math.round(rect.y - i.t),
    Math.round(rect.w + i.l + i.r), Math.round(rect.h + i.t + i.b), SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}

/** Stable string id for a window handle. */
export const hwndKey = (h) => String(koffi.address(h));

export function maximize(h) { return fn.ShowWindow(h, SW_MAXIMIZE); }
export function restore(h) { return fn.ShowWindow(h, SW_RESTORE); }
export function isMaximized(h) { return fn.IsZoomed(h); }
export function isResizable(h) { return (Number(fn.GetWindowLongPtrW(h, GWL_STYLE)) & WS_CAPTION) !== 0; }

/**
 * Bring a window to the front. Background processes are normally blocked by the
 * foreground lock; a synthetic ALT tap is the standard, documented-in-practice workaround.
 */
export function activate(h) {
  if (fn.IsIconic(h)) fn.ShowWindow(h, SW_RESTORE);
  fn.keybd_event(0x12, 0, 0, 0);
  fn.keybd_event(0x12, 0, 2, 0);
  fn.BringWindowToTop(h);
  return fn.SetForegroundWindow(h);
}
