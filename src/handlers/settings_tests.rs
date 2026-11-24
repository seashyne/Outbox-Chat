//! Unit tests for user settings, profile updates, channel deletion, and server leaving.

use super::auth::{bootstrap, register};
use super::auth_tests::{auth_for, test_state};
use super::channels::{create_channel, delete_channel};
use super::servers::{create_server, join_server, leave_server};
use super::users::{get_settings, update_profile, update_settings};
use crate::error::ApiError;
use crate::model::{
    ChannelKind, CreateChannelRequest, CreateServerRequest, RegisterRequest, UpdateProfileRequest,
    UpdateSettingsRequest,
};
use axum::extract::{Path, State};
use axum::Json;
use std::collections::HashMap;

#[tokio::test]
async fn test_user_settings_and_profile_flow() {
    let state = test_state();
    let reg = register(
        State(state.clone()),
        Json(RegisterRequest {
            username: "bob".into(),
            password: "Password123!".into(),
        }),
    )
    .await
    .unwrap();

    let auth = auth_for(&state, &reg.0.user.id);

    // 1. Initial settings in Bootstrap
    let boot = bootstrap(State(state.clone()), auth.clone())
        .await
        .unwrap()
        .0;
    assert_eq!(boot.settings.theme, "dark");
    assert_eq!(boot.settings.status, "online");
    assert_eq!(boot.settings.language, "auto");
    assert!(boot.channels.contains_key("demo"));
    assert!(boot.members.contains_key("demo"));

    // 2. GET settings
    let s_res = get_settings(auth.clone()).await.unwrap().0;
    assert_eq!(s_res["settings"]["theme"], "dark");
    assert_eq!(s_res["settings"]["language"], "auto");

    // 3. PATCH settings (partial update: slate theme + idle status + ja language)
    let mut custom = HashMap::new();
    custom.insert("brand".into(), "#123456".into());
    let patch_res = update_settings(
        State(state.clone()),
        auth.clone(),
        Json(UpdateSettingsRequest {
            settings: None,
            theme: Some("slate".into()),
            custom_colors: Some(custom),
            status: Some("idle".into()),
            language: Some("JA".into()),
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(patch_res["settings"]["theme"], "slate");
    assert_eq!(patch_res["settings"]["status"], "idle");
    assert_eq!(patch_res["settings"]["language"], "ja");
    assert_eq!(patch_res["settings"]["custom_colors"]["brand"], "#123456");

    // Invalid language should be rejected with BadRequest
    let bad_lang = update_settings(
        State(state.clone()),
        auth.clone(),
        Json(UpdateSettingsRequest {
            settings: None,
            theme: None,
            custom_colors: None,
            status: None,
            language: Some("zz".into()),
        }),
    )
    .await;
    assert!(matches!(bad_lang, Err(ApiError::BadRequest(_))));

    // 4. PATCH profile
    let sample_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";
    let prof_res = update_profile(
        State(state.clone()),
        auth,
        Json(UpdateProfileRequest {
            username: None,
            display_name: Some("Bobby".into()),
            color: Some("#abcdef".into()),
            avatar_url: Some(sample_png.into()),
            banner_url: None,
            bio: Some("สวัสดีทีม Outbox".into()),
            status_text: Some("กำลังทำงาน".into()),
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(prof_res["user"]["display_name"], "Bobby");
    assert_eq!(prof_res["user"]["color"], "#abcdef");
    assert_eq!(prof_res["user"]["avatar_url"], sample_png);
}

#[tokio::test]
async fn test_channel_delete_and_server_leave() {
    let state = test_state();
    let reg_owner = register(
        State(state.clone()),
        Json(RegisterRequest {
            username: "owner_u".into(),
            password: "Password123!".into(),
        }),
    )
    .await
    .unwrap();
    let reg_member = register(
        State(state.clone()),
        Json(RegisterRequest {
            username: "member_u".into(),
            password: "Password123!".into(),
        }),
    )
    .await
    .unwrap();

    let owner_auth = auth_for(&state, &reg_owner.0.user.id);
    let member_auth = auth_for(&state, &reg_member.0.user.id);

    let srv = create_server(
        State(state.clone()),
        owner_auth.clone(),
        Json(CreateServerRequest {
            name: "Test Server".into(),
            icon: Some("TS".into()),
            ..Default::default()
        }),
    )
    .await
    .unwrap()
    .0;

    let _ = join_server(
        State(state.clone()),
        member_auth.clone(),
        Path(srv.id.clone()),
    )
    .await
    .unwrap();

    let chan = create_channel(
        State(state.clone()),
        owner_auth.clone(),
        Path(srv.id.clone()),
        Json(CreateChannelRequest {
            name: "extra-channel".into(),
            kind: ChannelKind::Text,
            topic: "topic".into(),
            category: None,
        }),
    )
    .await
    .unwrap()
    .0;

    // Regular member cannot delete channel (Forbidden)
    let del_fail = delete_channel(
        State(state.clone()),
        member_auth.clone(),
        Path(chan.id.clone()),
    )
    .await;
    assert!(matches!(del_fail, Err(ApiError::Forbidden(_))));

    // Owner can delete channel
    let del_ok = delete_channel(State(state.clone()), owner_auth.clone(), Path(chan.id.clone()))
        .await
        .unwrap()
        .0;
    assert_eq!(del_ok["success"], true);

    // Owner cannot leave own server (BadRequest)
    let leave_fail = leave_server(State(state.clone()), owner_auth, Path(srv.id.clone())).await;
    assert!(matches!(leave_fail, Err(ApiError::BadRequest(_))));

    // Member can leave server
    let leave_ok = leave_server(State(state.clone()), member_auth, Path(srv.id.clone()))
        .await
        .unwrap()
        .0;
    assert_eq!(leave_ok["success"], true);
}
