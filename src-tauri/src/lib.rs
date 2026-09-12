use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg(target_os = "windows")]
use tauri::window::{Color, Effect, EffectsBuilder};

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER,
};

const QUICK_ADD_WINDOW_LABEL: &str = "quick-add";
const QUICK_ADD_OPENED_EVENT: &str = "study-os-quick-add-opened";

fn quick_add_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial_study_os_schema",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed || *shortcut != quick_add_shortcut()
                    {
                        return;
                    }
                    if let Some(window) = app.get_webview_window(QUICK_ADD_WINDOW_LABEL) {
                        let _ = window.unminimize();
                        let _ = window.center();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit(QUICK_ADD_OPENED_EVENT, ());
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:study-os.db", migrations)
                .build(),
        )
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

            WebviewWindowBuilder::new(
                app,
                QUICK_ADD_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("Study OS Quick Add")
            .inner_size(810.0, 126.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .transparent(true)
            .skip_taskbar(true)
            .visible(false)
            .shadow(true)
            .center()
            .build()?;

            app.global_shortcut().register(quick_add_shortcut())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
