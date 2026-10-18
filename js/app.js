/* 啟動流程、路由、表單與按鈕事件。
   登入流程：登入 → 兩步驟驗證（aal2）→ 確認是 owner → 進入系統。
   真正的授權在資料庫 RLS；這裡只是讓使用者得到明確的導向。 */

// 防止被嵌進別人的網頁（GitHub Pages 無法設定 X-Frame-Options，所以用程式補）
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  try { window.top.location = window.self.location; } catch (e) { /* 被擋就維持隱藏 */ }
}

const $ = (sel, root = document) => root.querySelector(sel);

const state = { view: "login", token: 0, mfaFactor: null };

function show(view) {
  state.view = view;
  for (const v of ["login", "mfa", "noaccess", "app"]) $("#view-" + v).hidden = v !== view;
}

let toastTimer = 0;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.setAttribute("role", isError ? "alert" : "status");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function go(path) {
  if (location.hash === "#" + path) route();
  else location.hash = path;
}

/* ---------- 啟動與登入流程 ---------- */
async function boot() {
  try {
    const s = await Store.session();
    if (!s) return show("login");
    if ((await Store.assurance()) !== "aal2") return startMfa();
    if (!(await Store.isOwner())) return show("noaccess");
    show("app");
    route();
  } catch (e) {
    show("login");
    toast(friendlyError(e), true);
  }
}

async function startMfa() {
  show("mfa");
  const box = $("#mfa-setup");
  box.hidden = true;
  $("#mfa-code").value = "";
  try {
    const s = await Store.mfaSetup();
    state.mfaFactor = s.factorId;
    if (s.qr && s.qr.startsWith("data:image/svg+xml")) {
      $("#mfa-qr").src = s.qr;
      $("#mfa-secret").textContent = s.secret || "";
      box.hidden = false;
    }
  } catch (e) {
    toast(friendlyError(e), true);
  }
}

/* ---------- 路由 ---------- */
async function route() {
  if (state.view !== "app") return;
  const token = ++state.token;
  const [pathRaw, query = ""] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(query);
  const seg = pathRaw.split("/").filter(Boolean);
  const missing = html`<p class="card">找不到這個頁面。</p>`;
  const needId = (fn) => (isUuid(seg[1]) ? fn(seg[1]) : missing);

  let view;
  try {
    if (!seg.length) view = await Pages.home();
    else if (seg[0] === "sell") view = seg[1] ? await needId(Pages.sellDetail) : await Pages.sell(params);
    else if (seg[0] === "products") {
      if (!seg[1]) view = await Pages.products(params);
      else if (seg[1] === "new") view = await Pages.productNew();
      else view = await needId(Pages.productDetail);
    } else if (seg[0] === "materials") view = await Pages.materials();
    else if (seg[0] === "purchases") view = await Pages.purchases();
    else if (seg[0] === "expenses") view = await Pages.expenses();
    else if (seg[0] === "report") view = await Pages.report();
    else view = missing;
  } catch (e) {
    view = html`<p class="card warn" role="alert">${friendlyError(e)}</p>`;
  }
  if (token !== state.token) return; // 已經切到別頁
  $("#page").innerHTML = view.s;
  const root = "/" + (seg[0] || "");
  document.querySelectorAll("#tabs a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === "#" + root);
  });
  window.scrollTo(0, 0);
}

/* ---------- 表單動作（回傳要前往的路徑；不回傳則重新整理目前頁面）---------- */
const NONE = Symbol("none");

