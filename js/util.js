/* 共用常數與小工具。
   重點：html`...` 會自動跳脫所有插入的資料（防 XSS）；只有 raw() 包起來的才不跳脫。 */

const LABELS = {
  category: { bracelet: "手鍊", necklace: "項鍊", bangle: "手鐲", keychain: "鑰匙圈", ornament: "擺件", raw_stone: "原礦", earring: "耳環", ring: "戒指", other: "其他" },
  channel: { market: "市集", shopee_myship: "賣貨便", familymart: "全家賣場", website: "官網" },
  payment: { cash: "現金", transfer: "轉帳", linepay: "LINE Pay", jkopay: "街口", allpay: "全支付", other: "其他" },
  status: { on_sale: "在售", reserved: "保留中", sold: "已售出", keep: "自留", offline: "下架" },
  expense: { booth: "攤位費", packaging: "包材", other: "其他" }
};

const SAFE = Symbol("safe");
const raw = (s) => ({ [SAFE]: true, s: String(s) });

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function part(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v && v[SAFE]) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ""); });
  return raw(out);
}

const money = (n) => "NT$ " + Math.round(Number(n || 0)).toLocaleString("zh-TW");

function todayTaipei() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID_RE.test(String(s || ""));

/* 表單讀取與檢查：錯誤丟 FormError，畫面會顯示給使用者看。 */
class FormError extends Error {}

const form = {
  str(fd, key, { required = false, max = 200 } = {}) {
    const v = String(fd.get(key) ?? "").trim();
    if (required && !v) throw new FormError("請填寫必填欄位");
    if (v.length > max) throw new FormError("文字太長");
    return v;
  },
  num(fd, key, { min, max, required = false } = {}) {
    const raw = String(fd.get(key) ?? "").trim();
    if (raw === "") {
      if (required) throw new FormError("請填寫金額或數量");
      return null;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new FormError("數字格式不正確");
    if (min !== undefined && v < min) throw new FormError("數字太小");
    if (max !== undefined && v > max) throw new FormError("數字太大");
    return v;
  },
  oneOf(v, allowed, label) {
    if (!allowed.includes(v)) throw new FormError(label + "不正確");
    return v;
  },
  uuid(fd, key) {
    const v = String(fd.get(key) ?? "");
    if (!isUuid(v)) throw new FormError("資料識別碼不正確");
    return v;
  },
  date(fd, key) {
    const v = String(fd.get(key) ?? "").trim();
    if (!v) return todayTaipei();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FormError("日期格式不正確");
    return v;
  }
};

/* 把資料庫錯誤翻成白話；其他錯誤只記在 console，不把細節秀給使用者。 */
function friendlyError(e) {
  if (e instanceof FormError) return e.message;
  const m = String((e && e.message) || e || "");
  if (m.includes("product not available")) return "這件商品已售出、保留中或庫存不足";
  if (m.includes("duplicate key")) return "資料重複（例如商品編號已存在）";
  if (m.includes("violates check constraint")) return "欄位內容不符合規則";
  if (m.includes("row-level security") || m.includes("not authorized")) return "沒有權限，請重新登入並完成兩步驟驗證";
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) return "網路不穩，請稍後再試";
  console.error(e);
  return "操作失敗，請稍後再試";
}
