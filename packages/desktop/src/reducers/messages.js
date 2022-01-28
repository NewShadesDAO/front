import combineReducers from "../utils/combine-reducers";
import { indexBy, groupBy, unique } from "../utils/array";
import { omitKey, mapValues } from "../utils/object";

const entriesById = (state = {}, action) => {
  switch (action.type) {
    case "messages-fetched":
      return { ...state, ...indexBy((m) => m.id, action.messages) };

    case "server-event:message-created":
      return {
        ...state,
        [action.data.id]: action.data,
      };

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

    default:
      return state;
  }
};

const entryIdsByChannelId = (state = {}, action) => {
  switch (action.type) {
    case "messages-fetched": {
      const messageIdsByChannelId = mapValues(
        (ms) => ms.map((m) => m.id),
        groupBy((m) => m.channel, action.messages)
      );

      return { ...state, ...messageIdsByChannelId };
    }

    case "server-event:message-created": {
      const channelId = action.data.channel;
      const channelMessageIds = state[channelId] ?? [];
      return {
        ...state,
        [channelId]: unique([...channelMessageIds, action.data.id]),
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

    default:
      return state;
  }
};

export const selectChannelMessages = (state) => (channelId) => {
  const channelMessageIds = state.messages.entryIdsByChannelId[channelId] ?? [];
  return channelMessageIds.map((id) => state.messages.entriesById[id]);
};

export default combineReducers({ entriesById, entryIdsByChannelId });
