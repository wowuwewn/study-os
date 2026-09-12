use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use tauri::window::{Color, Effect, EffectsBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let pip_builder = WebviewWindowBuilder::new(
                app,
                "pip",
                WebviewUrl::App("index.html".into()),
            )
            .title("Study OS Quest")
            .inner_size(292.0, 258.0)
            .min_inner_size(292.0, 258.0)
            .max_inner_size(292.0, 258.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .transparent(true)
            .shadow(true)
            .center();

            #[cfg(target_os = "windows")]
            let pip_builder = pip_builder.effects(
                EffectsBuilder::new()
                    .effect(Effect::Acrylic)
                    .color(Color(38, 53, 68, 170))
                    .build(),
            );

            pip_builder.build()?;

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Study OS")
            .inner_size(860.0, 720.0)
            .min_inner_size(760.0, 640.0)
            .resizable(true)
            .decorations(false)
            .always_on_top(false)
            .visible(true)
            .shadow(true)
            .center()
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
