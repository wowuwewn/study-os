use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use tauri::window::{Color, Effect, EffectsBuilder};

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let pip_builder =
                WebviewWindowBuilder::new(app, "pip", WebviewUrl::App("index.html".into()))
                    .title("Study OS Quest")
                    .inner_size(312.0, 116.0)
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
                    .color(Color(45, 64, 81, 170))
                    .build(),
            );

            pip_builder.build()?;

            let pet_window =
                WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html".into()))
                    .title("Study OS Pet")
                    .inner_size(56.0, 56.0)
                    .resizable(false)
                    .decorations(false)
                    .always_on_top(true)
                    .transparent(true)
                    .shadow(false)
                    .skip_taskbar(true)
                    .visible(false)
                    .center()
                    .build()?;

            // Win32 otherwise enforces a minimum tracking width on this borderless
            // window. Force the physical size that corresponds to 56 logical px.
            #[cfg(target_os = "windows")]
            unsafe {
                let scale = pet_window.scale_factor()?;
                let physical_size = (56.0 * scale).round() as i32;
                SetWindowPos(
                    pet_window.hwnd()?,
                    None,
                    0,
                    0,
                    physical_size,
                    physical_size,
                    SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                )?;
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Study OS")
                .inner_size(855.0, 760.0)
                .min_inner_size(855.0, 760.0)
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
