//! Stripe Checkout REST client and HMAC-SHA256 webhook signature verifier.

use crate::crypto::{constant_time_eq_str, hex_encode, HmacSha256};
use crate::error::{ApiError, ApiResult};
use chrono::Utc;

pub(crate) fn stripe_secret_key() -> Option<String> {
    std::env::var("STRIPE_SECRET_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub(crate) struct StripeCheckoutParams<'a> {
    pub secret: &'a str,
    pub order_id: &'a str,
    pub user_id: &'a str,
    pub plan_id: &'a str,
    pub plan_name: &'a str,
    pub amount_satang: u64,
    pub payment_method: &'a str,
    pub base_url: &'a str,
}

pub(crate) async fn create_stripe_session(p: StripeCheckoutParams<'_>) -> ApiResult<(String, String)> {
    let mut form = vec![
        ("mode", "payment".to_string()),
        ("success_url", format!("{}/?checkout=success&order_id={}", p.base_url, p.order_id)),
        ("cancel_url", format!("{}/?checkout=cancel&order_id={}", p.base_url, p.order_id)),
        ("line_items[0][quantity]", "1".to_string()),
        ("line_items[0][price_data][currency]", "thb".to_string()),
        ("line_items[0][price_data][unit_amount]", p.amount_satang.to_string()),
        ("line_items[0][price_data][product_data][name]", format!("{} (30 Days)", p.plan_name)),
        ("metadata[order_id]", p.order_id.to_string()),
        ("metadata[user_id]", p.user_id.to_string()),
        ("metadata[plan_id]", p.plan_id.to_string()),
        ("payment_method_types[0]", if p.payment_method == "promptpay" { "promptpay" } else { "card" }.into()),
    ];
    if p.payment_method != "promptpay" {
        form.push(("payment_method_types[1]", "promptpay".into()));
    }
    let resp = reqwest::Client::new()
        .post("https://api.stripe.com/v1/checkout/sessions")
        .bearer_auth(p.secret)
        .form(&form)
        .send()
        .await
        .map_err(|_| ApiError::BadRequest("could not reach Stripe payment gateway".into()))?;
    let data: serde_json::Value = resp.json().await.map_err(|_| ApiError::Internal)?;
    match (data["id"].as_str(), data["url"].as_str()) {
        (Some(sid), Some(url)) => Ok((sid.into(), url.into())),
        _ => Err(ApiError::BadRequest(
            data["error"]["message"].as_str().unwrap_or("Stripe checkout creation failed").into(),
        )),
    }
}

pub(crate) async fn fetch_stripe_session(secret: &str, session_id: &str) -> Option<serde_json::Value> {
    let url = format!("https://api.stripe.com/v1/checkout/sessions/{session_id}");
    let resp = reqwest::Client::new().get(url).bearer_auth(secret).send().await.ok()?;
    resp.json::<serde_json::Value>().await.ok()
}

pub(crate) fn verify_stripe_signature(secret: &str, sig_header: &str, raw_body: &str) -> ApiResult<()> {
    let mut ts: Option<i64> = None;
    let mut v1_sigs: Vec<&str> = Vec::new();
    for part in sig_header.split(',') {
        if let Some((k, v)) = part.trim().split_once('=') {
            if k == "t" { ts = v.parse::<i64>().ok(); }
            else if k == "v1" { v1_sigs.push(v); }
        }
    }
    let timestamp = ts.ok_or(ApiError::Forbidden("invalid Stripe-Signature timestamp"))?;
    if (Utc::now().timestamp() - timestamp).abs() > 300 || v1_sigs.is_empty() {
        return Err(ApiError::Forbidden("expired or missing Stripe signature"));
    }
    let expected = hex_encode(
        &HmacSha256::new(secret.as_bytes()).compute(format!("{timestamp}.{raw_body}").as_bytes()),
    );
    if !v1_sigs.iter().any(|s| constant_time_eq_str(&expected, s)) {
        return Err(ApiError::Forbidden("invalid Stripe webhook signature"));
    }
    Ok(())
}
