/**
 * WebSocket gateway upgrade & frame dispatch for OutboxHub Durable Object.
 */

import { HttpError, cmp, defaultSettings, publicUser } from "./utils.js";

/** Authenticates WebSocket token query param and registers socket with hibernation state. */
export function handleWsUpgrade(hub, url) {
  const token = (url.searchParams.get("token") || "").trim();
  const userId = token ? hub.store.tokens[token] : null;
  const user = userId ? hub.store.users[userId] : null;
  if (!user) throw new HttpError(401, "invalid or missing token");

  const [client, server] = Object.values(new WebSocketPair());
  hub.ctx.acceptWebSocket(server);
  server.serializeAttachment({ userId: user.id });

  const online = [...new Set([...hub.onlineIds(), user.id])].sort(cmp);
  server.send(JSON.stringify({ type: "ready", user: publicUser(user), online, heartbeat_interval: 25000 }));
  hub.emit({ type: "presence", online });
  return new Response(null, { status: 101, webSocket: client });
}

/** Handles incoming WebSocket frames (`ping`, `status`, `typing`, `rtc_signal`, `meeting_state`). */
export function handleWsMessage(hub, ws, raw) {
  const meta = ws.deserializeAttachment();
  const user = meta?.userId ? hub.store.users[meta.userId] : null;
  if (!user) return;

  let payload;
  try {
    payload = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return;
  }

  if (payload?.type === "ping") {
    try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
    return;
  }
  if (payload?.type === "status" && typeof payload.status === "string") {
    const statusVal = payload.status.trim().slice(0, 32);
    if (statusVal) {
      user.settings = user.settings || defaultSettings();
      user.settings.status = statusVal;
      hub.persistStore();
      hub.emit({ type: "user_status", user_id: user.id, status: statusVal });
    }
    return;
  }
  if (payload?.type === "rtc_signal" && typeof payload.channel_id === "string" && typeof payload.to === "string") {
    const channel = hub.store.channels[payload.channel_id];
    if (
      channel &&
      (channel.kind === "voice" || channel.id.startsWith("dm:")) &&
      hub.isMember(channel.server_id, user.id) &&
      hub.isMember(channel.server_id, payload.to) &&
      payload.signal !== undefined
    ) {
      hub.emit(
        { type: "rtc_signal", server_id: channel.server_id, channel_id: channel.id, from: user.id, to: payload.to, signal: payload.signal },
        ws
      );
    }
    return;
  }
  if (payload?.type === "meeting_state" && typeof payload.channel_id === "string") {
    const channel = hub.store.channels[payload.channel_id];
    if (
      channel &&
      (channel.kind === "voice" || channel.id.startsWith("dm:")) &&
      hub.isMember(channel.server_id, user.id)
    ) {
      hub.emit(
        {
          type: "meeting_state",
          server_id: channel.server_id,
          channel_id: channel.id,
          user_id: user.id,
          muted: Boolean(payload.muted),
          deafened: Boolean(payload.deafened),
          video: Boolean(payload.video),
          speaking: Boolean(payload.speaking),
          data_saver: payload.data_saver !== false,
        },
        ws
      );
    }
    return;
  }
  if (payload?.type === "typing" && typeof payload.channel_id === "string") {
    const channel = hub.store.channels[payload.channel_id];
    if (channel && hub.canViewChannel(channel, user.id)) {
      hub.emit({ type: "typing", server_id: channel.server_id, channel_id: channel.id, user: publicUser(user) });
    }
  }
}

/** Cleans up voice occupancy and broadcasts updated presence on socket disconnect. */
export function handleWsDisconnect(hub, ws) {
  const meta = ws.deserializeAttachment();
  if (!meta?.userId) return;
  const online = hub.onlineIds(ws);
  if (!online.includes(meta.userId)) {
    for (const { serverId, channelId, users } of hub.leaveAllVoice(meta.userId)) {
      hub.emit({ type: "voice_state", server_id: serverId, channel_id: channelId, users }, ws);
    }
  }
  hub.emit({ type: "presence", online }, ws);
}
