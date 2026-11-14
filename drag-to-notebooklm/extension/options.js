const DEFAULTS = { showBubble: true, searchSuffix: "", translateTo: "ko", resultCount: 5,
  notebookUrl: "https://notebooklm.google.com/", sendMode: "both", autoInsert: true };
const $ = (id) => document.getElementById(id);
chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const k of Object.keys(DEFAULTS)) {
    const el = $(k);
    if (el.type === "checkbox") el.checked = s[k]; else el.value = s[k];
    el.addEventListener("change", save);
  }
});
function save() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const el = $(k);
    out[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Math.max(1, Math.min(15, +el.value || 5)) : el.value;
  }
  if (!/^https:\/\/notebooklm\.google\.com\//.test(out.notebookUrl)) out.notebookUrl = DEFAULTS.notebookUrl;
  chrome.storage.sync.set(out, () => { $("saved").textContent = "✔ 저장되었습니다"; setTimeout(() => ($("saved").textContent = ""), 1500); });
}
