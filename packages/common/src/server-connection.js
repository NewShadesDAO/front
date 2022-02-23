import React from "react";
import { identity } from "./utils/function";
import { useAuth } from "./auth";

const clientEventMap = {
  "mark-channel-read": [
    "client-channel-mark",
    (clientPayload) => ({
      channel_id: clientPayload.channelId,
      last_read_at: clientPayload.date.toISOString(),
    }),
  ],
};
const serverEventMap = {
  MESSAGE_CREATE: "message-created",
  MESSAGE_UPDATE: "message-updated",
  MESSAGE_REMOVE: "message-removed",
  MESSAGE_REACTION_ADD: "message-reaction-added",
  MESSAGE_REACTION_REMOVE: "message-reaction-removed",
};

const Context = React.createContext(null);

export const Provider = ({ Pusher, pusherKey, debug = false, children }) => {
  const { accessToken, user, apiOrigin } = useAuth();
  const channelRef = React.useRef();
  const listenersRef = React.useRef([]);

  const send = React.useCallback((event, payload = { no: "data" }) => {
    const [serverEvent, payloadMapper = identity] = clientEventMap[event];
    if (serverEvent == null) throw new Error(`Unknown event "${event}"`);

    // Pusher returns true if the message is successfully sent, false otherwise
    return channelRef.current.trigger(serverEvent, payloadMapper(payload));
  }, []);

  const addListener = React.useCallback((fn) => {
    listenersRef.current = [...listenersRef.current, fn];
    return () => {
      listenersRef.current = listenersRef.current.filter((fn_) => fn !== fn_);
    };
  }, []);

  React.useEffect(() => {
    if (accessToken == null || user == null) return;
    Pusher.logToConsole = debug;

    const pusher = new Pusher(pusherKey, {
      cluster: "eu",
      authEndpoint: `${apiOrigin}/websockets/auth`,
      auth: {
        params: { provider: "pusher" },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });

    const nonce = crypto.getRandomValues(new Uint32Array(1))[0];
    const channelName = `private-${user.id}-${nonce}`;
    const channel = pusher.subscribe(channelName);
    channelRef.current = channel;

    const serverEvents = Object.keys(serverEventMap);

    for (let event of serverEvents)
      channel.bind(event, (data) => {
        const clientEventName = serverEventMap[event];
        listenersRef.current.forEach((fn) => fn(clientEventName, data));
      });
  }, [Pusher, apiOrigin, pusherKey, debug, user, accessToken]);

  const serverConnection = React.useMemo(
    () => ({ send, addListener }),
    [send, addListener]
  );

  return (
    <Context.Provider value={serverConnection}>{children}</Context.Provider>
  );
};

export const useServerConnection = () => React.useContext(Context);
