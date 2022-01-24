import React from "react";
import { API_ENDPOINT } from "../constants/api";
import useGlobalState from "../hooks/global-state";

const clientEventMap = {
  "request-user-data": "client-connection-request",
};
const serverEventMap = {
  CONNECTION_READY: "user-data",
  MESSAGE_CREATE: "message-created",
};

const useServerConnection = ({
  debug = false,
  Pusher = window.Pusher,
  PUSHER_KEY = process.env.PUSHER_KEY,
} = {}) => {
  const { accessToken, user } = useGlobalState();

  const channelRef = React.useRef();
  const listenersRef = React.useRef([]);

  const send = React.useCallback((event, data = { no: "data" }) => {
    const serverEvent = clientEventMap[event];
    if (serverEvent == null) throw new Error(`Unknown event "${event}"`);

    channelRef.current.trigger(serverEvent, data);
  }, []);

  const addListener = React.useCallback((fn) => {
    listenersRef.current = [...listenersRef.current, fn];
    return () => {
      listenersRef.current.filter((fn_) => fn !== fn_);
    };
  }, []);

  React.useEffect(() => {
    Pusher.logToConsole = debug;

    const pusher = new Pusher(PUSHER_KEY, {
      cluster: "eu",
      authEndpoint: `${API_ENDPOINT}/websockets/auth`,
      auth: {
        params: { provider: "pusher" },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });

    const channel = pusher.subscribe(`private-${user.id}`);
    channelRef.current = channel;

    channel.bind("pusher:subscription_succeeded", () => {
      channel.trigger("client-connection-request", { no: "data" });
    });

    const serverEvents = Object.keys(serverEventMap);

    for (let event of serverEvents)
      channel.bind(event, (data) => {
        const clientEventName = serverEventMap[event];
        listenersRef.current.forEach((fn) => fn(clientEventName, data));
      });
  }, [user.id, accessToken]);

  return { send, addListener };
};

export default useServerConnection;
