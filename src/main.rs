mod crypto;
mod error;
mod handlers;
mod model;
mod state;
mod ws;

use axum::routing::{delete, get, patch, post};
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
        .route("/login", post(handlers::login))
        .route("/logout", post(handlers::logout))
        .route("/bootstrap", get(handlers::bootstrap))
        .route(
            "/users/@me/settings",
            get(handlers::get_settings).patch(handlers::update_settings),
        )
        .route(
            "/users/@me",
            get(handlers::get_me)
                .patch(handlers::update_profile)
                .delete(handlers::delete_account),
        )
        .route("/users/@me/password", post(handlers::change_password))
        .route("/users/@me/delete", post(handlers::delete_account))
        .route("/billing/plans", get(handlers::list_plans))
        .route("/billing/orders", get(handlers::list_my_orders))
        .route("/billing/checkout", post(handlers::create_checkout))
        .route("/billing/sandbox-complete", post(handlers::sandbox_complete))
        .route("/billing/webhook", post(handlers::stripe_webhook))
        .route("/billing/orders/{id}/sync", get(handlers::sync_order))
        .route("/admin/claim", post(handlers::claim_platform_admin))
        .route("/admin/overview", get(handlers::admin_overview))
        .route("/admin/users", get(handlers::admin_list_users))
        .route("/admin/users/{id}", patch(handlers::admin_update_user))
        .route("/admin/orders", get(handlers::admin_list_orders))
        .route(
            "/servers",
            get(handlers::list_servers).post(handlers::create_server),
        )
        .route("/servers/{id}", patch(handlers::update_server))
        .route("/servers/{id}/profile", patch(handlers::update_server_profile))
        .route(
            "/servers/{id}/members/{user_id}/role",
            patch(handlers::update_member_role),
        )
        .route(
            "/servers/{id}/members/{user_id}/kick",
            post(handlers::kick_member),
        )
        .route(
            "/servers/{id}/members/{user_id}/ban",
            post(handlers::ban_member),
        )
        .route(
            "/servers/{id}/members/{user_id}/timeout",
            post(handlers::timeout_member),
        )
        .route("/servers/{id}/bans", get(handlers::list_bans))
        .route(
            "/servers/{id}/bans/{user_id}",
            delete(handlers::unban_member),
        )
        .route("/servers/{id}/audit", get(handlers::list_audit_logs))
        .route("/friends", get(handlers::list_friends))
        .route("/friends/request", post(handlers::request_friend))
        .route("/friends/{user_id}/accept", post(handlers::accept_friend))
        .route("/friends/{user_id}", delete(handlers::remove_friend))
        .route("/dm/{user_id}", post(handlers::open_dm))
        .route("/servers/{id}/channels", post(handlers::create_channel))
        .route("/servers/{id}/join", post(handlers::join_server))
        .route("/servers/{id}/leave", post(handlers::leave_server))
        .route(
            "/servers/{id}/invites",
            get(handlers::list_invites).post(handlers::create_invite),
        )
        .route(
            "/invites/{code}",
            get(handlers::preview_invite).delete(handlers::delete_invite),
        )
        .route("/invites/{code}/join", post(handlers::join_by_invite))
        .route(
            "/channels/{id}",
            patch(handlers::update_channel).delete(handlers::delete_channel),
        )
        .route("/channels/{id}/media", get(handlers::list_channel_media))
        .route(
            "/channels/{id}/threads",
            get(handlers::list_threads).post(handlers::create_thread),
        )
        .route(
            "/threads/{id}/messages",
            get(handlers::list_thread_messages).post(handlers::post_thread_message),
        )
        .route(
            "/files",
            post(handlers::upload_file)
                .layer(axum::extract::DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route("/files/{id}", get(handlers::get_file))
        .route(
            "/channels/{id}/messages",
            get(handlers::list_messages).post(handlers::post_message),
        )
        .route("/channels/{id}/pins", get(handlers::list_pinned_messages))
        .route(
            "/messages/{id}",
            delete(handlers::delete_message).patch(handlers::edit_message),
        )
        .route("/messages/{id}/pin", post(handlers::toggle_pin_message))
        .route("/messages/{id}/reactions", post(handlers::toggle_reaction))
        .route("/servers/{id}/search", get(handlers::search_server_messages))
        .route(
            "/servers/{id}/stickers",
            get(handlers::list_stickers).post(handlers::create_sticker),
        )
        .route(
            "/servers/{id}/stickers/{sticker_id}",
            delete(handlers::delete_sticker),
        )
        .route("/links/preview", get(handlers::preview_link))
        .route("/channels/{id}/voice/join", post(handlers::voice_join))
        .route("/channels/{id}/voice/leave", post(handlers::voice_leave))
        .route("/rtc/ice", get(handlers::rtc_ice))
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
