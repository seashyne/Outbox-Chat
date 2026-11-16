//! Starter server templates and role-configuration helpers.
//!
//! Ensures server creation presets (`blank`, `team`, `community`, `study`) and
//! `ServerRolesConfig` updates are validated identically to Cloudflare Workers.

use super::clean_text;
use super::users::is_valid_hex_color;
use crate::error::{ApiError, ApiResult};
use crate::model::{new_id, now, Channel, ChannelKind, ServerRolesConfig, ServerRolesConfigPatch};

/// Starter channel blueprint paired with a server template.
pub(crate) struct TemplateSpec {
    pub description: &'static str,
    pub accent_color: &'static str,
    pub admin_label: &'static str,
    pub member_label: &'static str,
    pub channels: &'static [(&'static str, ChannelKind, &'static str)],
}

const BLANK_CHANNELS: &[(&str, ChannelKind, &str)] = &[("general", ChannelKind::Text, "ช่องทั่วไป")];

const TEAM_CHANNELS: &[(&str, ChannelKind, &str)] = &[
    ("general", ChannelKind::Text, "พื้นที่สื่อสารหลักของทีม"),
    ("announcements", ChannelKind::Text, "ประกาศและข่าวสารสำคัญ"),
    ("tasks", ChannelKind::Text, "ติดตามงานและสิ่งที่ต้องทำ"),
    ("standup", ChannelKind::Text, "อัปเดตงานประจำวัน"),
    ("Meeting Room", ChannelKind::Voice, "ห้องประชุมเสียงของทีม"),
];

const COMMUNITY_CHANNELS: &[(&str, ChannelKind, &str)] = &[
    ("general", ChannelKind::Text, "คุยเล่นและทักทาย"),
    ("welcome", ChannelKind::Text, "แนะนำตัวและกติกาชุมชน"),
    ("showcase", ChannelKind::Text, "แชร์ผลงานและไอเดีย"),
    ("off-topic", ChannelKind::Text, "เรื่องทั่วไปนอกเหนือจากหัวข้อหลัก"),
    ("Lounge", ChannelKind::Voice, "ห้องเสียงสำหรับนั่งคุยกัน"),
    ("Music Room", ChannelKind::Voice, "ห้องฟังเพลงและพักผ่อน"),
];

const STUDY_CHANNELS: &[(&str, ChannelKind, &str)] = &[
    ("general", ChannelKind::Text, "พูดคุยทั่วไป"),
    ("notes", ChannelKind::Text, "สรุปบทเรียนและเอกสาร"),
    ("q-and-a", ChannelKind::Text, "ถาม-ตอบข้อสงสัย"),
    ("Study Room", ChannelKind::Voice, "ห้องติวหนังสือและทำงานกลุ่ม"),
];

/// Resolves a server starter template preset or returns 400 on unknown ID.
pub(crate) fn resolve_template(raw: Option<&str>) -> ApiResult<TemplateSpec> {
    match raw.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("blank") {
        "blank" => Ok(TemplateSpec {
            description: "",
            accent_color: "#5865f2",
            admin_label: "ผู้ดูแลระบบ",
            member_label: "สมาชิก",
            channels: BLANK_CHANNELS,
        }),
        "team" => Ok(TemplateSpec {
            description: "พื้นที่ทำงานร่วมกันสำหรับทีมและโปรเจกต์",
            accent_color: "#23a559",
            admin_label: "หัวหน้าทีม",
            member_label: "สมาชิกทีม",
            channels: TEAM_CHANNELS,
        }),
        "community" => Ok(TemplateSpec {
            description: "คอมมูนิตี้สำหรับพูดคุยและแลกเปลี่ยนเรื่องที่สนใจ",
            accent_color: "#eb459e",
            admin_label: "ผู้ดูแลชุมชน",
            member_label: "สมาชิก",
            channels: COMMUNITY_CHANNELS,
        }),
        "study" => Ok(TemplateSpec {
            description: "พื้นที่ติวหนังสือ สรุปบทเรียน และถาม-ตอบ",
            accent_color: "#38bdf8",
            admin_label: "ติวเตอร์",
            member_label: "ผู้เรียน",
            channels: STUDY_CHANNELS,
        }),
        _ => Err(ApiError::BadRequest(
            "template must be one of: blank, team, community, study".into(),
        )),
    }
}

/// Validates optional short text allowing empty string to clear descriptions.
pub(crate) fn clean_optional_text(raw: &str, max: usize, what: &str) -> ApiResult<String> {
    if raw.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest(format!("{what} cannot contain control characters")));
    }
    let trimmed = raw.trim();
    if trimmed.chars().count() > max {
        return Err(ApiError::BadRequest(format!("{what} must be 0-{max} characters")));
    }
    Ok(trimmed.to_string())
}

/// Validates a `#RGB`/`#RRGGBB` color string for server accents and role badges.
pub(crate) fn validate_color(raw: &str, what: &str) -> ApiResult<String> {
    let trimmed = raw.trim();
    if !is_valid_hex_color(trimmed) {
        return Err(ApiError::BadRequest(format!("{what} must be a valid hex color")));
    }
    Ok(trimmed.to_string())
}

/// Applies validated role-configuration updates in place.
pub(crate) fn apply_roles_patch(cfg: &mut ServerRolesConfig, patch: &ServerRolesConfigPatch) -> ApiResult<()> {
    if let Some(ref v) = patch.owner_label {
        cfg.owner_label = clean_text(v, 24, "owner_label")?;
    }
    if let Some(ref v) = patch.admin_label {
        cfg.admin_label = clean_text(v, 24, "admin_label")?;
    }
    if let Some(ref v) = patch.member_label {
        cfg.member_label = clean_text(v, 24, "member_label")?;
    }
    if let Some(ref v) = patch.admin_color {
        cfg.admin_color = validate_color(v, "admin_color")?;
    }
    if let Some(ref v) = patch.member_color {
        cfg.member_color = validate_color(v, "member_color")?;
    }
    if let Some(allow) = patch.allow_member_create_channel {
        cfg.allow_member_create_channel = allow;
    }
    Ok(())
}

/// Materializes `Channel` entities for a server from its template specification.
pub(crate) fn build_template_channels(server_id: &str, spec: &TemplateSpec) -> Vec<Channel> {
    let ts = now();
    let (mut text_pos, mut voice_pos) = (0_i64, 0_i64);
    spec.channels
        .iter()
        .map(|(name, kind, topic)| {
            let position = match kind {
                ChannelKind::Text => { let p = text_pos; text_pos += 1; p }
                ChannelKind::Voice => { let p = voice_pos; voice_pos += 1; p }
            };
            Channel {
                id: new_id(),
                server_id: server_id.to_string(),
                name: (*name).into(),
                kind: *kind,
                topic: (*topic).into(),
                position,
                created_at: ts.clone(),
            }
        })
        .collect()
}
