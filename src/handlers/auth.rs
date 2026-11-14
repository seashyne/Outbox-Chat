use super::{clean_text, server_view, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, new_token, now, Bootstrap, ChannelKind, Event, RegisterRequest, RegisterResponse, Role,
    Server, User, AVATAR_COLORS,
};
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use std::sync::Arc;

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterRequest>,
) -> ApiResult<Json<RegisterResponse>> {
    let username = clean_text(&body.username, 32, "username")?;
    let color = AVATAR_COLORS[username.len() % AVATAR_COLORS.len()].to_string();
    let user = User {
        id: new_id(),
        username: username.clone(),
        display_name: username.clone(),
        color,
        token: new_token(),
        bot: false,
        created_at: now(),
    };

    let join_event = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        if store
            .users
            .values()
            .any(|u| u.username.eq_ignore_ascii_case(&username))
        {
            return Err(ApiError::Conflict("username is already taken".into()));
        }
        store.tokens.insert(user.token.clone(), user.id.clone());
        store.users.insert(user.id.clone(), user.clone());

        // Everyone lands in the demo server on first registration.
        if let Some(members) = store.members.get_mut("demo") {
            members.insert(user.id.clone(), Role::Member);
            Some(Event::MemberJoin {
                server_id: "demo".into(),
                user: user.public(),
            })
        } else {
            None
        }
    };
    state.persist();
    if let Some(event) = join_event {
        state.emit(event);
    }

    Ok(Json(RegisterResponse {
        token: user.token.clone(),
        user: user.public(),
    }))
}

pub async fn bootstrap(
    State(state): State<Arc<AppState>>,
    Auth(current_user): Auth,
) -> ApiResult<Json<Bootstrap>> {
    let me = current_user.public();
    let (servers, default_server_id, default_channel_id) = {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        let mut mine: Vec<&Server> = store
            .servers
            .values()
            .filter(|s| store.is_member(&s.id, &me.id))
            .collect();
        mine.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        let views = mine
            .iter()
            .map(|s| server_view(&store, &me.id, s))
            .collect::<Vec<_>>();
        let default_server_id = views.first().map(|s| s.id.clone());
        let default_channel_id = views
            .first()
            .and_then(|s| s.channels.iter().find(|c| c.kind == ChannelKind::Text))
            .map(|c| c.id.clone());
        (views, default_server_id, default_channel_id)
    };

    Ok(Json(Bootstrap {
        me,
        servers,
        online: state.online_ids(),
        voice: state.voice_snapshot(),
        default_server_id,
        default_channel_id,
    }))
}
