//! Unit tests for user registration, login, session tokens, and control-char validation.

use super::auth::{login, logout, register};
use super::Auth;
use crate::error::ApiError;
use crate::model::{new_id, LoginRequest, LoginResponse, RegisterRequest};
use crate::state::AppState;
use axum::extract::State;
use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use axum::Json;
use std::sync::Arc;

pub(super) fn test_state() -> Arc<AppState> {
    let tmp = std::env::temp_dir().join(format!("outbox-test-{}.json", new_id()));
    Arc::new(AppState::new(tmp))
}

#[tokio::test]
async fn test_register_and_login_flow() {
    let state = test_state();

    // 1. Invalid short password rejected
    let res = register(
        State(state.clone()),
        Json(RegisterRequest {
            username: "alice".into(),
            password: "short".into(),
        }),
    )
    .await;
    assert!(matches!(res, Err(ApiError::BadRequest(_))));

    // 2. Valid registration succeeds
    let res = register(
        State(state.clone()),
        Json(RegisterRequest {
            username: "alice".into(),
            password: "Password123!".into(),
        }),
    )
    .await
    .expect("registration should succeed");

    let reg_token = res.0.token;
    let user = res.0.user;
    assert_eq!(user.username, "alice");
    assert_eq!(reg_token.len(), 64);

    {
        let store = state.store.read().unwrap();
        let stored = store.users.get(&user.id).unwrap();
        assert!(!stored.password_hash.is_empty());
        assert!(!stored.password_salt.is_empty());
        assert_ne!(stored.password_hash, "Password123!");
        assert!(store.tokens.contains_key(&reg_token));
    }

    // 3. Duplicate registration rejected with Conflict
    let res = register(
        State(state.clone()),
        Json(RegisterRequest {
            username: "ALICE".into(),
            password: "Password456!".into(),
        }),
    )
    .await;
    assert!(matches!(res, Err(ApiError::Conflict(_))));

    // 4. Wrong password, non-existent user, and bot login all return 401
    for (uname, pwd) in [
        ("alice", "WrongPassword!"),
        ("nonexistent", "Password123!"),
        ("outbox-bot", "anypassword"),
    ] {
        let res = login(
            State(state.clone()),
            Json(LoginRequest {
                username: uname.into(),
                password: pwd.into(),
            }),
        )
        .await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // 5. Valid login issues independent multi-session token
    let res = login(
        State(state.clone()),
        Json(LoginRequest {
            username: "alice".into(),
            password: "Password123!".into(),
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let login_res: LoginResponse = serde_json::from_slice(&body_bytes).unwrap();
    let login_token = login_res.token;
    assert_eq!(login_token.len(), 64);
    assert_ne!(login_token, reg_token);

    // 6. Logout revokes only the presented token
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        format!("Bearer {login_token}").parse().unwrap(),
    );
    let res = logout(State(state.clone()), headers).await;
    assert_eq!(res.status(), StatusCode::OK);

    {
        let store = state.store.read().unwrap();
        assert!(!store.tokens.contains_key(&login_token));
        assert!(store.tokens.contains_key(&reg_token));
    }
}

#[tokio::test]
async fn test_control_character_rejection() {
    let state = test_state();
    for u in &["user\nname", "user\r\nname", "user\0name", "user\tname"] {
        let res = register(
            State(state.clone()),
            Json(RegisterRequest {
                username: u.to_string(),
                password: "Password123!".into(),
            }),
        )
        .await;
        assert!(matches!(res, Err(ApiError::BadRequest(_))));
    }
}

pub(super) fn auth_for(state: &AppState, user_id: &str) -> Auth {
    Auth(state.store.read().unwrap().users.get(user_id).unwrap().clone())
}
