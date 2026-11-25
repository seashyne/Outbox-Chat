//! Account security and lifecycle handlers: `@me` summary, password change,
//! account deletion, email validation, and platform admin claim.

use super::auth::clean_password;
use super::Auth;
use crate::crypto::{constant_time_eq_str, hash_password, random_salt_hex, verify_password};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_token, AdminClaimRequest, ChangePasswordRequest, DeleteAccountRequest, Event, Role,
};
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use std::sync::Arc;

/// Validates optional email format cleanly; empty string clears email to `None`.
pub(crate) fn validate_email(raw: &str) -> ApiResult<Option<String>> {
    if raw.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest("email cannot contain control characters".into()));
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let len = trimmed.chars().count();
    let (local, domain) = trimmed
        .split_once('@')
        .ok_or_else(|| ApiError::BadRequest("invalid email address".into()))?;
    if len > 120
        || local.is_empty()
        || domain.len() < 3
        || !domain.contains('.')
        || trimmed
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\''))
    {
        return Err(ApiError::BadRequest("invalid email address".into()));
    }
    Ok(Some(trimmed.to_ascii_lowercase()))
}

/// Returns the caller's public user profile alongside private account & plan details.
pub async fn get_me(Auth(user): Auth) -> ApiResult<Json<serde_json::Value>> {
    Ok(Json(serde_json::json!({
        "user": user.public(),
        "account": user.account_summary(),
    })))
}

/// Verifies current password, sets a new PBKDF2 password, and rotates session tokens.
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<ChangePasswordRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    clean_password(&body.new_password)?;
    let (new_tok, public, account) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let stored = store.users.get(&user.id).ok_or(ApiError::NotFound("user"))?;
        if stored.bot || !verify_password(&body.current_password, &stored.password_salt, &stored.password_hash) {
            return Err(ApiError::Forbidden("current password is incorrect"));
        }
        let salt = random_salt_hex();
        let hash = hash_password(&body.new_password, &salt).map_err(|_| ApiError::Internal)?;
        let tok = new_token();
        store.tokens.retain(|_, uid| uid != &user.id);
        store.tokens.insert(tok.clone(), user.id.clone());

        let u = store.users.get_mut(&user.id).ok_or(ApiError::NotFound("user"))?;
        u.password_salt = salt;
        u.password_hash = hash;
        u.token = tok.clone();
        (tok, u.public(), u.account_summary())
    };
    state.persist();
    Ok(Json(serde_json::json!({
        "token": new_tok,
        "user": public,
        "account": account,
    })))
}

/// Permanently deletes the caller's account after password confirmation.
pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    body: Option<Json<DeleteAccountRequest>>,
) -> ApiResult<StatusCode> {
    let password = body
        .map(|Json(b)| b.password)
        .unwrap_or_default();
    if user.bot || user.id == "outbox-bot" {
        return Err(ApiError::Forbidden("cannot delete bot account"));
    }
    let leave_events = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let stored = store.users.get(&user.id).ok_or(ApiError::NotFound("user"))?;
        if !verify_password(&password, &stored.password_salt, &stored.password_hash) {
            return Err(ApiError::Forbidden("password confirmation is incorrect"));
        }
        store.tokens.retain(|_, uid| uid != &user.id);
        store.friends.retain(|_, e| e.from_id != user.id && e.to_id != user.id);

        let mut events = Vec::new();
        let owned_ids: Vec<String> = store
            .servers
            .values()
            .filter(|s| s.owner_id == user.id)
            .map(|s| s.id.clone())
            .collect();
        for sid in owned_ids {
            let successor = store.members.get(&sid).and_then(|m| {
                m.iter()
                    .find(|(uid, r)| *uid != &user.id && **r == Role::Admin)
                    .or_else(|| m.iter().find(|(uid, _)| *uid != &user.id))
                    .map(|(uid, _)| uid.clone())
            });
            if let Some(next_owner) = successor {
                if let Some(srv) = store.servers.get_mut(&sid) {
                    srv.owner_id = next_owner.clone();
                }
                if let Some(m) = store.members.get_mut(&sid) {
                    m.insert(next_owner, Role::Owner);
                }
            } else {
                store.servers.remove(&sid);
                store.members.remove(&sid);
                let cids: Vec<String> = store
                    .channels
                    .values()
                    .filter(|c| c.server_id == sid)
                    .map(|c| c.id.clone())
                    .collect();
                for cid in cids {
                    store.channels.remove(&cid);
                    if let Some(msgs) = store.messages.remove(&cid) {
                        for msg in msgs {
                            store.message_index.remove(&msg.id);
                        }
                    }
                }
            }
        }
        for (sid, m) in store.members.iter_mut() {
            if m.remove(&user.id).is_some() {
                events.push(Event::MemberLeave {
                    server_id: sid.clone(),
                    user_id: user.id.clone(),
                });
            }
        }
        for bans in store.bans.values_mut() {
            bans.remove(&user.id);
        }
        store.timeouts.retain(|k, _| !k.ends_with(&format!(":{}", user.id)));
        store.users.remove(&user.id);
        events
    };
    state.leave_all_voice(&user.id);
    state.persist();
    for ev in leave_events {
        state.emit(ev);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Promotes the authenticated user to platform admin using server secret `ADMIN_CLAIM_SECRET`.
pub async fn claim_platform_admin(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<AdminClaimRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let expected = std::env::var("ADMIN_CLAIM_SECRET").unwrap_or_default();
    if expected.is_empty() || !constant_time_eq_str(body.secret.trim(), expected.trim()) {
        return Err(ApiError::Forbidden("invalid admin claim secret"));
    }
    let (public, account) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let u = store.users.get_mut(&user.id).ok_or(ApiError::NotFound("user"))?;
        u.platform_admin = true;
        (u.public(), u.account_summary())
    };
    state.persist();
    Ok(Json(serde_json::json!({
        "user": public,
        "account": account,
    })))
}
