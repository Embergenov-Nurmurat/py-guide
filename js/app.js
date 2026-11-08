/* ==========================================================================
   app.js — логика справочника: запуск Python, прогресс, поиск, карточки,
   викторина и песочница. Содержимое справочника лежит в data.js.
   ========================================================================== */
(function () {
  "use strict";

  const DATA = window.PYGUIDE_DATA;
  if (!DATA) { console.error("Не загружен js/data.js"); return; }

  /* ───────────────────────── Настройки ───────────────────────── */
  const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
  const RUN_TIMEOUT_MS = 30000;      // дольше — программа останавливается
  const MAX_OUTPUT_CHARS = 200000;   // защита от бесконечного print
  const LEARNED_BOX = 3;             // с этой «коробки» понятие считается выученным
  const MAX_BOX = 5;
  const REVIEW_DAYS = [0, 1, 3, 7, 14, 30]; // через сколько дней повторять
  const SESSION_SIZE = 15;
  const QUIZ_SIZE = 10;
  const LEVELS = { 1: "Основы", 2: "Дальше", 3: "Продвинутое" };
  const KEY = {
    progress: "pyguide:v1:progress",
    theme: "pyguide:v1:theme",
    code: "pyguide:v1:play-code",
    stdin: "pyguide:v1:play-stdin"
  };
  const HERO_CODE = 'name = "мир"\nprint(f"Привет, {name}!")\nprint("2 + 2 =", 2 + 2)';
  const PLAY_EXAMPLES = [
    { title: "Привет, мир", code: 'print("Привет, мир!")\n' },
    { title: "Калькулятор (input)", stdin: "3\n4.5",
      code: 'a = float(input("Первое число: "))\nb = float(input("Второе число: "))\nprint("Сумма:", a + b)\nprint("Произведение:", a * b)\n' },
    { title: "Таблица умножения",
      code: 'for i in range(1, 6):\n    row = []\n    for j in range(1, 6):\n        row.append(f"{i * j:3}")\n    print("".join(row))\n' },
    { title: "Случайный пароль",
      code: 'import random\nimport string\n\nsymbols = string.ascii_letters + string.digits\npassword = "".join(random.choices(symbols, k=12))\nprint("Пароль:", password)\n' },
    { title: "FizzBuzz",
      code: 'for n in range(1, 21):\n    if n % 15 == 0:\n        print("FizzBuzz")\n    elif n % 3 == 0:\n        print("Fizz")\n    elif n % 5 == 0:\n        print("Buzz")\n    else:\n        print(n)\n' },
    { title: "Обработка ошибок", stdin: "десять",
      code: 'text = input("Введите число: ")\ntry:\n    number = int(text)\n    print("Квадрат:", number ** 2)\nexcept ValueError:\n    print("«" + text + "» — не число")\n' },
    { title: "Замер времени",
      code: 'import time\n\nstart = time.perf_counter()\ntotal = sum(i * i for i in range(1_000_000))\nprint("Сумма:", total)\nprint("Секунд:", round(time.perf_counter() - start, 3))\n' }
  ];

  /* ───────────────────────── Утилиты ───────────────────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, "е");
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "dataset") Object.assign(n.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, "");
        else n.setAttribute(k, String(v));
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  const ICONS = {
    book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
    cards: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    send: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  function icon(name) {
    const tmp = document.createElement("span");
    tmp.innerHTML = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || "") + "</svg>";
    return tmp.firstChild;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function fmtSeconds(ms) {
    const s = ms / 1000;
    const txt = s < 1 ? s.toFixed(2) : s.toFixed(1);
    return txt.replace(".", ",") + " с";
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Текст с `инлайн-кодом` без innerHTML. */
  function richText(parent, text) {
    String(text).split("`").forEach((part, i) => {
      if (!part) return;
      parent.append(i % 2 ? el("code", { text: part }) : document.createTextNode(part));
    });
    return parent;
  }

  /** Записывает текст в node, подсвечивая найденные слова. */
  function highlight(node, text, terms) {
    node.textContent = "";
    if (!terms.length) { node.textContent = text; return; }
    const low = norm(text);
    const ranges = [];
    for (const t of terms) {
      let i = 0;
      while ((i = low.indexOf(t, i)) !== -1) { ranges.push([i, i + t.length]); i += t.length; }
    }
    if (!ranges.length) { node.textContent = text; return; }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0].slice()];
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
    }
    let pos = 0;
    for (const [a, b] of merged) {
      if (a > pos) node.append(document.createTextNode(text.slice(pos, a)));
      node.append(el("mark", { text: text.slice(a, b) }));
      pos = b;
    }
    if (pos < text.length) node.append(document.createTextNode(text.slice(pos)));
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* пробуем запасной способ */ }
    try {
      const ta = el("textarea", { style: "position:fixed;opacity:0;top:0;left:0", "aria-hidden": "true" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  /* ───────────────────────── Хранилище ───────────────────────── */
  const Store = (() => {
    const mem = {};
    let persistent = true;
    try {
      localStorage.setItem("pyguide:test", "1");
      localStorage.removeItem("pyguide:test");
    } catch (e) { persistent = false; }
    return {
      isPersistent: () => persistent,
      get(key, fallback) {
        try {
          if (persistent) {
            const raw = localStorage.getItem(key);
            if (raw !== null) return JSON.parse(raw);
          }
        } catch (e) { /* повреждённые данные — берём значение по умолчанию */ }
        return key in mem ? mem[key] : fallback;
      },
      set(key, value) {
        mem[key] = value;
        if (!persistent) return;
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { persistent = false; }
      },
      remove(key) {
        delete mem[key];
        try { localStorage.removeItem(key); } catch (e) { /* ничего */ }
      }
    };
  })();

  /* ───────────────────────── Данные ───────────────────────── */
  const SECTIONS = DATA.sections;
  const ENTRIES = [];
  const BY_ID = new Map();
  SECTIONS.forEach((sec, si) => {
    sec.items.forEach((it, ii) => {
      const [name, desc, code, note, lvl, opts] = it;
      const e = { id: sec.id + ":" + name, sec, si, ii, name, desc, code, note: note || "", lvl: lvl || 2, opts: opts || {} };
      e.hay = norm([name, desc, e.note, code, sec.title].join(" "));
      ENTRIES.push(e);
      BY_ID.set(e.id, e);
    });
  });
  const SEC_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

  /* ───────────────────────── Прогресс ───────────────────────── */
  const Progress = (() => {
    let data = {};
    const subs = new Set();
    const emit = () => subs.forEach((f) => f());

    function load() {
      const raw = Store.get(KEY.progress, {});
      data = {};
      if (raw && typeof raw === "object") {
        for (const [id, v] of Object.entries(raw)) {
          if (BY_ID.has(id) && v && Number.isFinite(v.b)) {
            data[id] = { b: clamp(Math.round(v.b), 0, MAX_BOX), t: Number(v.t) || 0 };
          }
        }
      }
    }
    const save = () => Store.set(KEY.progress, data);

    const api = {
      load,
      reload() { load(); emit(); },
      onChange(f) { subs.add(f); },
      box: (id) => (data[id] ? data[id].b : 0),
      seen: (id) => !!data[id],
      learned: (id) => !!data[id] && data[id].b >= LEARNED_BOX,
      due(id, now = Date.now()) {
        const d = data[id];
        return !!d && now >= d.t + REVIEW_DAYS[d.b] * 86400000;
      },
      set(id, b) { data[id] = { b: clamp(b, 0, MAX_BOX), t: Date.now() }; save(); emit(); },
      toggleLearned(id) {
        if (api.learned(id)) delete data[id]; else data[id] = { b: LEARNED_BOX, t: Date.now() };
        save(); emit();
        return api.learned(id);
      },
      reset() { data = {}; Store.remove(KEY.progress); emit(); },
      learnedCount(secId) {
        let n = 0;
        for (const e of ENTRIES) if ((!secId || e.sec.id === secId) && api.learned(e.id)) n++;
        return n;
      },
      dueCount() { return ENTRIES.reduce((n, e) => n + (api.due(e.id) ? 1 : 0), 0); }
    };
    return api;
  })();

  /** Следующее понятие «по пути»: сначала основы, потом дальше. */
  function nextToLearn() {
    const todo = ENTRIES.filter((e) => !Progress.learned(e.id));
    todo.sort((a, b) => a.lvl - b.lvl || a.si - b.si || a.ii - b.ii);
    return todo[0] || null;
  }

  /* ───────────────────────── Python (фоновый поток) ───────────────────────── */

  // Код, который выполняется внутри Python перед запуском программ пользователя.
  // Он не даёт exit()/sys.exit() «убить» интерпретатор и делает трассировку чистой.
  const PY_HELPER = String.raw`
import sys, traceback, builtins, linecache, gc
from pyodide.code import eval_code_async

def _pg_exit(code=None):
    raise SystemExit(code)

def _pg_breakpoint(*args, **kwargs):
    print("[breakpoint] В браузере отладчика pdb нет — выполнение продолжается.")

builtins.exit = _pg_exit
builtins.quit = _pg_exit
sys.breakpointhook = _pg_breakpoint
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

async def _pg_run(code):
    g = {"__name__": "__main__", "__builtins__": builtins}
    fname = "main.py"
    linecache.cache[fname] = (len(code), None, code.splitlines(True), fname)
    try:
        await eval_code_async(code, g, filename=fname)
        return ""
    except SystemExit:
        return ""
    except BaseException:
        et, ev, tb = sys.exc_info()
        while tb is not None and tb.tb_frame.f_code.co_filename != fname:
            tb = tb.tb_next
        return "".join(traceback.format_exception(et, ev, tb))
    finally:
        try:
            gc.collect()
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        linecache.cache.pop(fname, None)
`;

  /* Эта функция превращается в текст и запускается в Web Worker (через Blob),
     поэтому работает даже при открытии index.html двойным кликом (file://).
     Внутри можно использовать только то, что доступно в воркере. */
  function workerMain() {
    let pyodide = null, loading = null, runFn = null, initInfo = null;
    let stdinLines = [], runId = 0;
    const decOut = new TextDecoder(), decErr = new TextDecoder();
    const post = (m) => self.postMessage(m);

    function ensure() {
      if (pyodide) return Promise.resolve(pyodide);
      if (!loading) {
        loading = (async () => {
          post({ type: "status", state: "loading" });
          importScripts(initInfo.base + "pyodide.js");
          const py = await loadPyodide({ indexURL: initInfo.base });
          py.setStdout({ write: (buf) => { post({ type: "out", id: runId, stream: "out", text: decOut.decode(buf, { stream: true }) }); return buf.length; } });
          py.setStderr({ write: (buf) => { post({ type: "out", id: runId, stream: "err", text: decErr.decode(buf, { stream: true }) }); return buf.length; } });
          py.setStdin({ stdin: () => {
            if (!stdinLines.length) return undefined;
            const line = stdinLines.shift();
            post({ type: "out", id: runId, stream: "in", text: line + "\n" });
            return line;
          } });
          py.runPython(initInfo.helper, { filename: "<helper>" });
          runFn = py.globals.get("_pg_run");
          pyodide = py;
          post({ type: "status", state: "ready" });
          return py;
        })();
        loading.catch(() => { loading = null; });
      }
      return loading;
    }

    self.onmessage = async (e) => {
      const m = e.data;
      if (m.type === "init") {
        initInfo = m;
        try { await ensure(); } catch (err) { post({ type: "status", state: "error", message: String((err && err.message) || err) }); }
        return;
      }
      if (m.type === "run") {
        runId = m.id;
        try { await ensure(); } catch (err) {
          post({ type: "status", state: "error", message: String((err && err.message) || err) });
          post({ type: "done", id: m.id, loadError: true });
          return;
        }
        stdinLines = m.stdin ? String(m.stdin).replace(/\r\n/g, "\n").split("\n") : [];
        if (stdinLines.length && stdinLines[stdinLines.length - 1] === "") stdinLines.pop();
        post({ type: "started", id: m.id });
        try {
          try { await pyodide.loadPackagesFromImports(m.code); } catch (_) { /* пакет не нужен или недоступен */ }
          const error = await runFn(m.code);
          post({ type: "done", id: m.id, error: error || "" });
        } catch (err) {
          post({ type: "done", id: m.id, error: "Внутренняя ошибка: " + String((err && err.message) || err) });
        }
      }
    };
  }

  const Py = (() => {
    let worker = null, blobUrl = null, state = "idle", seq = 0, cur = null;
    const stateSubs = new Set(), busySubs = new Set();
    const setState = (s, msg) => { state = s; stateSubs.forEach((f) => f(s, msg)); };
    const busyChanged = () => busySubs.forEach((f) => f(!!cur));
    const initMessage = () => ({ type: "init", base: PYODIDE_BASE, helper: PY_HELPER });

    function teardown() {
      if (worker) { worker.terminate(); worker = null; }
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    }
    function finish(result) {
      if (!cur) return;
      const c = cur;
      cur = null;
      clearTimeout(c.timer);
      busyChanged();
      c.resolve(result);
    }
    function onMessage(ev) {
      const m = ev.data;
      if (m.type === "status") {
        setState(m.state, m.message);
        if (m.state === "error") finish({ loadError: m.message || "unknown" });
        return;
      }
      if (!cur || m.id !== cur.id) return;
      if (m.type === "started") {
        cur.t0 = performance.now();
        cur.timer = setTimeout(() => api.stop("timeout"), RUN_TIMEOUT_MS);
      } else if (m.type === "out") {
        cur.chars += m.text.length;
        if (cur.chars > MAX_OUTPUT_CHARS) { api.stop("output"); return; }
        cur.onChunk(m.text, m.stream);
      } else if (m.type === "done") {
        const ms = performance.now() - (cur.t0 || performance.now());
        finish(m.loadError ? { loadError: "unknown" } : { error: m.error || "", ms });
      }
    }
    function spawn() {
      if (typeof Worker === "undefined" || typeof Blob === "undefined") throw new Error("no-worker");
      blobUrl = URL.createObjectURL(new Blob(["(" + workerMain.toString() + ")();"], { type: "text/javascript" }));
      worker = new Worker(blobUrl);
      worker.onmessage = onMessage;
      worker.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        const msg = (ev && ev.message) || "worker-error";
        teardown();
        setState("error", msg);
        finish({ loadError: msg });
      };
      setState("loading");
      worker.postMessage(initMessage());
    }

    const api = {
      get state() { return state; },
      get busy() { return !!cur; },
      onState(f) { stateSubs.add(f); return () => stateSubs.delete(f); },
      onBusy(f) { busySubs.add(f); return () => busySubs.delete(f); },
      /** Загрузить интерпретатор заранее. */
      start() {
        if (state === "loading" || state === "ready") return;
        try {
          if (!worker) spawn(); else worker.postMessage(initMessage());
        } catch (e) { setState("error", e.message); }
      },
      run(code, stdin, onChunk) {
        if (cur) return Promise.resolve({ busy: true });
        try { if (!worker) spawn(); } catch (e) {
          setState("error", e.message);
          return Promise.resolve({ loadError: e.message });
        }
        const id = ++seq;
        return new Promise((resolve) => {
          cur = { id, onChunk, resolve, chars: 0, t0: 0, timer: 0 };
          busyChanged();
          worker.postMessage({ type: "run", id, code, stdin: stdin || "" });
        });
      },
      stop(reason) {
        if (!cur) return;
        const ms = cur.t0 ? performance.now() - cur.t0 : 0;
        teardown();
        setState("idle");
        finish({ stopped: reason || "user", ms });
      }
    };
    return api;
  })();

  /** В браузере уже работает цикл событий, поэтому asyncio.run(...) на верхнем уровне
      заменяем на await (...). Строки с отступом не трогаем. */
  function adaptForBrowser(code) {
    let changed = false;
    const out = code.split("\n").map((line) => {
      if (/^\s/.test(line)) return line;
      if (line.includes("asyncio.run(")) { changed = true; return line.replace(/asyncio\.run\(/g, "await ("); }
      return line;
    }).join("\n");
    return { code: out, changed };
  }

  const ERROR_HINTS = {
    SyntaxError: "Синтаксическая ошибка: Python не смог разобрать код. Проверьте скобки, кавычки и двоеточия в указанной строке.",
    IndentationError: "Ошибка отступов: блок кода выделяется отступом (4 пробела). Проверьте указанную строку.",
    TabError: "Смешаны табуляции и пробелы в отступах. Используйте только пробелы.",
    NameError: "Имя не определено: переменную или функцию используют до создания, либо в имени опечатка.",
    UnboundLocalError: "Переменная используется в функции до присваивания. Возможно, нужен global или nonlocal.",
    TypeError: "Неподходящий тип: операция применена к значению не того типа (например, строка + число).",
    ValueError: "Тип подходит, а значение — нет (например, int('abc')).",
    ZeroDivisionError: "Делить на ноль нельзя.",
    IndexError: "Элемента с таким номером нет. Нумерация начинается с 0, а последний индекс равен len(...) - 1.",
    KeyError: "В словаре нет такого ключа. Безопасный способ — метод get().",
    AttributeError: "У объекта нет такого атрибута или метода. Проверьте имя и тип объекта.",
    ModuleNotFoundError: "Модуль не найден. В браузере доступны стандартная библиотека и часть популярных пакетов.",
    ImportError: "Не удалось импортировать имя. Проверьте название модуля и функции.",
    EOFError: "Программа ждёт ввод через input(), а ввода нет. Впишите ответы в поле «Ввод» — по одной строке на каждый input().",
    RecursionError: "Слишком глубокая рекурсия: функция вызывает сама себя без остановки. Добавьте условие выхода.",
    AssertionError: "Проверка assert не прошла: условие оказалось ложным.",
    FileNotFoundError: "Файл не найден. В браузере файлы живут во временной памяти — сначала создайте его через open(..., 'w').",
    OverflowError: "Число слишком велико для этой операции.",
    MemoryError: "Не хватило памяти.",
    StopIteration: "Итератор закончился: больше значений нет."
  };
  function explainError(trace) {
    const lines = String(trace).trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1] || "";
    const m = last.match(/^([A-Za-z_][\w.]*)(?::\s*(.*))?$/);
    if (!m) return "";
    const type = m[1].split(".").pop();
    if (type === "RuntimeError" && /asyncio\.run\(\)/.test(last)) {
      return "В браузере цикл событий уже запущен: вместо asyncio.run(main()) пишите на верхнем уровне await main().";
    }
    return ERROR_HINTS[type] || "";
  }

  /* ───────────────────────── Редактор кода с запуском ───────────────────────── */
  const needsInput = (code) => /\binput\s*\(/.test(code);

  /**
   * Создаёт блок «код + кнопки + вывод».
   * opts: code, stdin, big (песочница), label, examples, onSend, persist
   */
  function createRunner(opts) {
    const big = !!opts.big;
    let original = opts.code;
    let running = false;
    let outputShown = big;

    const ta = el("textarea", {
      class: "r-code", spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off",
      wrap: "off", "aria-label": opts.label || "Код на Python"
    });
    ta.value = original;
    const stdinTa = el("textarea", {
      class: "r-stdin-input", rows: "2", spellcheck: "false", wrap: "off",
      placeholder: "Каждая строка — ответ на один input()", "aria-label": "Ввод для input()"
    });
    stdinTa.value = opts.stdin || "";
    const stdinBox = el("label", { class: "r-stdin", hidden: true }, el("span", { class: "r-stdin-label", text: "Ввод для input()" }), stdinTa);

    const runBtn = el("button", { class: "btn primary r-run", type: "button", title: "Ctrl+Enter" });
    const resetBtn = el("button", { class: "btn r-reset", type: "button" }, icon("reset"), el("span", { text: big ? "Сбросить пример" : "Сбросить" }));
    const copyBtn = el("button", { class: "btn r-copy", type: "button" }, icon("copy"), el("span", { text: "Копировать" }));
    const sendBtn = opts.onSend ? el("button", { class: "btn r-send", type: "button", title: "Открыть этот код в песочнице" }, icon("send"), el("span", { text: "В песочницу" })) : null;
    const clearBtn = big ? el("button", { class: "btn r-clear", type: "button" }, icon("trash"), el("span", { text: "Очистить вывод" })) : null;

    let exampleSelect = null;
    if (opts.examples) {
      exampleSelect = el("select", { class: "r-examples", "aria-label": "Готовые примеры" },
        el("option", { value: "", text: "Готовые примеры…" }),
        opts.examples.map((ex, i) => el("option", { value: String(i), text: ex.title })));
    }

    const bar = el("div", { class: "r-bar" }, runBtn, resetBtn, copyBtn, sendBtn, clearBtn, exampleSelect);
    const pre = el("pre", { class: "r-pre", tabindex: "0", "aria-label": "Вывод программы" });
    const status = el("p", { class: "r-status", role: "status" });
    const hint = el("p", { class: "r-hint", hidden: true });
    const out = el("div", { class: "r-out", hidden: !big }, pre, status, hint);
    const edit = el("div", { class: "r-edit" }, ta, stdinBox);
    const root = el("div", { class: "runner" + (big ? " big" : "") }, bar, el("div", { class: "r-main" }, edit, out));

    function setRunBtn() {
      runBtn.replaceChildren(icon(running ? "stop" : "play"), el("span", { text: running ? "Стоп" : "Запустить" }));
      runBtn.classList.toggle("is-stop", running);
      root.classList.toggle("running", running);
      ta.readOnly = running;
    }
    function syncUi() {
      if (!big) ta.rows = Math.max(2, ta.value.split("\n").length);
      stdinBox.hidden = !(needsInput(ta.value) || stdinTa.value);
      resetBtn.disabled = !big && ta.value === original && stdinTa.value === (opts.stdin || "");
    }
    function showOut() { if (!outputShown) { out.hidden = false; outputShown = true; } }
    function clearOut() {
      pre.replaceChildren();
      status.textContent = "";
      status.className = "r-status";
      hint.hidden = true;
      hint.textContent = "";
    }
    function placeholderOut() {
      if (big && !pre.childNodes.length) pre.append(el("span", { class: "muted", text: "Здесь появится вывод программы." }));
    }
    function append(text, stream) {
      if (!text) return;
      const ph = pre.querySelector(".muted");
      if (ph) ph.remove();
      const last = pre.lastChild;
      const cls = stream === "err" ? "err" : stream === "in" ? "inp" : "";
      if (cls) {
        if (last && last.nodeType === 1 && last.className === cls) last.append(text); else pre.append(el("span", { class: cls, text }));
      } else if (last && last.nodeType === 3) last.appendData(text);
      else pre.append(document.createTextNode(text));
      pre.scrollTop = pre.scrollHeight;
    }
    function setStatus(text, kind) { status.textContent = text; status.className = "r-status" + (kind ? " " + kind : ""); }

    async function run() {
      if (Py.busy) { toast("Сейчас выполняется другая программа. Дождитесь её завершения."); return; }
      const adapted = adaptForBrowser(ta.value);
      running = true;
      setRunBtn();
      showOut();
      clearOut();
      const cancelStateWatch = Py.onState((s) => { if (s === "ready" && running) setStatus("Выполняется…"); });
      setStatus(Py.state === "ready" ? "Выполняется…" : "Загружаю интерпретатор Python (около 10 МБ, один раз)…");
      const res = await Py.run(adapted.code, stdinTa.value, append);
      cancelStateWatch();
      running = false;
      setRunBtn();
      finishRun(res, adapted.changed);
    }
    function finishRun(res, asyncChanged) {
      if (res.busy) { setStatus("Занято другой программой.", "warn"); return; }
      if (res.loadError) {
        const msg = res.loadError === "no-worker"
          ? "Этот браузер не поддерживает фоновые потоки (Web Worker), поэтому запустить код нельзя."
          : "Не удалось загрузить интерпретатор Python с cdn.jsdelivr.net. Проверьте интернет и попробуйте ещё раз.";
        setStatus(msg, "bad");
        return;
      }
      if (res.stopped) {
        const msgs = {
          timeout: "Остановлено: программа работала дольше 30 секунд. Возможно, это бесконечный цикл.",
          output: "Остановлено: программа вывела слишком много текста.",
          user: "Остановлено."
        };
        setStatus(msgs[res.stopped] || msgs.user, "warn");
        return;
      }
      if (res.error) {
        pre.append(el("span", { class: "err", text: (pre.textContent && !pre.textContent.endsWith("\n") ? "\n" : "") + res.error.replace(/\s+$/, "") + "\n" }));
        const h = explainError(res.error);
        if (h) { hint.hidden = false; hint.textContent = ""; hint.append(el("strong", { text: "Подсказка. " }), h); }
        setStatus("Завершено с ошибкой · " + fmtSeconds(res.ms), "bad");
      } else {
        if (!pre.textContent.trim()) pre.append(el("span", { class: "muted", text: "(программа ничего не вывела)" }));
        setStatus("Готово · " + fmtSeconds(res.ms), "ok");
      }
      if (asyncChanged) {
        hint.hidden = false;
        if (!hint.textContent) hint.textContent = "";
        hint.append(document.createTextNode((hint.textContent ? " " : "") + "В браузере asyncio.run(…) на верхнем уровне выполняется как await …"));
      }
      pre.scrollTop = pre.scrollHeight;
    }
    function toggleRun() { if (running) Py.stop("user"); else run(); }

    /* поведение редактора */
    function insertText(text) {
      ta.focus();
      let ok = false;
      try { ok = document.execCommand && document.execCommand("insertText", false, text); } catch (e) { ok = false; }
      if (!ok) {
        ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    function indentSelection(dedent) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      if (!dedent && s === e) { insertText(" ".repeat(4 - ((s - lineStart) % 4))); return; }
      let lineEnd = e > s && v[e - 1] === "\n" ? e - 1 : v.indexOf("\n", e);
      if (lineEnd === -1) lineEnd = v.length;
      const block = v.slice(lineStart, lineEnd);
      const next = block.split("\n").map((l) => (dedent ? l.replace(/^( {1,4}|\t)/, "") : "    " + l)).join("\n");
      ta.setSelectionRange(lineStart, lineEnd);
      insertText(next);
      if (s === e) { const pos = clamp(s - (block.length - next.length), lineStart, lineStart + next.length); ta.setSelectionRange(pos, pos); }
      else ta.setSelectionRange(lineStart, lineStart + next.length);
    }
    ta.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" && e.key !== "Tab") delete ta.dataset.esc;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); toggleRun(); return; }
      if (e.key === "Escape") { ta.dataset.esc = "1"; return; }
      if (e.key === "Tab") {
        if (ta.dataset.esc) { delete ta.dataset.esc; return; } // Esc, затем Tab — выйти из поля
        e.preventDefault();
        indentSelection(e.shiftKey);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && ta.selectionStart === ta.selectionEnd) {
        const v = ta.value, s = ta.selectionStart;
        const before = v.slice(v.lastIndexOf("\n", s - 1) + 1, s);
        const indent = before.match(/^[ \t]*/)[0];
        const extra = /:\s*$/.test(before) ? "    " : "";
        if (indent || extra) { e.preventDefault(); insertText("\n" + indent + extra); }
      }
    });

    let saveTimer = 0;
    function persist() {
      if (!opts.persist) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { Store.set(opts.persist.code, ta.value); Store.set(opts.persist.stdin, stdinTa.value); }, 400);
    }
    ta.addEventListener("input", () => { syncUi(); persist(); });
    stdinTa.addEventListener("input", () => { syncUi(); persist(); });
    runBtn.addEventListener("click", toggleRun);
    resetBtn.addEventListener("click", () => { ta.value = original; stdinTa.value = opts.stdin || ""; syncUi(); persist(); ta.focus(); });
    copyBtn.addEventListener("click", async () => { toast((await copyText(ta.value)) ? "Код скопирован" : "Не удалось скопировать"); });
    if (sendBtn) sendBtn.addEventListener("click", () => opts.onSend(ta.value, stdinTa.value));
    if (clearBtn) clearBtn.addEventListener("click", () => { clearOut(); placeholderOut(); });
    if (exampleSelect) exampleSelect.addEventListener("change", () => {
      const ex = opts.examples[Number(exampleSelect.value)];
      if (!ex) return;
      original = ex.code;
      opts = Object.assign({}, opts, { stdin: ex.stdin || "" });
      ta.value = ex.code;
      stdinTa.value = ex.stdin || "";
      exampleSelect.value = "";
      syncUi(); persist(); clearOut(); placeholderOut();
    });
    Py.onBusy((busy) => { runBtn.classList.toggle("dim", busy && !running); });

    setRunBtn();
    syncUi();
    placeholderOut();

    return {
      root,
      setCode(code, stdin) {
        original = code;
        opts = Object.assign({}, opts, { stdin: stdin || "" });
        ta.value = code;
        stdinTa.value = stdin || "";
        syncUi(); persist();
      },
      focus: () => ta.focus()
    };
  }

  /* ───────────────────────── Тема и статус Python ───────────────────────── */
  const Theme = (() => {
    const btn = $("#themeBtn");
    const current = () => document.documentElement.dataset.theme
      || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    function paint() {
      const t = current();
      btn.replaceChildren(icon(t === "dark" ? "sun" : "moon"));
      btn.setAttribute("aria-label", t === "dark" ? "Включить светлую тему" : "Включить тёмную тему");
      const meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", t === "dark" ? "#0f1a2e" : "#f3f6fc");
    }
    const saved = Store.get(KEY.theme, null);
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      Store.set(KEY.theme, next);
      paint();
    });
    paint();
  })();

  (function pyPill() {
    const pill = $("#pyStatus"), text = $(".py-text", pill);
    const labels = {
      idle: "Python: не загружен",
      loading: "Python: загрузка…",
      ready: "Python: готов",
      error: "Python: ошибка, повторить"
    };
    function paint(s) { pill.dataset.state = s; text.textContent = labels[s] || labels.idle; }
    Py.onState(paint);
    paint(Py.state);
    pill.addEventListener("click", () => {
      if (Py.state === "ready") toast("Интерпретатор Python уже готов к работе.");
      else if (Py.state === "loading") toast("Python ещё загружается. Это нужно сделать один раз.");
      else Py.start();
    });
  })();

  /* ───────────────────────── Справочник ───────────────────────── */
  const rows = new Map();          // id -> { el, head, panel, mark, item, open, built, name, desc }
  const secEls = new Map();        // sectionId -> { root, count, bar, list, ... }
  const filter = { q: "", level: 0, status: "all" };
  const autoOpened = new Set();

  function pips(lvl) {
    return el("span", { class: "e-lvl", role: "img", "aria-label": "Уровень: " + LEVELS[lvl], title: LEVELS[lvl] },
      [1, 2, 3].map((n) => el("i", { class: n <= lvl ? "on" : "" })));
  }

  function entryHash(id) { return "#reference/" + encodeURIComponent(id); }

  function setOpen(id, open) {
    const r = rows.get(id);
    if (!r || r.open === open) return;
    if (open && !r.built) buildPanel(r);
    r.open = open;
    r.el.classList.toggle("open", open);
    r.head.setAttribute("aria-expanded", String(open));
    if (!open) autoOpened.delete(id);
  }

  function toggleRow(id) {
    const r = rows.get(id);
    const open = !r.open;
    setOpen(id, open);
    autoOpened.delete(id);
    try { history.replaceState(null, "", open ? entryHash(id) : "#reference"); } catch (e) { /* file:// в некоторых браузерах */ }
  }

  function sendToPlay(code, stdin) {
    Play.setCode(code, stdin);
    location.hash = "#play";
  }

  function buildPanel(r) {
    const e = r.item;
    const inner = $(".e-panel-in", r.panel);
    const runner = createRunner({ code: e.code, stdin: e.opts.stdin, label: "Пример: " + e.name, onSend: sendToPlay });
    inner.append(runner.root);
    if (e.note) {
      inner.append(el("p", { class: "e-note" }, el("strong", { text: "Важно знать. " }), richText(el("span"), e.note)));
    }
    const learnBtn = el("button", { class: "btn learn-btn", type: "button", "aria-pressed": String(Progress.learned(e.id)), onclick: () => Progress.toggleLearned(e.id) });
    const linkBtn = el("button", { class: "btn", type: "button", onclick: async () => {
      const url = location.href.split("#")[0] + entryHash(e.id);
      toast((await copyText(url)) ? "Ссылка скопирована" : "Не удалось скопировать ссылку");
    } }, icon("link"), el("span", { text: "Ссылка" }));
    r.learnBtn = learnBtn;
    inner.append(el("div", { class: "e-actions" }, learnBtn, linkBtn));
    paintRow(r);
    r.built = true;
  }

  function paintRow(r) {
    const learned = Progress.learned(r.item.id);
    r.el.classList.toggle("learned", learned);
    r.mark.setAttribute("aria-pressed", String(learned));
    if (r.learnBtn) {
      r.learnBtn.setAttribute("aria-pressed", String(learned));
      r.learnBtn.replaceChildren(icon("check"), el("span", { text: learned ? "Выучено" : "Отметить выученным" }));
    }
  }

  function buildReference() {
    const host = $("#sections");
    SECTIONS.forEach((sec) => {
      const count = el("p", { class: "sec-count" });
      const bar = el("div", { class: "meter small", role: "progressbar", "aria-label": "Прогресс раздела «" + sec.title + "»", "aria-valuemin": "0", "aria-valuemax": String(sec.items.length), "aria-valuenow": "0" }, el("i"));
      const list = el("div", { class: "entries" });
      const root = el("section", { class: "sec", id: "sec-" + sec.id, dataset: { sec: sec.id }, "aria-labelledby": "h-sec-" + sec.id },
        el("header", { class: "sec-head" },
          el("h2", { id: "h-sec-" + sec.id, text: sec.title }),
          count, bar),
        richText(el("p", { class: "sec-desc" }), sec.desc),
        sec.note ? richText(el("p", { class: "sec-note" }), sec.note) : null,
        list);
      secEls.set(sec.id, { root, count, bar, list });
      host.append(root);
    });

    ENTRIES.forEach((e, idx) => {
      const panelId = "p-" + idx;
      const name = el("span", { class: "e-name", text: e.name });
      const desc = el("span", { class: "e-desc", text: e.desc });
      const mark = el("button", { class: "mark", type: "button", "aria-pressed": "false", "aria-label": "Выучено: " + e.name, title: "Отметить выученным", onclick: () => Progress.toggleLearned(e.id) }, icon("check"));
      const head = el("button", { class: "e-head", type: "button", "aria-expanded": "false", "aria-controls": panelId, onclick: () => toggleRow(e.id) },
        name, desc, pips(e.lvl), icon("chevron"));
      const panel = el("div", { class: "e-panel", id: panelId }, el("div", { class: "e-panel-in" }));
      const row = el("article", { class: "entry", id: "e-" + idx, dataset: { id: e.id } }, mark, head, panel);
      rows.set(e.id, { el: row, head, panel, mark, item: e, open: false, built: false, name, desc, learnBtn: null, shown: true });
      secEls.get(e.sec.id).list.append(row);
    });
  }

  /** Чем меньше число, тем выше запись в результатах: сначала совпадения по имени. */
  function matchRank(e, q) {
    const name = norm(e.name);
    const bare = name.replace(/[(\s].*$/, "");
    if (name === q || bare === q) return 0;
    if (name.startsWith(q) || bare.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    return 3;
  }

  function applyFilters() {
    const terms = norm(filter.q).split(/\s+/).filter(Boolean);
    let shown = 0;
    const perSec = new Map(SECTIONS.map((s) => [s.id, 0]));
    const query = norm(filter.q).trim();
    for (const r of rows.values()) {
      const e = r.item;
      let ok = true;
      if (filter.level && e.lvl !== filter.level) ok = false;
      if (ok && filter.status === "learned" && !Progress.learned(e.id)) ok = false;
      if (ok && filter.status === "new" && Progress.learned(e.id)) ok = false;
      if (ok && terms.length && !terms.every((t) => e.hay.includes(t))) ok = false;
      r.shown = ok;
      r.el.hidden = !ok;
      r.el.style.order = ok && query ? String(matchRank(e, query) * 1000 + e.ii) : "";
      if (ok) {
        shown++;
        perSec.set(e.sec.id, perSec.get(e.sec.id) + 1);
        highlight(r.name, e.name, terms);
        highlight(r.desc, e.desc, terms);
      }
    }
    for (const sec of SECTIONS) {
      secEls.get(sec.id).root.hidden = perSec.get(sec.id) === 0;
    }
    // Мало результатов — сразу раскрываем, чтобы не кликать лишний раз
    if (terms.length && shown > 0 && shown <= 3) {
      for (const r of rows.values()) if (r.shown && !r.open) { setOpen(r.item.id, true); autoOpened.add(r.item.id); }
    } else {
      for (const id of Array.from(autoOpened)) setOpen(id, false);
    }
    const filtered = terms.length || filter.level || filter.status !== "all";
    $("#resultCount").textContent = filtered
      ? (shown ? "Найдено: " + shown + " из " + ENTRIES.length : "Ничего не найдено")
      : "Всего понятий: " + ENTRIES.length;
    $("#emptyState").hidden = shown !== 0;
    $("#searchClear").hidden = !filter.q;
  }

  function resetFilters() {
    filter.q = ""; filter.level = 0; filter.status = "all";
    $("#search").value = "";
    syncChips();
    applyFilters();
  }
  function syncChips() {
    $$(".chip-group").forEach((g) => {
      const key = g.dataset.filter;
      $$(".chip", g).forEach((c) => c.setAttribute("aria-pressed", String(String(filter[key]) === c.dataset.value)));
    });
  }

  function openEntry(id) {
    const r = rows.get(id);
    if (!r) return;
    const needsReset = !r.shown;
    if (needsReset) resetFilters();
    setOpen(id, true);
    autoOpened.delete(id);
    r.el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    r.head.focus({ preventScroll: true });
  }

  function updateProgressUi() {
    const total = ENTRIES.length;
    const learned = Progress.learnedCount();
    const pct = total ? Math.round((learned / total) * 100) : 0;
    const due = Progress.dueCount();

    for (const r of rows.values()) paintRow(r);
    for (const sec of SECTIONS) {
      const n = Progress.learnedCount(sec.id), t = sec.items.length;
      const s = secEls.get(sec.id);
      s.count.textContent = "Выучено " + n + " из " + t;
      s.bar.setAttribute("aria-valuenow", String(n));
      $("i", s.bar).style.width = (t ? (n / t) * 100 : 0) + "%";
      const nav = $('[data-nav="' + sec.id + '"]');
      if (nav) { $(".nav-count", nav).textContent = n + "/" + t; $("i", nav).style.width = (t ? (n / t) * 100 : 0) + "%"; }
    }
    $("#ringFg").style.strokeDasharray = pct + " 100";
    $("#sideTotalPct").textContent = pct + "%";
    $("#sideTotalSub").textContent = " выучено: " + learned + " из " + total;
    const hp = $("#heroProgress .meter");
    hp.setAttribute("aria-valuenow", String(pct));
    $("i", hp).style.width = pct + "%";
    $("#heroProgressText").textContent = learned
      ? "Выучено " + learned + " из " + total + (due ? " · к повторению: " + due : "")
      : "Пока ничего не выучено — начните с уровня «Основы».";

    const next = nextToLearn();
    const btn = $("#btnContinue");
    btn.hidden = false;
    if (!next) { btn.textContent = "Всё выучено — повторить"; btn.dataset.target = ""; }
    else {
      btn.textContent = learned ? "Продолжить: " + next.name : "Начать с основ";
      btn.dataset.target = next.id;
    }
    const badge = $("#dueBadge");
    badge.hidden = !due;
    badge.textContent = due > 99 ? "99+" : String(due);
    badge.setAttribute("aria-label", "К повторению: " + due);
    if (filter.status !== "all") applyFilters();
  }

  function buildSideNav() {
    const nav = $("#sideNav");
    SECTIONS.forEach((sec) => {
      nav.append(el("button", { class: "nav-item", type: "button", dataset: { nav: sec.id, sec: sec.id }, onclick: () => {
        const s = secEls.get(sec.id).root;
        if (s.hidden) resetFilters();
        s.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
      } },
        el("span", { class: "nav-dot", "aria-hidden": "true" }),
        el("span", { class: "nav-title", text: sec.short || sec.title }),
        el("span", { class: "nav-count", text: "0/" + sec.items.length }),
        el("span", { class: "meter tiny", "aria-hidden": "true" }, el("i"))));
    });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((list) => {
        for (const it of list) {
          if (it.isIntersecting) {
            $$(".nav-item", nav).forEach((n) => n.classList.toggle("active", n.dataset.nav === it.target.dataset.sec));
          }
        }
      }, { rootMargin: "-20% 0px -70% 0px" });
      secEls.forEach((s) => io.observe(s.root));
    }
  }

  function buildHero() {
    const counts = Object.fromEntries(SECTIONS.map((s) => [s.id, s.items.length]));
    const kw = counts.kw, fn = counts.fn, ty = counts.ty;
    if (kw && fn && ty) {
      $("#heroLead").textContent = kw + " " + plural(kw, "ключевое слово", "ключевых слова", "ключевых слов") + ", "
        + fn + " " + plural(fn, "функция", "функции", "функций") + ", "
        + ty + " " + plural(ty, "тип данных", "типа данных", "типов данных")
        + " и модули random и time — всего " + ENTRIES.length + " " + plural(ENTRIES.length, "понятие", "понятия", "понятий")
        + " с примерами, которые работают прямо на странице.";
    }
    $("#heroRunner").append(createRunner({ code: HERO_CODE, label: "Пробный код" }).root);
    const tl = $("#timeline");
    DATA.history.forEach((h) => tl.append(el("li", null, el("span", { class: "tl-year", text: h.year }), el("span", { class: "tl-text", text: h.text }))));
  }

  function initToolbar() {
    const input = $("#search");
    let t = 0;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { filter.q = input.value.trim(); applyFilters(); }, 80);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { input.value = ""; filter.q = ""; applyFilters(); } });
    $("#searchClear").addEventListener("click", () => { input.value = ""; filter.q = ""; applyFilters(); input.focus(); });
    $$(".chip-group").forEach((g) => g.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const key = g.dataset.filter;
      filter[key] = key === "level" ? Number(chip.dataset.value) : chip.dataset.value;
      syncChips();
      applyFilters();
    }));
    $("#emptyReset").addEventListener("click", resetFilters);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (currentView !== "reference") return;
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      e.preventDefault();
      input.focus();
    });
    $("#btnContinue").addEventListener("click", () => {
      const id = $("#btnContinue").dataset.target;
      if (id) openEntry(id); else location.hash = "#cards";
    });
    let confirmTimer = 0;
    const resetBtn = $("#resetProgress");
    resetBtn.addEventListener("click", () => {
      if (!resetBtn.dataset.sure) {
        resetBtn.dataset.sure = "1";
        resetBtn.textContent = "Точно сбросить?";
        confirmTimer = setTimeout(() => { delete resetBtn.dataset.sure; resetBtn.textContent = "Сбросить прогресс"; }, 4000);
      } else {
        clearTimeout(confirmTimer);
        delete resetBtn.dataset.sure;
        resetBtn.textContent = "Сбросить прогресс";
        Progress.reset();
        toast("Прогресс сброшен");
      }
    });
    $("#storageWarn").hidden = Store.isPersistent();
  }

  /* ───────────────────────── Карточки ───────────────────────── */
  function fillScopeSelect(select) {
    select.append(el("option", { value: "all", text: "Все разделы" }));
    SECTIONS.forEach((s) => select.append(el("option", { value: s.id, text: s.title })));
  }
  function pickEntries(scope, level) {
    return ENTRIES.filter((e) => (scope === "all" || e.sec.id === scope) && (!level || e.lvl === level));
  }

  const Cards = (() => {
    const stage = $("#cardsStage");
    let session = null;

    function buildQueue(scope, level) {
      const cand = pickEntries(scope, level);
      const now = Date.now();
      const due = cand.filter((e) => Progress.due(e.id, now)).sort((a, b) => Progress.box(a.id) - Progress.box(b.id));
      const dueIds = new Set(due.map((e) => e.id));
      const fresh = cand.filter((e) => !Progress.seen(e.id)).sort((a, b) => a.lvl - b.lvl || a.si - b.si || a.ii - b.ii);
      const bySec = new Map();
      fresh.forEach((e) => { if (!bySec.has(e.sec.id)) bySec.set(e.sec.id, []); bySec.get(e.sec.id).push(e); });
      const mixed = [];
      const lists = Array.from(bySec.values());
      while (lists.some((l) => l.length)) lists.forEach((l) => { if (l.length) mixed.push(l.shift()); });
      const rest = cand.filter((e) => Progress.seen(e.id) && !dueIds.has(e.id)).sort((a, b) => Progress.box(a.id) - Progress.box(b.id));
      return shuffle([...due, ...mixed, ...rest].slice(0, SESSION_SIZE)).map((e) => e.id);
    }

    function start(ids) {
      const scope = $("#cardsScope").value, level = Number($("#cardsLevel").value);
      const queue = ids || buildQueue(scope, level);
      if (!queue.length) {
        stage.replaceChildren(el("p", { class: "panel-msg", text: "В этом выборе нет карточек. Выберите другой раздел или уровень." }));
        return;
      }
      session = { queue, i: 0, known: [], again: [], revealed: false };
      render();
    }

    function meterBlock() {
      const pct = Math.round((session.i / session.queue.length) * 100);
      return el("div", { class: "session-bar" },
        el("div", { class: "meter small", role: "progressbar", "aria-label": "Прогресс раунда", "aria-valuemin": "0", "aria-valuemax": String(session.queue.length), "aria-valuenow": String(session.i) }, el("i", { style: "width:" + pct + "%" })),
        el("p", { class: "session-count", text: "Карточка " + Math.min(session.i + 1, session.queue.length) + " из " + session.queue.length }));
    }

    function answer(ok) {
      const id = session.queue[session.i];
      Progress.set(id, ok ? Progress.box(id) + 1 : 0);
      (ok ? session.known : session.again).push(id);
      session.i++;
      session.revealed = false;
      render();
    }

    function render() {
      if (session.i >= session.queue.length) { renderDone(); return; }
      const e = BY_ID.get(session.queue[session.i]);
      const card = el("div", { class: "fc sec-" + e.sec.id, dataset: { sec: e.sec.id } },
        el("p", { class: "fc-meta" }, el("span", { class: "tag", text: e.sec.title }), el("span", { class: "tag plain", text: LEVELS[e.lvl] })),
        el("h2", { class: "fc-name", text: e.name }));
      let focusEl;
      if (!session.revealed) {
        card.append(el("p", { class: "fc-prompt", text: "Что это такое и как используется? Вспомните ответ, затем откройте его." }));
        focusEl = el("button", { class: "btn primary big-btn", type: "button", onclick: () => { session.revealed = true; render(); } }, "Показать ответ");
        card.append(el("div", { class: "fc-actions" }, focusEl));
      } else {
        card.append(el("p", { class: "fc-desc", text: e.desc }));
        card.append(createRunner({ code: e.code, stdin: e.opts.stdin, label: "Пример: " + e.name, onSend: sendToPlay }).root);
        if (e.note) card.append(el("p", { class: "e-note" }, el("strong", { text: "Важно знать. " }), richText(el("span"), e.note)));
        const again = el("button", { class: "btn big-btn", type: "button", onclick: () => answer(false) }, "Не знаю ", el("kbd", { text: "1" }));
        focusEl = el("button", { class: "btn primary big-btn", type: "button", onclick: () => answer(true) }, "Знаю ", el("kbd", { text: "2" }));
        card.append(el("div", { class: "fc-actions" }, again, focusEl));
      }
      stage.replaceChildren(meterBlock(), card);
      focusEl.focus({ preventScroll: true });
    }

    function renderDone() {
      const total = session.queue.length, k = session.known.length;
      const wrap = el("div", { class: "done" },
        el("h2", { class: "done-title", text: "Раунд завершён" }),
        el("p", { class: "done-score" }, el("strong", { text: k + " из " + total }), " — вы знали уверенно."));
      if (session.again.length) {
        wrap.append(el("p", { class: "done-sub", text: "Стоит повторить:" }));
        wrap.append(el("ul", { class: "miss-list" }, session.again.map((id) => {
          const e = BY_ID.get(id);
          return el("li", null, el("button", { class: "link-btn mono", type: "button", onclick: () => { location.hash = entryHash(id); } }, e.name), el("span", { text: " — " + e.desc }));
        })));
      }
      const next = el("button", { class: "btn primary big-btn", type: "button", onclick: () => start() }, "Ещё раунд");
      const only = session.again.length ? el("button", { class: "btn big-btn", type: "button", onclick: () => start(shuffle(session.again)) }, "Только непонятные") : null;
      wrap.append(el("div", { class: "fc-actions" }, next, only));
      stage.replaceChildren(wrap);
      next.focus({ preventScroll: true });
    }

    function init() {
      fillScopeSelect($("#cardsScope"));
      $("#cardsStart").addEventListener("click", () => start());
      document.addEventListener("keydown", (e) => {
        if (currentView !== "cards" || !session || session.i >= session.queue.length || !session.revealed) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "1") answer(false);
        else if (e.key === "2") answer(true);
      });
    }
    return { init, start, show() { if (!session) start(); } };
  })();

  /* ───────────────────────── Викторина ───────────────────────── */
  const Quiz = (() => {
    const stage = $("#quizStage");
    let run = null;

    function makeQuestion(e) {
      const type = Math.random() < 0.5 ? "def" : "name";
      const keyOf = (x) => (type === "def" ? x.desc : x.name);
      const used = new Set([keyOf(e)]);
      const picks = [];
      for (const x of shuffle(ENTRIES.filter((y) => y.sec === e.sec && y.id !== e.id))) {
        if (used.has(keyOf(x))) continue;
        used.add(keyOf(x));
        picks.push(x);
        if (picks.length === 3) break;
      }
      const options = shuffle([e, ...picks]);
      return { e, type, options, correct: options.indexOf(e), answered: -1 };
    }

    function start(ids) {
      const scope = $("#quizScope").value, level = Number($("#quizLevel").value);
      const pool = ids ? ids.map((id) => BY_ID.get(id)) : shuffle(pickEntries(scope, level)).slice(0, QUIZ_SIZE);
      if (pool.length < 2) {
        stage.replaceChildren(el("p", { class: "panel-msg", text: "Для викторины нужно хотя бы два понятия. Выберите другой раздел или уровень." }));
        return;
      }
      run = { qs: pool.map(makeQuestion), i: 0, score: 0, wrong: [] };
      render();
    }

    function choose(idx) {
      const q = run.qs[run.i];
      if (q.answered !== -1) return;
      q.answered = idx;
      const ok = idx === q.correct;
      if (ok) run.score++; else run.wrong.push(q.e.id);
      const id = q.e.id;
      Progress.set(id, ok ? Progress.box(id) + 1 : Math.max(0, Progress.box(id) - 1));
      render();
    }

    function render() {
      if (run.i >= run.qs.length) { renderDone(); return; }
      const q = run.qs[run.i], e = q.e, answered = q.answered !== -1;
      const pct = Math.round((run.i / run.qs.length) * 100);
      const head = el("div", { class: "session-bar" },
        el("div", { class: "meter small", role: "progressbar", "aria-label": "Прогресс викторины", "aria-valuemin": "0", "aria-valuemax": String(run.qs.length), "aria-valuenow": String(run.i) }, el("i", { style: "width:" + pct + "%" })),
        el("p", { class: "session-count", text: "Вопрос " + (run.i + 1) + " из " + run.qs.length }));
      const prompt = q.type === "def"
        ? el("h2", { class: "q-prompt" }, "Что такое ", el("span", { class: "q-name sec-" + e.sec.id, text: e.name }), "?")
        : el("h2", { class: "q-prompt" }, "Какое понятие описано так: «" + e.desc + "»?");
      const list = el("ol", { class: "q-options" }, q.options.map((o, i) => {
        let cls = "q-opt";
        if (answered) { if (i === q.correct) cls += " correct"; else if (i === q.answered) cls += " wrong"; }
        return el("li", null, el("button", { class: cls, type: "button", disabled: answered, onclick: () => choose(i) },
          el("kbd", { text: String(i + 1) }),
          el("span", { class: q.type === "def" ? "" : "mono", text: q.type === "def" ? o.desc : o.name })));
      }));
      const card = el("div", { class: "quiz-card" }, prompt, list);
      let focusEl = null;
      if (answered) {
        const ok = q.answered === q.correct;
        card.append(el("p", { class: "q-verdict " + (ok ? "ok" : "bad"), role: "status", text: ok ? "Верно!" : "Неверно. Правильный ответ: " + (q.type === "def" ? e.desc : e.name) }));
        if (e.note) card.append(el("p", { class: "e-note" }, el("strong", { text: "Важно знать. " }), richText(el("span"), e.note)));
        focusEl = el("button", { class: "btn primary big-btn", type: "button", onclick: () => { run.i++; render(); } }, run.i + 1 === run.qs.length ? "Показать результат" : "Дальше");
        card.append(el("div", { class: "fc-actions" }, focusEl));
      }
      stage.replaceChildren(head, card);
      if (focusEl) focusEl.focus({ preventScroll: true });
    }

    function renderDone() {
      const total = run.qs.length, s = run.score;
      const ratio = s / total;
      const verdict = ratio === 1 ? "Безупречно!" : ratio >= 0.7 ? "Очень хорошо." : ratio >= 0.4 ? "Неплохо, но есть что повторить." : "Начало положено — повторите и попробуйте снова.";
      const wrap = el("div", { class: "done" },
        el("h2", { class: "done-title", text: "Результат" }),
        el("p", { class: "done-score" }, el("strong", { text: s + " из " + total }), " — " + verdict));
      if (run.wrong.length) {
        wrap.append(el("p", { class: "done-sub", text: "Ошибки:" }));
        wrap.append(el("ul", { class: "miss-list" }, run.wrong.map((id) => {
          const e = BY_ID.get(id);
          return el("li", null, el("button", { class: "link-btn mono", type: "button", onclick: () => { location.hash = entryHash(id); } }, e.name), el("span", { text: " — " + e.desc }));
        })));
      }
      const again = el("button", { class: "btn primary big-btn", type: "button", onclick: () => start() }, "Новая викторина");
      const only = run.wrong.length ? el("button", { class: "btn big-btn", type: "button", onclick: () => start(shuffle(run.wrong)) }, "Повторить ошибки") : null;
      wrap.append(el("div", { class: "fc-actions" }, again, only));
      stage.replaceChildren(wrap);
      again.focus({ preventScroll: true });
    }

    function init() {
      fillScopeSelect($("#quizScope"));
      $("#quizStart").addEventListener("click", () => start());
      document.addEventListener("keydown", (e) => {
        if (currentView !== "quiz" || !run || run.i >= run.qs.length) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
        const n = Number(e.key);
        if (n >= 1 && n <= run.qs[run.i].options.length) choose(n - 1);
      });
    }
    return { init };
  })();

  /* ───────────────────────── Песочница ───────────────────────── */
  const Play = (() => {
    let runner = null;
    function init() {
      const savedCode = Store.get(KEY.code, null);
      const savedStdin = Store.get(KEY.stdin, "");
      const first = PLAY_EXAMPLES[0];
      runner = createRunner({
        big: true,
        code: typeof savedCode === "string" ? savedCode : first.code,
        stdin: typeof savedCode === "string" ? String(savedStdin || "") : (first.stdin || ""),
        label: "Редактор кода",
        examples: PLAY_EXAMPLES,
        persist: { code: KEY.code, stdin: KEY.stdin }
      });
      $("#playRunner").append(runner.root);
    }
    return { init, setCode: (c, s) => runner.setCode(c, s), focus: () => runner && runner.focus() };
  })();

  /* ───────────────────────── Навигация ───────────────────────── */
  const VIEWS = ["reference", "cards", "quiz", "play"];
  const VIEW_TITLES = {
    reference: "Справочник Python — слова, функции, типы и модули с запуском кода",
    cards: "Карточки — Справочник Python",
    quiz: "Викторина — Справочник Python",
    play: "Песочница — Справочник Python"
  };
  let currentView = "reference";
  let firstRoute = true;

  function route() {
    const raw = location.hash.replace(/^#/, "");
    const parts = raw.split("/");
    const view = VIEWS.includes(parts[0]) ? parts[0] : "reference";
    const switched = view !== currentView || firstRoute;
    currentView = view;
    VIEWS.forEach((v) => { $("#view-" + v).hidden = v !== view; });
    $$(".tab").forEach((t) => {
      const on = t.dataset.view === view;
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    document.title = VIEW_TITLES[view];
    if (view === "reference" && parts[1]) {
      let id = "";
      try { id = decodeURIComponent(parts.slice(1).join("/")); } catch (e) { id = ""; }
      if (BY_ID.has(id)) { firstRoute = false; requestAnimationFrame(() => openEntry(id)); return; }
    }
    if (switched && !firstRoute) {
      window.scrollTo(0, 0);
      const h = $("#view-" + view + " h1");
      if (h) h.focus({ preventScroll: true });
    }
    if (view === "cards") Cards.show();
    if (view === "play") Play.focus();
    firstRoute = false;
  }

  /* ───────────────────────── Запуск ───────────────────────── */
  function init() {
    $$("[data-icon]").forEach((n) => n.append(icon(n.dataset.icon)));
    $("#searchClear").append(icon("x"));
    $("#toTop").append(icon("up"));

    Progress.load();
    buildHero();
    buildSideNav();
    buildReference();
    initToolbar();
    Cards.init();
    Quiz.init();
    Play.init();
    Progress.onChange(updateProgressUi);
    window.addEventListener("storage", (e) => { if (e.key === KEY.progress) Progress.reload(); });
    updateProgressUi();
    applyFilters();

    const toTop = $("#toTop");
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { toTop.hidden = window.scrollY < 900; ticking = false; });
    }, { passive: true });
    toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }));

    window.addEventListener("hashchange", route);
    route();

    // Страховка: незавершённый запуск не должен пережить закрытие страницы.
    window.addEventListener("pagehide", () => Py.stop("user"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
