/* 各頁面的畫面（只負責組出 HTML，所有插入的資料都會自動跳脫）。
   路由：#/  #/sell  #/sell/<id>  #/products  #/products/new  #/products/<id>
         #/purchases  #/materials  #/expenses  #/report */

const opts = (map, selected) =>
  Object.entries(map).map(([k, v]) => html`<option value="${k}" ${k === selected ? raw("selected") : ""}>${v}</option>`);

const channelBoxes = (checked = []) =>
  Object.entries(LABELS.channel).map(([k, v]) =>
    html`<label class="check"><input type="checkbox" name="channels" value="${k}" ${checked.includes(k) ? raw("checked") : ""}> ${v}</label>`);

const Pages = {
  async home() {
    const today = todayTaipei();
    const [s0, pending] = await Promise.all([Store.daySummary(today), Store.pendingDelist()]);
    const s = s0 || { revenue: 0, cogs: 0, booth_fee: 0, packaging_cost: 0, other_cost: 0, net_profit: 0, order_count: 0 };
    return html`
      <section class="card">
        <h1>今日（${today}）</h1>
        <dl class="kv">
          <dt>營收（${s.order_count} 筆）</dt><dd>${money(s.revenue)}</dd>
          <dt>商品成本</dt><dd>${money(s.cogs)}</dd>
          <dt>攤位費／包材／其他</dt><dd>${money(Number(s.booth_fee) + Number(s.packaging_cost) + Number(s.other_cost))}</dd>
          <dt class="strong">純利潤</dt><dd class="strong">${money(s.net_profit)}</dd>
        </dl>
      </section>
      <section class="grid2">
        <a class="btn" href="#/sell">快速售出</a>
        <a class="btn btn-ghost" href="#/products/new">新增商品</a>
        <a class="btn btn-ghost" href="#/purchases">進貨登記</a>
        <a class="btn btn-ghost" href="#/expenses">記攤位費</a>
      </section>
      <section class="card">
        <h2>待處理：請到其他平台下架（${pending.length}）</h2>
        ${pending.length ? "" : html`<p class="muted">目前沒有待下架的商品。</p>`}
        <ul class="list">
          ${pending.map((p) => html`
            <li class="row">
              <div><p class="name">${p.name}</p>
                <p class="muted small">${p.listed_channels.map((c) => LABELS.channel[c] || c).join("、")}</p></div>
              <button class="btn btn-ghost" data-do="clearListings" data-id="${p.id}">已下架</button>
            </li>`)}
        </ul>
      </section>`;
  },

  async sell(params) {
    const q = params.get("q") || "";
    const products = await Store.productsOnSale(q);
    return html`
      <h1>快速售出</h1>
      <form class="search" data-action="search" data-route="/sell">
        <input class="input" name="q" value="${q}" placeholder="搜尋商品名稱或編號" maxlength="50">
        <button class="btn">搜尋</button>
      </form>
      ${products.length ? "" : html`<p class="muted">找不到在售商品。</p>`}
      <ul class="list">
        ${products.map((p) => html`
          <li><a class="card row" href="#/sell/${p.id}">
            <div><p class="name">${p.name}</p>
              <p class="muted small">${LABELS.category[p.category] || p.category}${p.sku ? "・" + p.sku : ""}${p.is_unique ? "" : "・庫存 " + p.stock_qty}</p></div>
            <span class="strong">${money(p.sale_price)}</span>
          </a></li>`)}
      </ul>`;
  },

  async sellDetail(id) {
    const [p, services] = await Promise.all([Store.product(id), Store.services()]);
    if (!p) return html`<p class="card">找不到這件商品。</p>`;
    const sellable = p.status === "on_sale";
    const others = p.listed_channels.filter((c) => c !== "market");
    return html`
      <h1>${p.name}</h1>
      <p class="muted">標價 ${money(p.sale_price)}・成本 ${money(p.cost)}${p.original_price ? "・原價 " + money(p.original_price) : ""}</p>
      ${sellable ? "" : html`<p class="card warn">這件商品目前不是「在售」狀態，無法售出。</p>`}
      ${others.length ? html`<p class="card small">提醒：這件商品也上架在 ${others.map((c) => LABELS.channel[c] || c).join("、")}，售出後請記得下架。</p>` : ""}
      ${sellable ? html`
      <form class="card stack" data-action="sell">
        <input type="hidden" name="product_id" value="${p.id}">
        <div><label class="label" for="sale_price">實售價</label>
          <input class="input" id="sale_price" name="sale_price" type="number" inputmode="decimal" min="0" step="1" value="${Number(p.sale_price)}" required></div>
        ${p.is_unique ? "" : html`<div><label class="label" for="qty">數量（庫存 ${p.stock_qty}）</label>
          <input class="input" id="qty" name="qty" type="number" inputmode="numeric" min="1" max="${p.stock_qty}" value="1"></div>`}
        <div><label class="label" for="payment_method">付款方式</label>
          <select class="input" id="payment_method" name="payment_method">${opts(LABELS.payment, "cash")}</select></div>
        <div><label class="label" for="packaging_cost">包材成本（這筆）</label>
          <input class="input" id="packaging_cost" name="packaging_cost" type="number" inputmode="decimal" min="0" value="0"></div>
        <fieldset class="stack top-line">
          <legend class="label">加購／贈送服務（選填）</legend>
          <select class="input" name="service_id" aria-label="服務">
            <option value="">不加服務</option>
            ${services.map((s) => html`<option value="${s.id}">${s.name}（${Number(s.price_min) === Number(s.price_max) ? money(s.default_price) : money(s.price_min) + "–" + money(s.price_max)}）</option>`)}
          </select>
          <input class="input" name="service_price" type="number" inputmode="decimal" min="0" value="100" aria-label="服務價格">
          <label class="check"><input type="checkbox" name="service_gift" checked> 贈送（不計營收）</label>
        </fieldset>
        <button class="btn">確認售出</button>
      </form>` : ""}`;
  },

  async products(params) {
    const status = LABELS.status[params.get("status")] ? params.get("status") : "on_sale";
    const list = await Store.productsByStatus(status);
    return html`
      <div class="row"><h1>商品</h1><a class="btn" href="#/products/new">新增商品</a></div>
      <div class="chips">
        ${Object.entries(LABELS.status).map(([k, v]) => html`<a class="btn ${k === status ? "" : "btn-ghost"}" href="#/products?status=${k}">${v}</a>`)}
      </div>
      ${list.length ? "" : html`<p class="muted">這個狀態沒有商品。</p>`}
      <ul class="list">
        ${list.map((p) => html`
          <li><a class="card row" href="#/products/${p.id}">
            <div><p class="name">${p.name}</p>
              <p class="muted small">${LABELS.category[p.category] || p.category}・成本 ${money(p.cost)}${p.is_unique ? "" : "・庫存 " + p.stock_qty}</p></div>
            <span class="strong">${money(p.sale_price)}</span>
          </a></li>`)}
      </ul>`;
  },

  async productNew() {
    return html`
      <h1>新增商品</h1>
      <form class="card stack" data-action="createProduct">
        <div><label class="label" for="name">名稱</label><input class="input" id="name" name="name" required maxlength="100"></div>
        <div class="grid2">
          <div><label class="label" for="category">類別</label><select class="input" id="category" name="category">${opts(LABELS.category, "bracelet")}</select></div>
          <div><label class="label" for="sku">商品編號（選填）</label><input class="input" id="sku" name="sku" maxlength="40"></div>
        </div>
        <label class="check"><input type="checkbox" name="is_unique" checked> 獨一無二（只有這一件）</label>
        <div><label class="label" for="stock_qty">數量（同款可多件時填寫）</label><input class="input" id="stock_qty" name="stock_qty" type="number" min="1" value="1"></div>
        <div class="grid2">
          <div><label class="label" for="sale_price">標價</label><input class="input" id="sale_price" name="sale_price" type="number" min="0" required></div>
          <div><label class="label" for="original_price">原價（折價出清用，選填）</label><input class="input" id="original_price" name="original_price" type="number" min="0"></div>
        </div>
        <div><label class="label" for="other_cost">其他成本（非珠子的成本，或既有商品的總成本；珠子用料請建立後在商品頁加入）</label>
          <input class="input" id="other_cost" name="other_cost" type="number" min="0" value="0"></div>
        <fieldset><legend class="label">上架在哪些通路</legend><div class="checks">${channelBoxes(["market"])}</div></fieldset>
        <div><label class="label" for="description">備註（選填）</label><textarea class="input" id="description" name="description" rows="3" maxlength="1000"></textarea></div>
        <button class="btn">建立商品</button>
      </form>`;
  },

  async productDetail(id) {
    const [p, used, materials, media] = await Promise.all([
      Store.product(id), Store.productMaterials(id), Store.materials(), Store.media(id)
    ]);
    if (!p) return html`<p class="card">找不到這件商品。</p>`;
    const beadCost = used.reduce((t, u) => t + Number(u.bead_qty) * Number(u.unit_cost_snapshot || 0), 0);
    const statusOpts = Object.fromEntries(Object.entries(LABELS.status)
      .filter(([k]) => ["on_sale", "keep", "offline"].includes(k) || k === p.status));
    return html`
      <h1>${p.name}</h1>
      <p class="muted">${LABELS.category[p.category] || p.category}・成本 ${money(p.cost)}（珠子 ${money(beadCost)} + 其他 ${money(p.other_cost)}）</p>

      <section class="card stack">
        <h2>照片與影片</h2>
        ${media.length ? html`<div class="media">${media.map((m) => m.kind === "video"
          ? html`<video src="${m.url}" controls preload="metadata"></video>`
          : html`<img src="${m.url}" alt="${p.name}">`)}</div>` : html`<p class="muted">尚未上傳。</p>`}
        <label class="btn btn-ghost">新增照片／影片
          <input type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4" data-upload="${p.id}">
        </label>
      </section>

      <section class="card stack">
        <h2>用料（珠子）</h2>
        ${used.length ? "" : html`<p class="muted">尚未記錄用料。</p>`}
        <ul class="list">
          ${used.map((u) => html`
            <li class="row small"><span>${(u.materials || {}).name}${(u.materials || {}).spec ? "（" + u.materials.spec + "）" : ""} × ${u.bead_qty} 顆
              <span class="muted">　每顆 ${money(u.unit_cost_snapshot)}</span></span>
              <button class="link danger" data-do="removeMaterial" data-id="${p.id}" data-material="${u.material_id}">移除</button></li>`)}
        </ul>
        <form class="addrow" data-action="addMaterial">
          <input type="hidden" name="product_id" value="${p.id}">
          <div><label class="label" for="material_id">珠子</label>
            <select class="input" id="material_id" name="material_id" required>
              <option value="">選擇珠子</option>
              ${materials.map((m) => html`<option value="${m.id}">${m.name}${m.spec ? "（" + m.spec + "）" : ""}・庫存 ${m.stock_qty}</option>`)}
            </select></div>
          <div><label class="label" for="bead_qty">顆數</label><input class="input" id="bead_qty" name="bead_qty" type="number" min="1" required></div>
          <button class="btn">加入</button>
        </form>
      </section>

      <form class="card stack" data-action="updateProduct">
        <h2>基本資料與價格</h2>
        <input type="hidden" name="id" value="${p.id}">
        <div><label class="label" for="name">名稱</label><input class="input" id="name" name="name" value="${p.name}" required maxlength="100"></div>
        <div class="grid2">
          <div><label class="label" for="sale_price">標價</label><input class="input" id="sale_price" name="sale_price" type="number" min="0" value="${Number(p.sale_price)}" required></div>
          <div><label class="label" for="original_price">原價</label><input class="input" id="original_price" name="original_price" type="number" min="0" value="${p.original_price ?? ""}"></div>
        </div>
        <div><label class="label" for="other_cost">其他成本</label><input class="input" id="other_cost" name="other_cost" type="number" min="0" value="${Number(p.other_cost)}"></div>
        <div><label class="label" for="status">狀態</label><select class="input" id="status" name="status">${opts(statusOpts, p.status)}</select></div>
        <fieldset><legend class="label">上架在哪些通路</legend><div class="checks">${channelBoxes(p.listed_channels)}</div></fieldset>
        <div><label class="label" for="description">備註</label><textarea class="input" id="description" name="description" rows="3" maxlength="1000">${p.description || ""}</textarea></div>
        <button class="btn">儲存</button>
      </form>`;
  },

  async materials() {
    const list = await Store.materials();
    return html`
      <h1>珠子材料（僅自己可見）</h1>
      <form class="card addrow" data-action="createMaterial">
        <div><label class="label" for="name">珠子名稱</label><input class="input" id="name" name="name" required maxlength="100" placeholder="例：白水晶"></div>
        <div><label class="label" for="spec">規格</label><input class="input" id="spec" name="spec" maxlength="100" placeholder="例：8mm"></div>
        <button class="btn">新增</button>
      </form>
      ${list.length ? "" : html`<p class="muted">尚未建立材料。</p>`}
      <ul class="list">
        ${list.map((m) => html`
          <li class="card row"><div><p class="name">${m.name}${m.spec ? "（" + m.spec + "）" : ""}</p>
            <p class="muted small">平均每顆 ${money(m.avg_unit_cost)}</p></div>
            <span class="strong ${m.stock_qty < 0 ? "danger" : ""}">${m.stock_qty} 顆</span></li>`)}
      </ul>
      <p class="muted small">庫存為負數代表用了尚未登記進貨的舊珠子，補登進貨後會自動修正。</p>`;
  },

  async purchases() {
    const [materials, list] = await Promise.all([Store.materials(), Store.purchases()]);
    return html`
      <div class="row"><h1>進貨登記</h1><a class="btn btn-ghost" href="#/materials">珠子材料庫存</a></div>
      <form class="card stack" data-action="createPurchase">
        <div class="grid2">
          <div><label class="label" for="purchased_on">進貨日期</label><input class="input" id="purchased_on" name="purchased_on" type="date" value="${todayTaipei()}"></div>
          <div><label class="label" for="supplier_name">供應商</label><input class="input" id="supplier_name" name="supplier_name" maxlength="100"></div>
        </div>
        <div><label class="label" for="item_name">品名</label><input class="input" id="item_name" name="item_name" required maxlength="100" placeholder="例：白水晶 8mm 一條"></div>
        <div><label class="label" for="material_id">對應的珠子材料（要記庫存與每顆成本時選擇）</label>
          <select class="input" id="material_id" name="material_id">
            <option value="">不對應（原礦、擺件等直接轉售）</option>
            ${materials.map((m) => html`<option value="${m.id}">${m.name}${m.spec ? "（" + m.spec + "）" : ""}</option>`)}
          </select></div>
        <div class="grid3">
          <div><label class="label" for="total_price">總價</label><input class="input" id="total_price" name="total_price" type="number" min="0" step="0.01" required></div>
          <div><label class="label" for="bead_count">總顆數</label><input class="input" id="bead_count" name="bead_count" type="number" min="1"></div>
          <div><label class="label" for="weight_g">克重</label><input class="input" id="weight_g" name="weight_g" type="number" min="0" step="0.01"></div>
        </div>
        <button class="btn">登記進貨</button>
      </form>
      <ul class="list">
        ${list.map((p) => html`
          <li class="card small"><div class="row"><span class="name">${p.item_name}</span><span>${money(p.total_price)}</span></div>
            <p class="muted small">${p.purchased_on}${p.suppliers ? "・" + p.suppliers.name : ""}${p.bead_count ? "・" + p.bead_count + " 顆・每顆 " + money(p.unit_cost) : ""}</p></li>`)}
      </ul>`;
  },

  async expenses() {
    const list = await Store.expenses();
    return html`
      <h1>費用（攤位費等）</h1>
      <p class="muted">每次擺攤記一筆攤位費。包材會在「售出」時一併記錄。</p>
      <form class="card stack" data-action="createExpense">
        <div class="grid2">
          <div><label class="label" for="spent_on">日期</label><input class="input" id="spent_on" name="spent_on" type="date" value="${todayTaipei()}"></div>
          <div><label class="label" for="type">類別</label><select class="input" id="type" name="type">${opts(LABELS.expense, "booth")}</select></div>
        </div>
        <div class="grid2">
          <div><label class="label" for="amount">金額</label><input class="input" id="amount" name="amount" type="number" min="0" required></div>
          <div><label class="label" for="note">備註</label><input class="input" id="note" name="note" maxlength="200" placeholder="例：週末市集"></div>
        </div>
        <button class="btn">新增費用</button>
      </form>
      <ul class="list">
        ${list.map((e) => html`<li class="card row small"><span>${e.spent_on}・${LABELS.expense[e.type] || e.type}${e.note ? "・" + e.note : ""}</span><span class="strong">${money(e.amount)}</span></li>`)}
      </ul>`;
  },

  async report() {
    const days = await Store.dailySummaries(31);
    const t = days.reduce((a, d) => ({
      revenue: a.revenue + Number(d.revenue), cogs: a.cogs + Number(d.cogs),
      fees: a.fees + Number(d.booth_fee) + Number(d.packaging_cost) + Number(d.other_cost), net: a.net + Number(d.net_profit)
    }), { revenue: 0, cogs: 0, fees: 0, net: 0 });
    return html`
      <div class="row"><h1>營收與毛利</h1><a class="btn btn-ghost" href="#/expenses">費用</a></div>
      <p class="muted small">近 31 天內有紀錄的日子</p>
      <section class="card"><dl class="kv">
        <dt>營收</dt><dd>${money(t.revenue)}</dd>
        <dt>商品成本</dt><dd>${money(t.cogs)}</dd>
        <dt>攤位費／包材／其他</dt><dd>${money(t.fees)}</dd>
        <dt class="strong">純利潤</dt><dd class="strong">${money(t.net)}</dd>
      </dl></section>
      <p class="muted small">純利潤 = 營收 − 商品成本 − 攤位費 − 包材。贈送的服務不計營收。</p>
      <div class="scroll-x"><table class="table">
        <thead><tr><th>日期</th><th>營收</th><th>成本</th><th>費用</th><th>純利潤</th></tr></thead>
        <tbody>${days.map((d) => html`<tr><td>${d.day}</td><td>${money(d.revenue)}</td><td>${money(d.cogs)}</td>
          <td>${money(Number(d.booth_fee) + Number(d.packaging_cost) + Number(d.other_cost))}</td><td class="strong">${money(d.net_profit)}</td></tr>`)}</tbody>
      </table></div>`;
  }
};
