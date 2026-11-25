//! Platform-wide owner/admin management handlers: overview metrics,
//! user plan/suspension administration, and billing orders view.

use super::Auth;
use crate::error::{ApiError, ApiResult};
use crate::model::{AdminUpdateUserRequest, Event, User};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{Duration, SecondsFormat, Utc};
use serde::Deserialize;
use std::sync::Arc;

fn require_platform_admin(user: &User) -> ApiResult<()> {
    if !user.platform_admin {
        return Err(ApiError::Forbidden("platform administrator privileges required"));
    }
    Ok(())
}

/// Returns platform totals, subscription breakdown, revenue, and Stripe status.
pub async fn admin_overview(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
) -> ApiResult<Json<serde_json::Value>> {
    require_platform_admin(&actor)?;
    let stripe_configured = std::env::var("STRIPE_SECRET_KEY")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let store = state.store.read().map_err(|_| ApiError::Internal)?;

    let human_users: Vec<&User> = store.users.values().filter(|u| !u.bot).collect();
    let plus_users = human_users.iter().filter(|u| u.active_plan() == "plus").count();
    let pro_users = human_users.iter().filter(|u| u.active_plan() == "pro").count();
    let suspended_users = human_users.iter().filter(|u| u.suspended).count();

    let paid_orders: Vec<_> = store.orders.values().filter(|o| o.status == "paid").collect();
    let pending_orders_count = store.orders.values().filter(|o| o.status == "pending").count();
    let total_revenue_satang: u64 = paid_orders.iter().map(|o| o.amount_satang).sum();
    let messages_total: usize = store.messages.values().map(Vec::len).sum();

    Ok(Json(serde_json::json!({
        "users_total": human_users.len(),
        "active_paid_users": plus_users + pro_users,
        "plus_users": plus_users,
        "pro_users": pro_users,
        "suspended_users": suspended_users,
        "paid_orders_count": paid_orders.len(),
        "pending_orders_count": pending_orders_count,
        "total_revenue_satang": total_revenue_satang,
        "servers_total": store.servers.len(),
        "messages_total": messages_total,
        "stripe_configured": stripe_configured,
        "payment_mode": if stripe_configured { "stripe" } else { "sandbox" },
    })))
}

#[derive(Debug, Deserialize)]
pub struct AdminUsersQuery {
    pub q: Option<String>,
}

/// Lists platform user accounts with optional search filter (`GET /api/admin/users?q=...`).
pub async fn admin_list_users(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Query(query): Query<AdminUsersQuery>,
) -> ApiResult<Json<Vec<serde_json::Value>>> {
    require_platform_admin(&actor)?;
    let needle = query.q.unwrap_or_default().trim().to_lowercase();
    let store = state.store.read().map_err(|_| ApiError::Internal)?;

    let mut users: Vec<&User> = store.users.values().filter(|u| !u.bot).collect();
    if !needle.is_empty() {
        users.retain(|u| {
            u.username.to_lowercase().contains(&needle)
                || u.display_name.to_lowercase().contains(&needle)
                || u.email.as_deref().is_some_and(|e| e.to_lowercase().contains(&needle))
        });
    }
    users.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let rows = users
        .into_iter()
        .take(200)
        .map(|u| {
            let servers_count = store
                .members
                .values()
                .filter(|m| m.contains_key(&u.id))
                .count();
            serde_json::json!({
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "email": u.email,
                "plan": u.active_plan(),
                "plan_expires_at": u.plan_expires_at,
                "suspended": u.suspended,
                "platform_admin": u.platform_admin,
                "created_at": u.created_at,
                "servers_count": servers_count,
            })
        })
        .collect();
    Ok(Json(rows))
}

/// Updates a target account's plan, suspension status, or platform admin flag (`PATCH /api/admin/users/{id}`).
pub async fn admin_update_user(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path(target_id): Path<String>,
    Json(body): Json<AdminUpdateUserRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    require_platform_admin(&actor)?;
    if target_id == "outbox-bot" {
        return Err(ApiError::Forbidden("cannot modify bot account"));
    }
    let (row, public) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        if let Some(susp) = body.suspended {
            if susp && target_id == actor.id {
                return Err(ApiError::BadRequest("cannot suspend your own account".into()));
            }
        }
        if let Some(adm) = body.platform_admin {
            if !adm && target_id == actor.id {
                return Err(ApiError::BadRequest("cannot revoke your own admin role".into()));
            }
        }
        if let Some(ref plan) = body.plan {
            if !matches!(plan.as_str(), "free" | "plus" | "pro") {
                return Err(ApiError::BadRequest("plan must be free, plus, or pro".into()));
            }
        }
        if body.suspended == Some(true) {
            store.tokens.retain(|_, uid| uid != &target_id);
        }
        let u = store.users.get_mut(&target_id).ok_or(ApiError::NotFound("user"))?;
        if u.bot {
            return Err(ApiError::Forbidden("cannot modify bot account"));
        }
        if let Some(plan) = body.plan {
            u.plan = plan.clone();
            if plan == "free" {
                u.plan_expires_at = None;
            } else {
                let days = body.plan_days.unwrap_or(30).clamp(1, 3650);
                u.plan_expires_at =
                    Some((Utc::now() + Duration::days(days)).to_rfc3339_opts(SecondsFormat::Millis, true));
            }
        } else if let Some(days) = body.plan_days {
            if u.plan == "plus" || u.plan == "pro" {
                u.plan_expires_at = Some(
                    (Utc::now() + Duration::days(days.clamp(1, 3650)))
                        .to_rfc3339_opts(SecondsFormat::Millis, true),
                );
            }
        }
        if let Some(susp) = body.suspended {
            u.suspended = susp;
        }
        if let Some(adm) = body.platform_admin {
            u.platform_admin = adm;
        }
        let row = serde_json::json!({
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "email": u.email,
            "plan": u.active_plan(),
            "plan_expires_at": u.plan_expires_at,
            "suspended": u.suspended,
            "platform_admin": u.platform_admin,
            "created_at": u.created_at,
        });
        (row, u.public())
    };
    state.persist();
    state.emit(Event::UserUpdate { user: public });
    Ok(Json(row))
}

/// Lists recent billing orders across the platform (`GET /api/admin/orders`).
pub async fn admin_list_orders(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
) -> ApiResult<Json<Vec<serde_json::Value>>> {
    require_platform_admin(&actor)?;
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let mut orders: Vec<_> = store.orders.values().collect();
    orders.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let rows = orders
        .into_iter()
        .take(100)
        .map(|o| {
            let buyer = store.users.get(&o.user_id);
            serde_json::json!({
                "id": o.id,
                "user_id": o.user_id,
                "username": buyer.map(|u| u.username.as_str()).unwrap_or("-"),
                "display_name": buyer.map(|u| u.display_name.as_str()).unwrap_or("ผู้ใช้ที่ถูกลบ"),
                "plan_id": o.plan_id,
                "tier": o.tier,
                "amount_satang": o.amount_satang,
                "currency": o.currency,
                "status": o.status,
                "provider": o.provider,
                "created_at": o.created_at,
                "paid_at": o.paid_at,
            })
        })
        .collect();
    Ok(Json(rows))
}