const Actions = {
  async login(fd) {
    await Store.signIn(form.str(fd, "email", { required: true, max: 200 }), String(fd.get("password") || ""));
    $("#login-password").value = "";
    await boot();
    return NONE;
  },
  async mfa(fd) {
    const code = form.str(fd, "code", { required: true, max: 6 });
    if (!/^\d{6}$/.test(code)) throw new FormError("請輸入 6 位數驗證碼");
    await Store.mfaVerify(state.mfaFactor, code);
    await boot();
    return NONE;
  },
  async search(fd, f) {
    return `${f.dataset.route}?q=${encodeURIComponent(form.str(fd, "q", { max: 50 }))}`;
  },
  async sell(fd) {
    const serviceId = form.str(fd, "service_id");
    await Store.sell({
      productId: form.uuid(fd, "product_id"),
      price: form.num(fd, "sale_price", { min: 0, max: 10000000, required: true }),
      payment: form.oneOf(form.str(fd, "payment_method"), Object.keys(LABELS.payment), "付款方式"),
      qty: Math.trunc(form.num(fd, "qty", { min: 1, max: 9999 }) ?? 1),
      packaging: form.num(fd, "packaging_cost", { min: 0, max: 100000 }) ?? 0,
      serviceId: serviceId ? form.uuid(fd, "service_id") : null,
      servicePrice: form.num(fd, "service_price", { min: 0, max: 100000 }) ?? 0,
      serviceGift: fd.get("service_gift") === "on"
    });
    toast("已記錄售出");
    return "/";
  },
  async createProduct(fd) {
    const isUnique = fd.get("is_unique") === "on";
    const id = await Store.createProduct({
      name: form.str(fd, "name", { required: true, max: 100 }),
      sku: form.str(fd, "sku", { max: 40 }) || null,
      category: form.oneOf(form.str(fd, "category"), Object.keys(LABELS.category), "類別"),
      is_unique: isUnique,
      stock_qty: isUnique ? 1 : (form.num(fd, "stock_qty", { min: 1, max: 9999 }) ?? 1),
      other_cost: form.num(fd, "other_cost", { min: 0, max: 10000000 }) ?? 0,
      original_price: form.num(fd, "original_price", { min: 0, max: 10000000 }),
      sale_price: form.num(fd, "sale_price", { min: 0, max: 10000000, required: true }),
      listed_channels: fd.getAll("channels").filter((c) => LABELS.channel[c]),
      description: form.str(fd, "description", { max: 1000 }) || null
    });
    toast("已建立商品，可以接著加入用料與照片");
    return "/products/" + id;
  },
  async updateProduct(fd) {
    const id = form.uuid(fd, "id");
    await Store.updateProduct(id, {
      name: form.str(fd, "name", { required: true, max: 100 }),
      other_cost: form.num(fd, "other_cost", { min: 0, max: 10000000 }) ?? 0,
      original_price: form.num(fd, "original_price", { min: 0, max: 10000000 }),
      sale_price: form.num(fd, "sale_price", { min: 0, max: 10000000, required: true }),
      status: form.oneOf(form.str(fd, "status"), Object.keys(LABELS.status), "狀態"),
      listed_channels: fd.getAll("channels").filter((c) => LABELS.channel[c]),
      description: form.str(fd, "description", { max: 1000 }) || null
    });
    toast("已儲存");
    return "/products/" + id;
  },
  async addMaterial(fd) {
    await Store.addProductMaterial(
      form.uuid(fd, "product_id"), form.uuid(fd, "material_id"),
      Math.trunc(form.num(fd, "bead_qty", { min: 1, max: 100000, required: true })));
    toast("已加入用料");
    return null;
  },
  async createMaterial(fd) {
    await Store.createMaterial(form.str(fd, "name", { required: true, max: 100 }), form.str(fd, "spec", { max: 100 }));
    toast("已新增材料");
    return null;
  },
  async createPurchase(fd) {
    const material = form.str(fd, "material_id");
    const beads = form.num(fd, "bead_count", { min: 1, max: 1000000 });
    if (material && beads === null) throw new FormError("選了珠子材料就要填總顆數");
    await Store.createPurchase({
      material_id: material ? form.uuid(fd, "material_id") : null,
      purchased_on: form.date(fd, "purchased_on"),
      item_name: form.str(fd, "item_name", { required: true, max: 100 }),
      total_price: form.num(fd, "total_price", { min: 0, max: 100000000, required: true }),
      weight_g: form.num(fd, "weight_g", { min: 0, max: 1000000 }),
      bead_count: beads === null ? null : Math.trunc(beads)
    }, form.str(fd, "supplier_name", { max: 100 }));
    toast("已登記進貨");
    return null;
  },
  async createExpense(fd) {
    await Store.createExpense({
      type: form.oneOf(form.str(fd, "type"), Object.keys(LABELS.expense), "費用類別"),
      amount: form.num(fd, "amount", { min: 0, max: 10000000, required: true }),
      spent_on: form.date(fd, "spent_on"),
      note: form.str(fd, "note", { max: 200 }) || null
    });
    toast("已新增費用");
    return null;
  }
};

document.addEventListener("submit", async (e) => {
  const f = e.target.closest("form[data-action]");
  if (!f) return;
  e.preventDefault();
  const fn = Actions[f.dataset.action];
  if (!fn) return;
  const btn = f.querySelector("button:not([type=button])");
  if (btn) btn.disabled = true;
  try {
    const next = await fn(new FormData(f), f);
    if (next === NONE) return;
    if (next) go(next); else route();
  } catch (err) {
    toast(friendlyError(err), true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ---------- 按鈕與檔案上傳 ---------- */
document.addEventListener("click", async (e) => {
  const logout = e.target.closest("[data-logout]");
  if (logout) {
    await Store.signOut();
    location.hash = "";
    return boot();
  }
  const b = e.target.closest("[data-do]");
  if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.do === "clearListings" && isUuid(b.dataset.id)) {
      await Store.clearListings(b.dataset.id);
    } else if (b.dataset.do === "removeMaterial" && isUuid(b.dataset.id) && isUuid(b.dataset.material)) {
      await Store.removeProductMaterial(b.dataset.id, b.dataset.material);
    }
    route();
  } catch (err) {
    b.disabled = false;
    toast(friendlyError(err), true);
  }
});

document.addEventListener("change", async (e) => {
  const input = e.target.closest("input[data-upload]");
  if (!input || !isUuid(input.dataset.upload)) return;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  toast("上傳中…");
  try {
    for (const file of files) await Store.uploadMedia(input.dataset.upload, file);
    toast("已上傳");
    route();
  } catch (err) {
    toast(friendlyError(err), true);
  }
});

window.addEventListener("hashchange", route);
boot();
