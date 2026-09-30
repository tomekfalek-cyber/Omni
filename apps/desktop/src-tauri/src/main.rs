#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
    WindowBuilder,
};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{SinkExt, StreamExt};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize, Deserialize)]
struct GatewayConfig {
    url: String,
    token: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct WsMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    full_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct AppState {
    gateway_config: Arc<Mutex<GatewayConfig>>,
    ws_connected: Arc<Mutex<bool>>,
}

#[tauri::command]
async fn connect_to_gateway(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    url: String,
    token: String,
) -> Result<(), String> {
    let config = GatewayConfig {
        url: url.clone(),
        token: token.clone(),
    };

    {
        let mut config_lock = state.gateway_config.lock().unwrap();
        *config_lock = config;
    }

    // Połączenie WebSocket w osobnym wątku
    let app_clone = app.clone();
    let token_clone = token.clone();
    let ws_connected = state.ws_connected.clone();

    tokio::spawn(async move {
        let ws_url = format!("{}/ws", url);
        
        match connect_async(&ws_url).await {
            Ok((mut ws_stream, _)) => {
                println!("✅ Połączono z Gateway: {}", ws_url);
                
                {
                    let mut connected = ws_connected.lock().unwrap();
                    *connected = true;
                }

                // Wysyłanie autoryzacji
                let auth_msg = serde_json::json!({
                    "type": "auth",
                    "token": token_clone,
                    "userId": "desktop-user"
                });
                
                if let Err(e) = ws_stream.send(Message::Text(auth_msg.to_string())).await {
                    eprintln!("❌ Błąd wysyłania auth: {}", e);
                    return;
                }

                // Nasłuchiwanie wiadomości
                while let Some(msg) = ws_stream.next().await {
                    match msg {
                        Ok(Message::Text(text)) => {
                            if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                                // Emitowanie zdarzenia do frontendu
                                app_clone.emit_all("ws_message", &ws_msg).unwrap();
                            }
                        }
                        Ok(Message::Close(_)) => {
                            println!("🔌 Połączenie WebSocket zamknięte");
                            {
                                let mut connected = ws_connected.lock().unwrap();
                                *connected = false;
                            }
                            break;
                        }
                        Err(e) => {
                            eprintln!("❌ Błąd WebSocket: {}", e);
                            {
                                let mut connected = ws_connected.lock().unwrap();
                                *connected = false;
                            }
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Nie udało się połączyć z Gateway: {}", e);
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn send_chat_message(
    state: tauri::State<'_, AppState>,
    message: String,
) -> Result<(), String> {
    let config = state.gateway_config.lock().unwrap().clone();
    
    // W pełnej implementacji: trzymamy referencję do WebSocket stream
    // Na potrzeby tego kodu: wysyłamy przez HTTP (uproszczenie)
    let client = reqwest::Client::new();
    
    let payload = serde_json::json!({
        "type": "chat.send",
        "message": message
    });

    // W rzeczywistości: wysyłamy przez WebSocket, nie HTTP
    // To jest placeholder - pełna implementacja wymaga przechowywania ws_stream w AppState
    
    Ok(())
}

#[tauri::command]
fn get_gateway_config(state: tauri::State<'_, AppState>) -> GatewayConfig {
    state.gateway_config.lock().unwrap().clone()
}

#[tauri::command]
fn is_ws_connected(state: tauri::State<'_, AppState>) -> bool {
    *state.ws_connected.lock().unwrap()
}

fn main() {
    let system_tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show".to_string(), "Pokaż Omni"))
        .add_item(CustomMenuItem::new("hide".to_string(), "Ukryj"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit".to_string(), "Zakończ"));

    let system_tray = SystemTray::new().with_menu(system_tray_menu);

    tauri::Builder::default()
        .manage(AppState {
            gateway_config: Arc::new(Mutex::new(GatewayConfig {
                url: "ws://localhost:7800".to_string(),
                token: "change-me".to_string(),
            })),
            ws_connected: Arc::new(Mutex::new(false)),
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_window("main") {
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_window("main") {
                        window.hide().unwrap();
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            connect_to_gateway,
            send_chat_message,
            get_gateway_config,
            is_ws_connected
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
