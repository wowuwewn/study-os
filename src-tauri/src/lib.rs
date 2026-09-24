use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

mod credential_store;
mod ical_sync;

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
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_study_os_schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "recurring_schedule_foundation",
            sql: include_str!("../migrations/002_recurring_schedule.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "ical_sync_foundation",
            sql: include_str!("../migrations/003_ical_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "ical_date_semantics_guards",
            sql: include_str!("../migrations/004_ical_date_guards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "ical_adapter_version",
            sql: include_str!("../migrations/005_ical_adapter_version.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "focus_intervals",
            sql: include_str!("../migrations/006_focus_intervals.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "atomic_focus_lifecycle",
            sql: include_str!("../migrations/007_atomic_focus_lifecycle.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(ical_sync::IcalSyncRuntime::default())
        .invoke_handler(tauri::generate_handler![
            ical_sync::ical_connection_status,
            ical_sync::connect_ical,
            ical_sync::disconnect_ical,
            ical_sync::sync_ical,
        ])
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
                    .visible(false)
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

            let main_window =
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

            let calendar_window =
                WebviewWindowBuilder::new(app, "calendar", WebviewUrl::App("index.html".into()))
                    .title("Study OS Calendar")
                    .inner_size(311.0, 433.0)
                    .resizable(false)
                    .decorations(false)
                    .always_on_top(false)
                    .transparent(true)
                    .visible(false)
                    .shadow(true)
                    .build()?;

            if let Some(monitor) = main_window.current_monitor()? {
                let main_position = main_window.outer_position()?;
                let main_size = main_window.outer_size()?;
                let scale = main_window.scale_factor()?;
                let gap = (16.0 * scale).round() as i32;
                let calendar_width = (311.0 * scale).round() as i32;
                let monitor_left = monitor.position().x;
                let monitor_right = monitor_left + monitor.size().width as i32;
                let right = main_position.x + main_size.width as i32 + gap;
                let x = if right + calendar_width <= monitor_right {
                    right
                } else {
                    (main_position.x - calendar_width - gap).max(monitor_left)
                };
                calendar_window.set_position(tauri::PhysicalPosition::new(x, main_position.y))?;
            } else {
                calendar_window.center()?;
            }
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

            if let Err(error) = app.global_shortcut().register(quick_add_shortcut()) {
                eprintln!("Quick Add global shortcut is unavailable: {error}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
