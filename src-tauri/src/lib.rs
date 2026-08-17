use tauri::Manager;

/// The Aria desktop shell.
///
/// It is an honest webview wrapper around the same deployed app the browser
/// uses — no duplicated logic, no second backend. The window opens directly
/// on the Aria app; `ARIA_URL` overrides the default (useful for staging).
/// Desktop-only capabilities that a browser can't have (local filesystem
/// access, custom protocol handlers) can be added here later without touching
/// the web app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let url = std::env::var("ARIA_URL")
                .unwrap_or_else(|_| "https://steady-scorpion-839.convex.site".to_string());
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");
            window
                .navigate(url.parse().expect("ARIA_URL must be a valid URL"))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aria desktop");
}
