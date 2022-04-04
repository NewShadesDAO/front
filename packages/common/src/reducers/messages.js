import combineReducers from "../utils/combine-reducers";
import { indexBy, groupBy, unique } from "../utils/array";
import { omitKey, mapValues } from "../utils/object";
import { selectServerMemberWithUserId, selectUser } from "./server-members";

const entriesById = (state = {}, action) => {
  switch (action.type) {
    case "messages-fetched":
      return { ...state, ...indexBy((m) => m.id, action.messages) };

    case "server-event:message-created":
    case "server-event:message-updated":
      return {
        ...state,
        [action.data.message.id]: action.data.message,
      };

    case "server-event:message-removed":
      return omitKey(action.data.message.id, state);

    case "message-fetch-request-successful":
      return { ...state, [action.message.id]: action.message };

    case "message-delete-request-successful":
      return omitKey(action.messageId, state);

    case "message-create-request-sent":
      return {
        ...state,
        [action.message.id]: action.message,
      };

    case "message-create-request-successful":
      return {
        // Remove the optimistic entry
        ...omitKey(action.optimisticEntryId, state),
        [action.message.id]: action.message,
      };
    case "message-update-request-successful":
      return {
        ...state,
        [action.message.id]: action.message,
      };

    case "add-message-reaction:request-sent": {
      const message = state[action.messageId];
      const existingReaction = message.reactions.find(
        (r) => r.emoji === action.emoji
      );
      return {
        ...state,
        [action.messageId]: {
          ...message,
          reactions:
            existingReaction == null
              ? // Add a new reaction
                [
                  ...message.reactions,
                  { emoji: action.emoji, count: 1, users: [action.userId] },
                ]
              : // Update the existing one
                message.reactions.map((r) =>
                  r.emoji === action.emoji
                    ? {
                        ...r,
                        count: r.count + 1,
                        users: [...r.users, action.userId],
                      }
                    : r
                ),
        },
      };
    }

    case "remove-message-reaction:request-sent": {
      const message = state[action.messageId];
      const reaction = message.reactions.find((r) => r.emoji === action.emoji);
      return {
        ...state,
        [action.messageId]: {
          ...message,
          reactions:
            reaction.count === 1
              ? // Remove the reaction
                message.reactions.filter((r) => r.emoji !== action.emoji)
              : // Update the existing one
                message.reactions.map((r) =>
                  r.emoji === action.emoji
                    ? {
                        ...r,
                        count: r.count - 1,
                        users: r.users.filter(
                          (userId) => userId !== action.userId
                        ),
                      }
                    : r
                ),
        },
      };
    }

    // TODO: Update the reactions individually to prevent race conditions
    case "server-event:message-reaction-added":
    case "server-event:message-reaction-removed":
      return {
        ...state,
        [action.data.message.id]: action.data.message,
      };

    default:
      return state;
  }
};

const entryIdsByChannelId = (state = {}, action) => {
  switch (action.type) {
    case "messages-fetched": {
      const messageIdsByChannelId = mapValues(
        (ms, channelId) => {
          const previousIds = state[channelId] ?? [];
          const newIds = ms.map((m) => m.id);
          return unique([...previousIds, ...newIds]);
        },
        groupBy((m) => m.channel, action.messages)
      );

      return { ...state, ...messageIdsByChannelId };
    }

    case "server-event:message-created": {
      const channelId = action.data.message.channel;
      const channelMessageIds = state[channelId] ?? [];
      return {
        ...state,
        [channelId]: unique([...channelMessageIds, action.data.message.id]),
      };
    }

    case "message-create-request-sent": {
      const channelId = action.message.channel;
      const channelMessageIds = state[channelId] ?? [];
      return {
        ...state,
        [channelId]: [...channelMessageIds, action.message.id],
      };
    }

    case "message-create-request-successful": {
      const channelId = action.message.channel;
      const channelMessageIds = state[channelId] ?? [];
      return {
        ...state,
        [channelId]: [
          // Remove the optimistic entry
          ...channelMessageIds.filter((id) => id !== action.optimisticEntryId),
          action.message.id,
        ],
      };
    }

    case "server-event:message-removed":
      return mapValues(
        (messageIds) =>
          messageIds.filter((id) => id !== action.data.message.id),
        state
      );
    case "message-delete-request-successful":
      return mapValues(
        (messageIds) => messageIds.filter((id) => id !== action.messageId),
        state
      );

    default:
      return state;
  }
};

export const selectMessage = (state) => (id) => {
  const message = state.messages.entriesById[id];

  if (message == null) return null;

  const serverId = message.server;
  const authorUserId = message.author;

  // `server` doesn’t exist on dm messages
  if (message.serverId != null) {
    message.authorServerMember = selectServerMemberWithUserId(state)(
      serverId,
      authorUserId
    );
  } else {
    message.authorUser = selectUser(state)(authorUserId);
  }

  if (message.reply_to != null) {
    message.repliedMessage = selectMessage(state)(message.reply_to);
    message.isReply = true;
  }

  return {
    ...message,
    serverId,
    authorUserId,
    isEdited: message.edited_at != null,
    author: message.authorServerMember ?? message.authorUser,
    content:
      message.blocks?.length > 0
        ? message.blocks
        : [{ type: "paragraph", children: [{ text: message.content }] }],
    reactions:
      message.reactions?.map((r) => ({
        ...r,
        hasReacted: r.users.includes(state.user.id),
      })) ?? [],
  };
};

export const selectChannelMessages = (state) => (channelId) => {
  const channelMessageIds = state.messages.entryIdsByChannelId[channelId] ?? [];
  return channelMessageIds.map(selectMessage(state));
};

export default combineReducers({ entriesById, entryIdsByChannelId });
