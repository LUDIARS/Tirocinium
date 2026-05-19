// Tirocinium desktop Rust 側エントリ。
// Phase 1 では特別なネイティブ機能無し (UI のみ)。
// Phase 2 で音声 IO bridge (cpal + webrtc-vad) + ローカル DB (sqlite) を追加。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
