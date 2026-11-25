//! Subscription catalog, checkout flows, order sync, and webhook dispatch.

use super::stripe_client::{
    create_stripe_session, fetch_stripe_session, stripe_secret_key, verify_stripe_signature,
    StripeCheckoutParams,
};
use super::Auth;
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, plan_catalog, BillingOrder, CreateCheckoutRequest, Event, PublicUser,
    SandboxCompleteRequest, Store,
};
use crate::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header::AUTHORIZATION, HeaderMap};
use axum::Json;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use std::sync::Arc;

fn safe_return_base(raw: Option<&str>) -> String {
    let trimmed = raw.unwrap_or("").trim().trim_end_matches('/');
    if trimmed == "https://outbox.lenout.com"
        || trimmed.starts_with("http://localhost:")
        || trimmed.starts_with("http://127.0.0.1:")
    {
        return trimmed.to_string();
    }
    "https://outbox.lenout.com".to_string()
}

fn bearer_token(headers: &HeaderMap) -> &str {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .unwrap_or("")
}

/// Idempotently marks an order as `paid` and activates/extends the buyer's subscription (+30 days).
pub(crate) fn activate_paid_order(
    store: &mut Store,
    order_id: &str,
) -> Option<(BillingOrder, Option<PublicUser>)> {
    let mut order = store.orders.get(order_id)?.clone();
    if order.status == "paid" {
        let pub_u = store.users.get(&order.user_id).map(|u| u.public());
        return Some((order, pub_u));
    }
    order.status = "paid".into();
    order.paid_at = Some(now());
    store.orders.insert(order.id.clone(), order.clone());

    let pub_u = if let Some(user) = store.users.get_mut(&order.user_id) {
        let base_time = user
            .plan_expires_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .filter(|dt| *dt > Utc::now() && user.plan == order.tier)
            .unwrap_or_else(Utc::now);
        user.plan = order.tier.clone();
        user.plan_expires_at =
            Some((base_time + Duration::days(30)).to_rfc3339_opts(SecondsFormat::Millis, true));
        Some(user.public())
    } else {
        None
    };
    Some((order, pub_u))
}

/// Lists subscription plans and active payment mode (`GET /api/billing/plans`).
pub async fn list_plans(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let stripe_ok = stripe_secret_key().is_some();
    let token = bearer_token(&headers);
    let account = if !token.is_empty() {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        store.tokens.get(token).and_then(|uid| store.users.get(uid)).map(|u| u.account_summary())
    } else {
        None
    };
    Ok(Json(serde_json::json!({
        "plans": plan_catalog(),
        "currency": "thb",
        "stripe_configured": stripe_ok,
        "payment_mode": if stripe_ok { "stripe" } else { "sandbox" },
        "account": account,
    })))
}

/// Lists the authenticated user's past and pending orders (`GET /api/billing/orders`).
pub async fn list_my_orders(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
) -> ApiResult<Json<Vec<BillingOrder>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let mut list: Vec<BillingOrder> = store.orders.values().filter(|o| o.user_id == user.id).cloned().collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(list))
}

/// Starts an online checkout flow (live Stripe Checkout when configured, else sandbox flow).
pub async fn create_checkout(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<CreateCheckoutRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let plan = plan_catalog()
        .into_iter()
        .find(|p| p.id == body.plan_id.trim() && p.amount_satang > 0)
        .ok_or_else(|| ApiError::BadRequest("invalid subscription plan".into()))?;
    let order_id = new_id();
    let stripe_key = stripe_secret_key();
    let base_url = safe_return_base(body.return_origin.as_deref());

    let (checkout_session_id, checkout_url) = if let Some(ref secret) = stripe_key {
        let pm = body.payment_method.as_deref().unwrap_or("card");
        let (sid, url) = create_stripe_session(StripeCheckoutParams {
            secret,
            order_id: &order_id,
            user_id: &user.id,
            plan_id: plan.id,
            plan_name: plan.name,
            amount_satang: plan.amount_satang,
            payment_method: pm,
            base_url: &base_url,
        })
        .await?;
        (Some(sid), Some(url))
    } else {
        (None, None)
    };

    let order = BillingOrder {
        id: order_id.clone(),
        user_id: user.id.clone(),
        plan_id: plan.id.into(),
        tier: plan.tier.into(),
        amount_satang: plan.amount_satang,
        currency: "thb".into(),
        status: "pending".into(),
        provider: if stripe_key.is_some() { "stripe" } else { "sandbox" }.into(),
        checkout_session_id,
        created_at: now(),
        paid_at: None,
    };
    {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        if let Some(ref sid) = order.checkout_session_id {
            store.stripe_session_orders.insert(sid.clone(), order.id.clone());
        }
        store.orders.insert(order.id.clone(), order.clone());
    }
    state.persist();
    Ok(Json(serde_json::json!({ "mode": order.provider, "order": order, "checkout_url": checkout_url })))
}

