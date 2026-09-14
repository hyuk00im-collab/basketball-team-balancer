/* Pyodide 브릿지 — 서버 없이 브라우저에서 백엔드를 그대로 돌린다.
 *
 * GitHub Pages 같은 정적 호스팅에는 Python 서버가 없다. 그래서 backend/*.py 를
 * Pyodide(WASM 파이썬)에 올리고, FastAPI 앱을 ASGI로 직접 호출한 뒤 그 응답을
 * fetch() 결과처럼 돌려준다. 화면 코드(app.js, result.js, member-sheet.js)는
 * 자기가 서버와 통신하는지 브라우저 안에서 도는지 알 필요가 없다.
 *
 * 서버가 있으면(로컬 uvicorn 실행) 아무 일도 하지 않고 원래 fetch 로 넘긴다.
 */
(() => {
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide.js";
  const PACKAGES = ["fastapi", "openpyxl", "python-multipart"];
  const BACKEND = [
    "skills.py", "models.py", "ranking.py", "balancer.py",
    "evaluator.py", "parser.py", "sample_sheet.py", "main.py",
  ];
  const STATE_KEY = "btb_pyodide_state";

  const origFetch = window.fetch.bind(window);
  let booting = null;   // Promise<"server" | "pyodide">
  let handle = null;    // Pyodide 쪽 요청 처리 함수
  let dumpState = null;

  // 빌드된 사이트에서는 static/ 의 형제가 backend/ 다 (tools/build_pages.py 참고)
  const base = new URL(".", document.currentScript.src);          // .../static/
  const backendUrl = (f) => new URL("../backend/" + f, base).href;
  const apiPath = (url) => {
    const p = new URL(url, location.href).pathname;
    const i = p.indexOf("/api/");
    return i === -1 ? null : p.slice(i);
  };

  /* ---------------------------------------------------------------- 로딩 표시 */
  let overlay = null;
  const bootT0 = performance.now();
  function showBoot(text) {
    if (text) console.log("[bridge] " + Math.round(performance.now() - bootT0) + "ms " + text);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "boot-overlay";
      overlay.innerHTML =
        '<div class="boot-card">' +
        '<div class="spinner"></div>' +
        '<p class="boot-title">브라우저에서 파이썬을 준비하는 중…</p>' +
        '<p class="boot-step"></p>' +
        '<p class="boot-note">서버 없이 이 브라우저 안에서 돌아갑니다. 최초 1회만 받아옵니다.</p>' +
        "</div>";
      document.body.appendChild(overlay);
    }
    overlay.querySelector(".boot-step").textContent = text;
  }
  function hideBoot() {
    if (overlay) overlay.remove();
    overlay = null;
  }
  function failBoot(err) {
    showBoot("");
    overlay.querySelector(".spinner").remove();
    overlay.querySelector(".boot-title").textContent = "브라우저 실행환경을 준비하지 못했습니다";
    overlay.querySelector(".boot-step").textContent = String((err && err.message) || err);
    overlay.querySelector(".boot-note").textContent =
      "인터넷 연결(cdn.jsdelivr.net 접근)을 확인한 뒤 새로고침해 주세요.";
    overlay.classList.add("boot-failed");
  }

  /* ------------------------------------------------------------------- 부팅 */
  async function detect() {
    try {
      const res = await origFetch(new URL("api/skills", location.href).href, {
        method: "GET",
        headers: { "x-bridge-probe": "1" },
      });
      if (res.ok) return "server";
    } catch (_) {
      /* 서버 없음 → Pyodide 로 */
    }
    return "pyodide";
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error("스크립트를 불러오지 못했습니다: " + src));
      document.head.appendChild(s);
    });
  }

  async function bootPyodide() {
    showBoot("파이썬 실행환경 내려받는 중 (약 10MB)");
    await loadScript(PYODIDE);
    const py = await loadPyodide();

    showBoot("라이브러리 설치 중 (fastapi, openpyxl)");
    await py.loadPackage("micropip");
    const micropip = py.pyimport("micropip");
    await micropip.install(PACKAGES);

    showBoot("앱 코드 불러오는 중");
    py.FS.mkdirTree("/app/backend");
    py.FS.mkdirTree("/app/frontend/static");
    // main.py 가 StaticFiles/FileResponse 로 참조하는 경로 — 브릿지에서는 /api/* 만 쓴다
    py.FS.writeFile("/app/frontend/index.html", "");
    py.FS.writeFile("/app/frontend/result.html", "");
    py.FS.writeFile("/app/frontend/static/.keep", "");
    await Promise.all(
      BACKEND.map(async (f) => {
        const res = await origFetch(backendUrl(f));
        if (!res.ok) throw new Error("백엔드 파일을 불러오지 못했습니다: " + f);
        py.FS.writeFile("/app/backend/" + f, await res.text());
      })
    );

    showBoot("시작하는 중");
    await py.runPythonAsync(BOOTSTRAP);
    handle = py.globals.get("bridge_handle");
    dumpState = py.globals.get("bridge_dump_state");

    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
      try {
        py.globals.get("bridge_load_state")(saved);
      } catch (err) {
        console.warn("이전 상태를 복원하지 못했습니다", err);
        localStorage.removeItem(STATE_KEY);
      }
    }
    hideBoot();
    return "pyodide";
  }

  /* --------------------------------------------------- 요청 → ASGI → 응답 */
  async function viaPyodide(input, init) {
    const req = new Request(input, init);
    const path = apiPath(req.url);
    const url = new URL(req.url, location.href);

    const bodyBuf = ["GET", "HEAD"].includes(req.method)
      ? new Uint8Array(0)
      : new Uint8Array(await req.clone().arrayBuffer());

    const headers = [];
    req.headers.forEach((v, k) => headers.push([k, v]));

    const out = await handle(req.method, path, url.search.replace(/^\?/, ""), headers, bodyBuf);
    const res = out.toJs({ dict_converter: Object.fromEntries });
    out.destroy();

    if (!["GET", "HEAD"].includes(req.method)) {
      try {
        localStorage.setItem(STATE_KEY, dumpState());
      } catch (err) {
        console.warn("상태를 저장하지 못했습니다", err);
      }
    }

    const resHeaders = new Headers();
    for (const [k, v] of res.headers) {
      if (k.toLowerCase() === "set-cookie") continue; // 브릿지가 세션을 직접 들고 있다
      resHeaders.append(k, v);
    }
    return new Response(res.body, { status: res.status, headers: resHeaders });
  }

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!apiPath(url)) return origFetch(input, init);
    if (booting === null) {
      booting = detect()
        .then((m) => (m === "server" ? "server" : bootPyodide()))
        .catch((err) => {
          console.error("Pyodide 부팅 실패", err);
          failBoot(err);
          throw err;
        });
    }
    const mode = await booting;
    if (mode === "server") return origFetch(input, init);
    return viaPyodide(input, init);
  };

  /* ------------------------------------------------------------ 파이썬 부트 */
  const BOOTSTRAP = String.raw`
import json, sys
sys.path.insert(0, "/app/backend")

# Pyodide 는 단일 스레드 WASM 이라 스레드를 만들 수 없다. FastAPI 는 동기 def
# 엔드포인트를 스레드풀에서 돌리므로 그 부분만 인라인 실행으로 바꿔친다.
import anyio.to_thread, starlette.concurrency

async def _inline(func, *args, **kwargs):
    return func(*args, **kwargs)

async def _inline_positional(func, *args, **kwargs):
    return func(*args)

starlette.concurrency.run_in_threadpool = _inline
anyio.to_thread.run_sync = _inline_positional

import fastapi.routing, fastapi.dependencies.utils
fastapi.routing.run_in_threadpool = _inline
fastapi.dependencies.utils.run_in_threadpool = _inline

import main

BRIDGE_SID = "browser-local-session"


def _store():
    return main.sessions.get(BRIDGE_SID)


async def bridge_handle(method, path, query, headers, body):
    """FastAPI 앱을 ASGI 로 직접 호출한다 (HTTP 서버 없이)."""
    hdrs = [(str(k).lower().encode(), str(v).encode()) for k, v in headers.to_py()]
    hdrs = [(k, v) for k, v in hdrs if k not in (b"cookie", b"host", b"content-length")]
    payload = bytes(body.to_py()) if body is not None else b""
    hdrs.append((b"cookie", ("%s=%s" % (main.SESSION_COOKIE, BRIDGE_SID)).encode()))
    hdrs.append((b"content-length", str(len(payload)).encode()))
    hdrs.append((b"host", b"localhost"))

    captured = {"status": 500, "headers": [], "body": bytearray()}
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.1"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "root_path": "",
        "headers": hdrs,
        "client": ("127.0.0.1", 0),
        "server": ("localhost", 443),
    }

    state = {"sent": False}

    async def receive():
        if state["sent"]:
            return {"type": "http.disconnect"}
        state["sent"] = True
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message):
        if message["type"] == "http.response.start":
            captured["status"] = message["status"]
            captured["headers"] = message.get("headers", [])
        elif message["type"] == "http.response.body":
            captured["body"].extend(message.get("body", b""))

    await main.app(scope, receive, send)
    return {
        "status": captured["status"],
        "headers": [[k.decode(), v.decode()] for k, v in captured["headers"]],
        "body": bytes(captured["body"]),
    }


def bridge_dump_state():
    """페이지를 옮겨다녀도 명단이 유지되도록 브라우저에 저장할 형태로 뽑는다."""
    st = _store()
    return json.dumps(
        {
            "members": [m.model_dump() for m in st.members],
            "last_result": st.last_result.model_dump() if st.last_result else None,
            "last_options": st.last_options.model_dump() if st.last_options else None,
        },
        ensure_ascii=False,
    )


def bridge_load_state(raw):
    from models import BalanceOptions, GenerateResponse, Member

    data = json.loads(raw)
    st = _store()
    st.members = [Member(**m) for m in data.get("members", [])]
    st.last_result = (
        GenerateResponse(**data["last_result"]) if data.get("last_result") else None
    )
    st.last_options = (
        BalanceOptions(**data["last_options"]) if data.get("last_options") else None
    )
`;
})();
