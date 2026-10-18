// Supabase 連線設定。這兩個值是「公開用」的，放在網頁裡是正常的：
// 真正的保護來自資料庫的權限規則（RLS）——沒登入、沒通過兩步驟驗證、或不是老闆的人，什麼都讀不到。
// 注意：絕對不要把 service_role 金鑰或資料庫密碼貼到這裡。
//
// 目前指向測試專案 crystal-dev（只放假資料）。正式上線前換成正式專案的值。
const CONFIG = {
  url: "https://ibgeewlgexqtpcwnubeo.supabase.co",
  key: "sb_publishable_JZ1as5H4ueXvZQlviPhwaw_meYaI6w1"
};
