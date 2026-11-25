//! Account lifecycle, subscription plans, billing orders, and platform admin payloads.

use super::{Id, Store, User};
use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const FREE_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
pub const PLUS_UPLOAD_BYTES: usize = 15 * 1024 * 1024;
pub const PRO_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

/// Returns maximum upload size in bytes for a given subscription tier (`free | plus | pro`).
pub fn upload_limit_for_plan(plan: &str) -> usize {
    match plan {
        "pro" => PRO_UPLOAD_BYTES,
        "plus" => PLUS_UPLOAD_BYTES,
        _ => FREE_UPLOAD_BYTES,
    }
}

impl User {
    /// Returns `"free"`, `"plus"`, or `"pro"`, automatically falling back to `"free"` when expired.
    pub fn active_plan(&self) -> &str {
        if !matches!(self.plan.as_str(), "plus" | "pro") {
            return "free";
        }
        if let Some(ref exp) = self.plan_expires_at {
            let active = chrono::DateTime::parse_from_rfc3339(exp)
                .map(|dt| dt.with_timezone(&Utc) > Utc::now())
                .unwrap_or(false);
            if !active {
                return "free";
            }
        }
        self.plan.as_str()
    }

    /// Builds private account metadata returned only to the signed-in owner.
    pub fn account_summary(&self) -> AccountSummary {
        let active = self.active_plan().to_string();
        AccountSummary {
            email: self.email.clone(),
            max_upload_bytes: upload_limit_for_plan(&active),
            max_stickers: if active == "pro" { 48 } else { 24 },
            plan: active,
            plan_expires_at: self.plan_expires_at.clone(),
            is_platform_admin: self.platform_admin,
        }
    }
}

impl Store {
    /// Returns max upload size in bytes for `user_id` based on their active plan tier.
    pub fn max_upload_bytes_for(&self, user_id: &str) -> usize {
        self.users
            .get(user_id)
            .map(|u| upload_limit_for_plan(u.active_plan()))
            .unwrap_or(FREE_UPLOAD_BYTES)
    }

    /// Returns max stickers allowed in `server_id` (48 if server owner or actor is Pro, else 24).
    pub fn max_stickers_for(&self, server_id: &str, actor_id: &str) -> usize {
        let owner_pro = self
            .servers
            .get(server_id)
            .and_then(|s| self.users.get(&s.owner_id))
            .is_some_and(|u| u.active_plan() == "pro");
        let actor_pro = self
            .users
            .get(actor_id)
            .is_some_and(|u| u.active_plan() == "pro");
        if owner_pro || actor_pro { 48 } else { 24 }
    }
}

/// Private account status summary exposed only to the authenticated owner (`@me` / bootstrap).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountSummary {
    pub email: Option<String>,
    pub plan: String,
    pub plan_expires_at: Option<String>,
    pub max_upload_bytes: usize,
    pub max_stickers: usize,
    pub is_platform_admin: bool,
}

/// Storefront subscription plan item returned by `GET /api/billing/plans`.
#[derive(Clone, Debug, Serialize)]
pub struct PlanCatalogItem {
    pub id: &'static str,
    pub tier: &'static str,
    pub name: &'static str,
    pub price_thb: u64,
    pub amount_satang: u64,
    pub interval_days: i64,
    pub max_upload_mb: usize,
    pub max_stickers: usize,
    pub hd_screen: bool,
}

/// Returns the static catalog of supported Outbox Chat membership plans.
pub fn plan_catalog() -> Vec<PlanCatalogItem> {
    vec![
        PlanCatalogItem {
            id: "free",
            tier: "free",
            name: "Free",
            price_thb: 0,
            amount_satang: 0,
            interval_days: 0,
            max_upload_mb: 5,
            max_stickers: 24,
            hd_screen: false,
        },
        PlanCatalogItem {
            id: "plus_monthly",
            tier: "plus",
            name: "Outbox Plus",
            price_thb: 99,
            amount_satang: 9900,
            interval_days: 30,
            max_upload_mb: 15,
            max_stickers: 24,
            hd_screen: true,
        },
        PlanCatalogItem {
            id: "pro_monthly",
            tier: "pro",
            name: "Outbox Pro",
            price_thb: 249,
            amount_satang: 24900,
            interval_days: 30,
            max_upload_mb: 25,
            max_stickers: 48,
            hd_screen: true,
        },
    ]
}

/// Persisted checkout order for membership purchases.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BillingOrder {
    pub id: Id,
    pub user_id: Id,
    pub plan_id: String,
    pub tier: String,
    pub amount_satang: u64,
    pub currency: String,
    pub status: String,
    pub provider: String,
    #[serde(default)]
    pub checkout_session_id: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub paid_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteAccountRequest {
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCheckoutRequest {
    pub plan_id: String,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub return_origin: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SandboxCompleteRequest {
    pub order_id: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct AdminUpdateUserRequest {
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub plan_days: Option<i64>,
    #[serde(default)]
    pub suspended: Option<bool>,
    #[serde(default)]
    pub platform_admin: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AdminClaimRequest {
    pub secret: String,
}