/// Completes a sandbox checkout order when Stripe keys are not configured.
pub async fn sandbox_complete(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<SandboxCompleteRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    if stripe_secret_key().is_some() {
        return Err(ApiError::Forbidden("sandbox checkout is disabled when Stripe is configured"));
    }
    let (order, pub_u, account) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let existing = store.orders.get(&body.order_id).ok_or(ApiError::NotFound("order"))?;
        if existing.user_id != user.id { return Err(ApiError::Forbidden("not your order")); }
        if existing.provider != "sandbox" { return Err(ApiError::BadRequest("order is not a sandbox order".into())); }
        let (order, pub_u) = activate_paid_order(&mut store, &body.order_id).ok_or(ApiError::NotFound("order"))?;
        let acc = store.users.get(&user.id).map(|u| u.account_summary());
        (order, pub_u, acc)
    };
    state.persist();
    if let Some(u) = pub_u.clone() { state.emit(Event::UserUpdate { user: u }); }
    Ok(Json(serde_json::json!({ "order": order, "user": pub_u, "account": account })))
}

/// Syncs an order's payment status with Stripe after returning from Checkout (`GET /api/billing/orders/{id}/sync`).
pub async fn sync_order(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(order_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let existing = {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        store.orders.get(&order_id).cloned().ok_or(ApiError::NotFound("order"))?
    };
    if existing.user_id != user.id { return Err(ApiError::Forbidden("not your order")); }
    if existing.status == "pending" && existing.provider == "stripe" {
        if let (Some(secret), Some(sid)) = (stripe_secret_key(), existing.checkout_session_id.as_deref()) {
            if let Some(session) = fetch_stripe_session(&secret, sid).await {
                if session["payment_status"] == "paid" {
                    let pub_u = {
                        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
                        activate_paid_order(&mut store, &order_id).and_then(|(_, u)| u)
                    };
                    state.persist();
                    if let Some(u) = pub_u { state.emit(Event::UserUpdate { user: u }); }
                }
            }
        }
    }
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let order = store.orders.get(&order_id).cloned().ok_or(ApiError::NotFound("order"))?;
    let u = store.users.get(&user.id);
    Ok(Json(serde_json::json!({ "order": order, "user": u.map(|x| x.public()), "account": u.map(|x| x.account_summary()) })))
}

/// Handles signed Stripe webhooks (`POST /api/billing/webhook`) verifying `Stripe-Signature`.
pub async fn stripe_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<serde_json::Value>> {
    let wh_secret = std::env::var("STRIPE_WEBHOOK_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or(ApiError::Forbidden("webhook secret is not configured"))?;
    let sig_header = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or(ApiError::Forbidden("missing Stripe-Signature header"))?;
    let raw_str = std::str::from_utf8(&body).map_err(|_| ApiError::BadRequest("invalid UTF-8".into()))?;
    verify_stripe_signature(&wh_secret, sig_header, raw_str)?;

    let event: serde_json::Value = serde_json::from_slice(&body).map_err(|_| ApiError::BadRequest("invalid JSON".into()))?;
    if event["type"] == "checkout.session.completed" && event["data"]["object"]["payment_status"] == "paid" {
        let sess = &event["data"]["object"];
        let sid = sess["id"].as_str().unwrap_or("");
        let meta_oid = sess["metadata"]["order_id"].as_str().map(String::from);
        let pub_u = {
            let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
            let oid = meta_oid.or_else(|| store.stripe_session_orders.get(sid).cloned());
            oid.and_then(|id| activate_paid_order(&mut store, &id)).and_then(|(_, u)| u)
        };
        state.persist();
        if let Some(u) = pub_u { state.emit(Event::UserUpdate { user: u }); }
    }
    Ok(Json(serde_json::json!({ "received": true })))
}
