// 모든 웹페이지: 드래그하면 작은 버튼(말풍선)을 띄움
(() => {
  if (window.top !== window || window.__dragLearnLoaded) return;
  window.__dragLearnLoaded = true;

  let settings = { showBubble: true };
  chrome.runtime.sendMessage({ type: "getSettings" }, (s) => { if (s) settings = s; });
  chrome.storage.onChanged.addListener((c) => {
    if (c.showBubble) settings.showBubble = c.showBubble.newValue;
  });

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:absolute;top:0;left:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .bar{position:absolute;display:none;gap:2px;padding:3px;background:#202124;border-radius:10px;
        box-shadow:0 4px 16px rgba(0,0,0,.35);font:13px/1 "Malgun Gothic",system-ui,sans-serif;white-space:nowrap}
      .bar.show{display:flex}
      button{all:unset;cursor:pointer;color:#fff;padding:7px 9px;border-radius:7px}
      button:hover{background:#3c4043}
      button[hidden]{display:none}
      .x{color:#9aa0a6;padding:7px 6px}
    </style>
    <div class="bar" part="bar">
      <button data-a="search" title="구글에서 검색">🔍 검색</button>
      <button data-a="translate" title="구글 번역">🌐 번역</button>
      <button data-a="nlm" title="구글 검색 결과를 NotebookLM으로">📒 NotebookLM</button>
      <button data-a="lens" title="구글 렌즈" hidden>🖼️ 렌즈</button>
      <button data-a="close" class="x" title="닫기">✕</button>
    </div>`;
  const bar = root.querySelector(".bar");
  const lensBtn = root.querySelector('[data-a="lens"]');
  let current = { text: "", image: "" };

  function mount() { if (!host.isConnected) document.documentElement.appendChild(host); }

  function show(x, y, { text = "", image = "" }) {
    if (!settings.showBubble) return;
    current = { text, image };
    mount();
    root.querySelectorAll('[data-a="search"],[data-a="translate"],[data-a="nlm"]').forEach(b => (b.hidden = !text));
    lensBtn.hidden = !image;
    bar.classList.add("show");
    const w = bar.offsetWidth, h = bar.offsetHeight;
    let left = x - w / 2, top = y + 12;
    left = Math.max(window.scrollX + 4, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 4));
    if (top + h > window.scrollY + window.innerHeight) top = y - h - 12;
    bar.style.left = left + "px";
    bar.style.top = top + "px";
  }
  function hide() { bar.classList.remove("show"); }

  root.addEventListener("mousedown", (e) => e.preventDefault()); // 선택 영역 유지
  root.addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (!a) return;
    const { text, image } = current;
    if (a === "search") chrome.runtime.sendMessage({ type: "search", text });
    if (a === "translate") chrome.runtime.sendMessage({ type: "translate", text });
    if (a === "nlm") chrome.runtime.sendMessage({ type: "searchToNotebook", text });
    if (a === "lens") chrome.runtime.sendMessage({ type: "lens", url: image });
    hide();
  });

  function selectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|url)$/i.test(el.type)))) {
      try { return el.value.substring(el.selectionStart, el.selectionEnd).trim(); } catch { return ""; }
    }
    return (window.getSelection()?.toString() || "").trim();
  }

  document.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const text = selectedText();
      if (text && text.length <= 5000) show(e.pageX, e.pageY, { text });
      else hide();
    }, 10);
  }, true);

  // 이미지를 살짝 드래그했다 놓으면 렌즈 버튼 표시
  let dragImg = "";
  document.addEventListener("dragstart", (e) => {
    const img = e.target?.closest?.("img");
    dragImg = img ? (img.currentSrc || img.src) : "";
  }, true);
  document.addEventListener("dragend", (e) => {
    if (dragImg) show(e.pageX || window.scrollX + e.clientX, e.pageY || window.scrollY + e.clientY, { image: dragImg });
    dragImg = "";
  }, true);

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  document.addEventListener("mousedown", (e) => { if (!e.composedPath().includes(host)) hide(); }, true);

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "getSelection") sendResponse({ text: selectedText() });
  });
})();
