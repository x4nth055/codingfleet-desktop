// The Windows side of the computer tool: mouse and keyboard through SendInput,
// windows through user32, and what is on screen through UI Automation.
//
// One PowerShell process loads this once (compiled to a DLL the first time,
// see win.js) and answers one JSON request per line on stdin with one JSON
// line on stdout. Coordinates in and out are physical screen pixels: the
// thread is made per-monitor DPI aware before each request, so a click lands
// where a 150% display really has that pixel, and UI Automation reports bounds
// in the same pixels.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace CodingFleet
{
    public static class Computer
    {
        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
        delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint MOVE = 0x1, LEFTDOWN = 0x2, LEFTUP = 0x4, RIGHTDOWN = 0x8, RIGHTUP = 0x10,
            MIDDLEDOWN = 0x20, MIDDLEUP = 0x40, WHEEL = 0x800, HWHEEL = 0x1000;
        const uint KEY_EXTENDED = 0x1, KEY_UP = 0x2, KEY_UNICODE = 0x4;
        const ushort VK_RETURN = 0x0D, VK_TAB = 0x09, VK_MENU = 0x12;
        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, and _PER_MONITOR_AWARE for
        // Windows 10 before 1703.
        static readonly IntPtr PER_MONITOR_V2 = new IntPtr(-4), PER_MONITOR = new IntPtr(-3);

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly int InputSize = Marshal.SizeOf(typeof(INPUT));

        public static void Start()
        {
            Aware();
        }

        static void Aware()
        {
            try
            {
                if (SetThreadDpiAwarenessContext(PER_MONITOR_V2) == IntPtr.Zero) SetThreadDpiAwarenessContext(PER_MONITOR);
            }
            catch (EntryPointNotFoundException)
            {
                SetProcessDPIAware();
            }
        }

        /// One request line in, one answer line out. Never throws.
        public static string Handle(string line)
        {
            object id = null;
            try
            {
                var request = Json.Deserialize<Dictionary<string, object>>(line);
                request.TryGetValue("id", out id);
                Aware();
                object result = Dispatch(request);
                return Json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "result", result } });
            }
            catch (Exception err)
            {
                return Json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", err.Message } });
            }
        }

        static object Dispatch(Dictionary<string, object> r)
        {
            switch (Str(r, "op"))
            {
                case "ping": return "pong";
                // For the tests: a request that takes this long to answer.
                case "sleep": Thread.Sleep(Math.Min(Int(r, "ms"), 10000)); return null;
                case "cursor": { POINT p; GetCursorPos(out p); return new[] { p.X, p.Y }; }
                case "move": MoveTo(Int(r, "x"), Int(r, "y")); return null;
                case "click": Click(Int(r, "x"), Int(r, "y"), Str(r, "button") ?? "left", Math.Max(1, Int(r, "count", 1))); return null;
                case "drag": Drag(Points(r["path"])); return null;
                case "scroll": Scroll(Int(r, "x"), Int(r, "y"), Int(r, "dx"), Int(r, "dy")); return null;
                case "type": TypeText(Str(r, "text") ?? ""); return null;
                case "keys": PressKeys((ArrayList)r["combos"]); return null;
                case "foreground": return WindowInfo(GetForegroundWindow());
                case "windows": return Windows();
                case "focus": return Focus(new IntPtr(Long(r, "hwnd")));
                case "elements": return Elements(r.ContainsKey("hwnd") && r["hwnd"] != null ? new IntPtr(Long(r, "hwnd")) : GetForegroundWindow(), Int(r, "max", 2500));
                default: throw new ArgumentException("unknown op " + Str(r, "op"));
            }
        }

        // ── Arguments ────────────────────────────────────────────────────────
        static string Str(Dictionary<string, object> r, string key)
        {
            object v;
            return r.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : null;
        }

        static int Int(Dictionary<string, object> r, string key, int fallback = 0)
        {
            object v;
            return r.TryGetValue(key, out v) && v != null ? Convert.ToInt32(Math.Round(Convert.ToDouble(v))) : fallback;
        }

        static long Long(Dictionary<string, object> r, string key)
        {
            object v;
            return r.TryGetValue(key, out v) && v != null ? Convert.ToInt64(v) : 0;
        }

        static List<POINT> Points(object value)
        {
            var points = new List<POINT>();
            foreach (object item in (ArrayList)value)
            {
                var pair = (ArrayList)item;
                points.Add(new POINT { X = Convert.ToInt32(pair[0]), Y = Convert.ToInt32(pair[1]) });
            }
            return points;
        }

        // ── Mouse ────────────────────────────────────────────────────────────
        static void Send(params INPUT[] inputs)
        {
            if (inputs.Length == 0) return;
            if (SendInput((uint)inputs.Length, inputs, InputSize) != inputs.Length)
                throw new InvalidOperationException("Windows blocked the input (error " + Marshal.GetLastWin32Error()
                    + "). A window running as administrator, or the lock screen, does not accept it.");
        }

        static INPUT Mouse(uint flags, uint data = 0)
        {
            return new INPUT { type = INPUT_MOUSE, u = new InputUnion { mi = new MOUSEINPUT { dwFlags = flags, mouseData = data } } };
        }

        // SetCursorPos puts the pointer on the exact pixel; the empty relative
        // move after it is what apps see as the mouse moving there (hover
        // states, drag thresholds).
        static void MoveTo(int x, int y)
        {
            SetCursorPos(x, y);
            Send(Mouse(MOVE));
        }

        static void Click(int x, int y, string button, int count)
        {
            uint down = LEFTDOWN, up = LEFTUP;
            if (button == "right") { down = RIGHTDOWN; up = RIGHTUP; }
            else if (button == "middle") { down = MIDDLEDOWN; up = MIDDLEUP; }
            MoveTo(x, y);
            Thread.Sleep(30);
            int gap = (int)Math.Min(60, GetDoubleClickTime() / 4);
            for (int i = 0; i < count; i++)
            {
                Send(Mouse(down), Mouse(up));
                if (i < count - 1) Thread.Sleep(gap);
            }
        }

        static void Drag(List<POINT> path)
        {
            if (path.Count < 2) throw new ArgumentException("a drag needs a start and an end");
            MoveTo(path[0].X, path[0].Y);
            Thread.Sleep(40);
            Send(Mouse(LEFTDOWN));
            try
            {
                Thread.Sleep(60);
                for (int i = 1; i < path.Count; i++)
                {
                    POINT from = path[i - 1], to = path[i];
                    // Small steps: drag and drop starts only after the pointer
                    // has moved a few pixels with the button held.
                    int steps = Math.Max(4, Math.Min(25, (int)(Math.Sqrt(Math.Pow(to.X - from.X, 2) + Math.Pow(to.Y - from.Y, 2)) / 20)));
                    for (int s = 1; s <= steps; s++)
                    {
                        MoveTo(from.X + (to.X - from.X) * s / steps, from.Y + (to.Y - from.Y) * s / steps);
                        Thread.Sleep(12);
                    }
                }
                Thread.Sleep(60);
            }
            finally
            {
                Send(Mouse(LEFTUP));
            }
        }

        static void Scroll(int x, int y, int dx, int dy)
        {
            MoveTo(x, y);
            Thread.Sleep(30);
            // One notch is 120. Positive dy scrolls down, which the wheel calls negative.
            for (int i = 0; i < Math.Abs(dy); i++) { Send(Mouse(WHEEL, unchecked((uint)(dy > 0 ? -120 : 120)))); Thread.Sleep(15); }
            for (int i = 0; i < Math.Abs(dx); i++) { Send(Mouse(HWHEEL, unchecked((uint)(dx > 0 ? 120 : -120)))); Thread.Sleep(15); }
        }

        // ── Keyboard ─────────────────────────────────────────────────────────
        static INPUT Key(ushort vk, ushort scan, uint flags)
        {
            return new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } } };
        }

        // Each character as itself (KEYEVENTF_UNICODE), whatever the keyboard
        // layout; line breaks and tabs as the keys, which is what editors expect.
        static void TypeText(string text)
        {
            var batch = new List<INPUT>();
            foreach (char c in text)
            {
                if (c == '\r') continue;
                if (c == '\n' || c == '\t')
                {
                    ushort vk = c == '\n' ? VK_RETURN : VK_TAB;
                    batch.Add(Key(vk, 0, 0));
                    batch.Add(Key(vk, 0, KEY_UP));
                }
                else
                {
                    batch.Add(Key(0, c, KEY_UNICODE));
                    batch.Add(Key(0, c, KEY_UNICODE | KEY_UP));
                }
                if (batch.Count >= 40) { Send(batch.ToArray()); batch.Clear(); Thread.Sleep(8); }
            }
            Send(batch.ToArray());
        }

        // combos: [[[vk, extended], ...], ...]. Each combo is held down in order
        // and let go in reverse, like a person pressing Ctrl+Shift+S.
        static void PressKeys(ArrayList combos)
        {
            foreach (object comboObject in combos)
            {
                var combo = (ArrayList)comboObject;
                var down = new List<INPUT>();
                var up = new List<INPUT>();
                foreach (object keyObject in combo)
                {
                    var key = (ArrayList)keyObject;
                    ushort vk = Convert.ToUInt16(key[0]);
                    uint extended = Convert.ToBoolean(key[1]) ? KEY_EXTENDED : 0;
                    down.Add(Key(vk, 0, extended));
                    up.Insert(0, Key(vk, 0, extended | KEY_UP));
                }
                try { Send(down.ToArray()); Thread.Sleep(20); }
                finally { Send(up.ToArray()); }
                Thread.Sleep(30);
            }
        }

        // ── Windows ──────────────────────────────────────────────────────────
        static string Title(IntPtr hwnd)
        {
            int length = GetWindowTextLength(hwnd);
            if (length <= 0) return "";
            var text = new StringBuilder(length + 1);
            GetWindowText(hwnd, text, text.Capacity);
            return text.ToString();
        }

        static Dictionary<string, object> WindowInfo(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return null;
            RECT rect;
            GetWindowRect(hwnd, out rect);
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            string app = "";
            try { app = Process.GetProcessById((int)pid).ProcessName; } catch { }
            return new Dictionary<string, object> {
                { "hwnd", hwnd.ToInt64() }, { "title", Title(hwnd) }, { "app", app }, { "pid", (long)pid },
                { "rect", new[] { rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top } },
                { "minimized", IsIconic(hwnd) },
            };
        }

        // The windows a person could switch to: visible, titled, not cloaked
        // (a UWP app that is suspended, a window on another virtual desktop).
        static List<Dictionary<string, object>> Windows()
        {
            var found = new List<Dictionary<string, object>>();
            EnumWindows((hwnd, _) =>
            {
                if (!IsWindowVisible(hwnd) || GetWindowTextLength(hwnd) == 0) return true;
                if (GetAncestor(hwnd, 3 /* GA_ROOTOWNER */) != hwnd && GetAncestor(hwnd, 3) != IntPtr.Zero && IsWindowVisible(GetAncestor(hwnd, 3))) return true;
                int cloaked;
                if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out cloaked, 4) == 0 && cloaked != 0) return true;
                found.Add(WindowInfo(hwnd));
                return true;
            }, IntPtr.Zero);
            return found;
        }

        // Windows lets a process take the foreground only right after input;
        // a tap of Alt counts as that input.
        static Dictionary<string, object> Focus(IntPtr hwnd)
        {
            if (!IsWindow(hwnd)) throw new ArgumentException("that window is closed");
            if (IsIconic(hwnd)) ShowWindow(hwnd, 9 /* SW_RESTORE */);
            Send(Key(VK_MENU, 0, 0), Key(VK_MENU, 0, KEY_UP));
            SetForegroundWindow(hwnd);
            BringWindowToTop(hwnd);
            Thread.Sleep(120);
            var info = WindowInfo(GetForegroundWindow());
            if (info != null) info["focused"] = GetForegroundWindow() == hwnd;
            return info;
        }

        // ── UI Automation ────────────────────────────────────────────────────
        // Everything is read in one cross-process call: FindAll with a cache
        // request and no live references. Walking the tree node by node costs a
        // round trip per node, which in a browser is thousands.
        static Dictionary<string, object> Elements(IntPtr hwnd, int max)
        {
            if (hwnd == IntPtr.Zero) throw new ArgumentException("no window is in front");
            var window = WindowInfo(hwnd);
            var root = AutomationElement.FromHandle(hwnd);
            var cache = new CacheRequest { TreeScope = TreeScope.Element, AutomationElementMode = AutomationElementMode.None };
            cache.Add(AutomationElement.NameProperty);
            cache.Add(AutomationElement.ControlTypeProperty);
            cache.Add(AutomationElement.BoundingRectangleProperty);
            cache.Add(AutomationElement.IsEnabledProperty);
            cache.Add(AutomationElement.HasKeyboardFocusProperty);
            cache.Add(AutomationElement.IsKeyboardFocusableProperty);
            cache.Add(ValuePattern.ValueProperty);
            cache.Add(TogglePattern.ToggleStateProperty);
            cache.Add(SelectionItemPattern.IsSelectedProperty);
            cache.Add(ExpandCollapsePattern.ExpandCollapseStateProperty);
            AutomationElementCollection all;
            using (cache.Activate())
            {
                var visible = new AndCondition(Automation.ControlViewCondition,
                    new PropertyCondition(AutomationElement.IsOffscreenProperty, false));
                all = root.FindAll(TreeScope.Descendants, visible);
            }
            var items = new List<object>();
            foreach (AutomationElement element in all)
            {
                if (items.Count >= max) break;
                var rect = (System.Windows.Rect)element.GetCachedPropertyValue(AutomationElement.BoundingRectangleProperty);
                if (rect.IsEmpty || rect.Width < 2 || rect.Height < 2) continue;
                var type = (ControlType)element.GetCachedPropertyValue(AutomationElement.ControlTypeProperty);
                var item = new Dictionary<string, object> {
                    { "t", type.ProgrammaticName.Replace("ControlType.", "") },
                    { "n", (string)element.GetCachedPropertyValue(AutomationElement.NameProperty) ?? "" },
                    { "r", new[] { (int)Math.Round(rect.X), (int)Math.Round(rect.Y), (int)Math.Round(rect.Width), (int)Math.Round(rect.Height) } },
                };
                object value = element.GetCachedPropertyValue(ValuePattern.ValueProperty, true);
                if (value is string && (string)value != "") item["v"] = value;
                if (!(bool)element.GetCachedPropertyValue(AutomationElement.IsEnabledProperty)) item["off"] = true;
                if ((bool)element.GetCachedPropertyValue(AutomationElement.HasKeyboardFocusProperty)) item["focus"] = true;
                if ((bool)element.GetCachedPropertyValue(AutomationElement.IsKeyboardFocusableProperty)) item["kf"] = true;
                object toggle = element.GetCachedPropertyValue(TogglePattern.ToggleStateProperty, true);
                if (toggle is ToggleState) item["on"] = (ToggleState)toggle == ToggleState.On;
                object selected = element.GetCachedPropertyValue(SelectionItemPattern.IsSelectedProperty, true);
                if (selected is bool && (bool)selected) item["sel"] = true;
                object expanded = element.GetCachedPropertyValue(ExpandCollapsePattern.ExpandCollapseStateProperty, true);
                if (expanded is ExpandCollapseState && (ExpandCollapseState)expanded != ExpandCollapseState.LeafNode)
                    item["open"] = (ExpandCollapseState)expanded == ExpandCollapseState.Expanded;
                items.Add(item);
            }
            return new Dictionary<string, object> { { "window", window }, { "items", items }, { "total", all.Count } };
        }
    }
}
