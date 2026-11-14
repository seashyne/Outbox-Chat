mod error;
mod handlers;
mod model;
mod state;
mod ws;

use axum::routing::{delete, get, post};
use axum::Router;
use state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let web_dir = std::env::var("WEB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("web"));
    let data_path =
        PathBuf::from(std::env::var("DATA_PATH").unwrap_or_else(|_| "data/store.json".to_string()));

    let state = Arc::new(AppState::new(data_path.clone()));
    state.persist(); // materialize the seeded database on first launch

    let api = Router::new()
        .route("/health", get(handlers::health))
        .route("/register", post(handlers::register))
        .route("/bootstrap", get(handlers::bootstrap))
        .route(
            "/servers",
            get(handlers::list_servers).post(handlers::create_server),
        )
        .route("/servers/{id}/channels", post(handlers::create_channel))
        .route("/servers/{id}/join", post(handlers::join_server))
        .route(
            "/channels/{id}/messages",
            get(handlers::list_messages).post(handlers::post_message),
        )
        .route("/messages/{id}", delete(handlers::delete_message))
        .route("/messages/{id}/reactions", post(handlers::toggle_reaction))
        .route("/channels/{id}/voice/join", post(handlers::voice_join))
        .route("/channels/{id}/voice/leave", post(handlers::voice_leave))
        .route("/ws", get(ws::ws_handler));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(&web_dir).append_index_html_on_directories(true))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    println!();
    println!("  Outbox Chat");
    println!("  เปิดได้ที่  http://localhost:{port}");
    println!();

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
}

async fn shutdown_signal() {
    if tokio::signal::ctrl_c().await.is_ok() {
        println!("\n  Shutting down Outbox Chat. Bye!");
    }
}
