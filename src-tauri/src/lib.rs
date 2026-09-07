use tauri::Manager;

/// The Aria desktop shell.
///
/// It is an honest webview wrapper around the same deployed app the browser
/// uses — no duplicated logic, no second backend. `ARIA_URL` must identify the
/// trusted deployed app. If it is missing, the bundled fallback page remains
/// visible instead of silently navigating to an old or guessed deployment.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            if let Ok(raw_url) = std::env::var("ARIA_URL") {
                let url = raw_url.trim();
                if !url.is_empty() {
                    window.navigate(url.parse().expect("ARIA_URL must be a valid URL"))?;
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aria desktop");
}
