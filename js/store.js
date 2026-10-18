/* 資料存取層：Supabase（登入、兩步驟驗證、資料庫、照片儲存）。
   畫面程式只呼叫 Store，不直接碰 Supabase。
   所有資料都受資料庫 RLS 保護：必須是 owner 且通過兩步驟驗證（aal2）才讀得到。 */
const Store = (function () {
  let sb = null;

  function client() {
    if (sb) return sb;
    if (typeof supabase === "undefined") throw new Error("無法載入登入元件，請檢查網路連線後重新整理");
    sb = supabase.createClient(CONFIG.url, CONFIG.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return sb;
  }
  const ok = ({ data, error }) => { if (error) throw error; return data; };

  return {
    /* ---- 登入與兩步驟驗證 ---- */
    async session() { return ok(await client().auth.getSession()).session; },

    async signIn(email, password) {
      const { error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw new FormError(error.message === "Invalid login credentials" ? "帳號或密碼不正確" : "登入失敗，請稍後再試");
    },
    signOut: () => client().auth.signOut(),

    /** "aal2" 代表已通過兩步驟驗證 */
    async assurance() {
      const d = ok(await client().auth.mfa.getAuthenticatorAssuranceLevel());
      return d.currentLevel;
    },
    /** 取得已驗證的 TOTP；沒有則清掉未完成的註冊並建立新的 */
    async mfaSetup() {
      const f = ok(await client().auth.mfa.listFactors());
      const verified = (f.totp || []).find((x) => x.status === "verified");
      if (verified) return { factorId: verified.id };
      for (const x of f.all || []) {
        if (x.status === "unverified") await client().auth.mfa.unenroll({ factorId: x.id });
      }
      const e = ok(await client().auth.mfa.enroll({ factorType: "totp", friendlyName: "authenticator" }));
      return { factorId: e.id, qr: e.totp.qr_code, secret: e.totp.secret };
    },
    async mfaVerify(factorId, code) {
      const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw new FormError("驗證碼不正確，請再試一次");
    },
    async isOwner() {
      const s = await this.session();
      if (!s) return false;
      const r = ok(await client().from("profiles").select("role").eq("id", s.user.id).maybeSingle());
      return !!r && r.role === "owner";
    },

    /* ---- 今日與報表 ---- */
    async daySummary(day) {
      return ok(await client().from("daily_summary").select("*").eq("day", day).maybeSingle());
    },
    async dailySummaries(limit = 31) {
      return ok(await client().from("daily_summary").select("*").order("day", { ascending: false }).limit(limit));
    },
    async pendingDelist() {
      return ok(await client().from("products").select("id,name,listed_channels")
        .eq("status", "sold").neq("listed_channels", "{}").order("updated_at", { ascending: false }).limit(30));
    },
    async clearListings(productId) {
      ok(await client().from("products").update({ listed_channels: [] }).eq("id", productId));
    },

    /* ---- 商品 ---- */
    async productsOnSale(keyword) {
      let q = client().from("products").select("id,name,sku,category,sale_price,stock_qty,is_unique")
        .eq("status", "on_sale").order("created_at", { ascending: false }).limit(50);
      const k = String(keyword || "").replace(/[,()%*\\]/g, "").trim().slice(0, 50);
      if (k) q = q.or(`name.ilike.%${k}%,sku.ilike.%${k}%`);
      return ok(await q);
    },
    async productsByStatus(status) {
      return ok(await client().from("products").select("id,name,sku,category,sale_price,cost,status,stock_qty,is_unique")
        .eq("status", status).order("created_at", { ascending: false }).limit(100));
    },
    async product(id) {
      return ok(await client().from("products").select("*").eq("id", id).maybeSingle());
    },
    async createProduct(row) {
      return ok(await client().from("products").insert(row).select("id").single()).id;
    },
    async updateProduct(id, patch) {
      ok(await client().from("products").update(patch).eq("id", id));
    },

    /* ---- 用料與照片 ---- */
    async productMaterials(productId) {
      return ok(await client().from("product_materials")
        .select("material_id,bead_qty,unit_cost_snapshot,materials(name,spec)").eq("product_id", productId));
    },
    async addProductMaterial(productId, materialId, qty) {
      ok(await client().from("product_materials").upsert(
        { product_id: productId, material_id: materialId, bead_qty: qty, unit_cost_snapshot: null },
        { onConflict: "product_id,material_id" }));
    },
    async removeProductMaterial(productId, materialId) {
      ok(await client().from("product_materials").delete().eq("product_id", productId).eq("material_id", materialId));
    },
    async media(productId) {
      const rows = ok(await client().from("product_media").select("id,storage_path,kind").eq("product_id", productId).order("sort_order"));
      if (!rows.length) return [];
      const signed = ok(await client().storage.from("product-media").createSignedUrls(rows.map((r) => r.storage_path), 3600));
      return rows.map((r) => ({ ...r, url: (signed.find((s) => s.path === r.storage_path) || {}).signedUrl })).filter((r) => r.url);
    },
    async uploadMedia(productId, file) {
      const allowed = { "image/jpeg": ["jpg", "image"], "image/png": ["png", "image"], "image/webp": ["webp", "image"], "video/mp4": ["mp4", "video"] };
      const info = allowed[file.type];
      if (!info) throw new FormError("只支援 JPG、PNG、WebP 圖片與 MP4 影片");
      if (file.size > 50 * 1024 * 1024) throw new FormError("檔案超過 50 MB");
      const path = `${productId}/${crypto.randomUUID()}.${info[0]}`;
      ok(await client().storage.from("product-media").upload(path, file, { contentType: file.type }));
      ok(await client().from("product_media").insert({ product_id: productId, storage_path: path, kind: info[1] }));
    },

    /* ---- 材料與進貨 ---- */
    async materials() {
      return ok(await client().from("materials").select("id,name,spec,stock_qty,avg_unit_cost").order("name"));
    },
    async createMaterial(name, spec) {
      ok(await client().from("materials").insert({ name, spec: spec || null }));
    },
    async purchases() {
      return ok(await client().from("purchases")
        .select("id,purchased_on,item_name,total_price,bead_count,unit_cost,suppliers(name)")
        .order("purchased_on", { ascending: false }).order("created_at", { ascending: false }).limit(30));
    },
    async createPurchase(row, supplierName) {
      let supplierId = null;
      if (supplierName) {
        const found = ok(await client().from("suppliers").select("id").eq("name", supplierName).limit(1));
        if (found.length) supplierId = found[0].id;
        else supplierId = ok(await client().from("suppliers").insert({ name: supplierName }).select("id").single()).id;
      }
      ok(await client().from("purchases").insert({ ...row, supplier_id: supplierId }));
    },

    /* ---- 費用 ---- */
    async expenses() {
      return ok(await client().from("expenses").select("id,spent_on,type,amount,note")
        .order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(30));
    },
    async createExpense(row) { ok(await client().from("expenses").insert(row)); },

    /* ---- 售出（單一資料庫交易，避免重複售出）---- */
    async services() {
      return ok(await client().from("services").select("id,name,default_price,price_min,price_max").eq("is_active", true));
    },
    async sell({ productId, price, payment, qty, packaging, serviceId, servicePrice, serviceGift }) {
      const orderId = ok(await client().rpc("sell_product", {
        p_product_id: productId, p_sale_price: price, p_payment_method: payment,
        p_customer_id: null, p_channel: "market", p_qty: qty, p_packaging_cost: packaging
      }));
      if (serviceId) {
        ok(await client().rpc("add_order_service", {
          p_order_id: orderId, p_service_id: serviceId, p_price: servicePrice, p_is_gift: serviceGift
        }));
      }
    }
  };
})();
