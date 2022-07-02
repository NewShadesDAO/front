import {
  WagmiConfig,
  createClient as createWagmiClient,
  configureChains as configureWagmiChains,
  chain as wagmiChain,
} from "wagmi";
import { infuraProvider } from "wagmi/providers/infura";
import { publicProvider } from "wagmi/providers/public";
import { InjectedConnector } from "wagmi/connectors/injected";
import { WalletConnectConnector } from "wagmi/connectors/walletConnect";
import React from "react";
import { css } from "@emotion/react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { IntlProvider } from "react-intl";
import { ThemeProvider, Global } from "@emotion/react";
import Pusher from "pusher-js";
import {
  useAuth,
  AuthProvider,
  useAppScope,
  useLatestCallback,
  AppScopeProvider,
  ServerConnectionProvider,
} from "@shades/common";
import * as eth from "./utils/ethereum";
import { Provider as GlobalMediaQueriesProvider } from "./hooks/global-media-queries";
import { send as sendNotification } from "./utils/notifications";
import useWindowFocusListener from "./hooks/window-focus-listener";
import useOnlineListener from "./hooks/window-online-listener";
import { Provider as SideMenuProvider } from "./hooks/side-menu";
import useWalletEvent from "./hooks/wallet-event";
import useWalletLogin, {
  Provider as WalletLoginProvider,
} from "./hooks/wallet-login";
import { generateCachedAvatar } from "./components/avatar";
import LoginScreen from "./components/login-screen";
import Channel, { Header as ChannelHeader } from "./components/channel";
import Discover from "./components/discover";
import JoinServer from "./components/join-server";
import { UnifiedLayout } from "./components/layouts";
import TitleBar from "./components/title-bar";
import * as Tooltip from "./components/tooltip";
import {
  ChatBubbles as ChatBubblesIcon,
  Home as HomeIcon,
} from "./components/icons";
import useSideMenu from "./hooks/side-menu";
import { notion as defaultTheme } from "./themes";

const isNative = window.Native != null;

const { chains, provider } = configureWagmiChains(
  [wagmiChain.mainnet],
  [
    infuraProvider({ infuraId: process.env.INFURA_PROJECT_ID }),
    publicProvider(),
  ]
);

const wagmiClient = createWagmiClient({
  autoConnect: true,
  provider,
  connectors: [
    new InjectedConnector({ chains }),
    new WalletConnectConnector({
      chains,
      options: {
        qrcode: true,
      },
    }),
  ],
});

const useSystemNotifications = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { state, addAfterDispatchListener } = useAppScope();

  const afterDispatchListener = useLatestCallback((action) => {
    switch (action.type) {
      case "server-event:message-created": {
        const message = state.selectMessage(action.data.message.id);

        if (message.authorUserId === user.id) break;

        const hasUnread = state.selectChannelHasUnread(message.channelId);

        if (!hasUnread) break;

        const channel = state.selectChannel(message.channelId);

        sendNotification({
          title: `Message from ${message.author.displayName}`,
          body: message.stringContent,
          icon:
            message.author.profilePicture.small ??
            generateCachedAvatar(message.author.walletAddress, {
              pixelSize: 24,
            }),
          onClick: ({ close }) => {
            navigate(
              channel.kind !== "server"
                ? `/channels/${channel.id}`
                : `/channels/${channel.serverId}/${channel.id}`
            );
            window.focus();
            close();
          },
        });

        break;
      }

      default: // Ignore
    }
  });

  React.useEffect(() => {
    if (window.Notification?.permission !== "granted") return;
    const removeListener = addAfterDispatchListener(afterDispatchListener);
    return () => {
      removeListener();
    };
  }, [addAfterDispatchListener, afterDispatchListener]);
};

const App = () => {
  const navigate = useNavigate();

  const { user, status: authStatus } = useAuth();
  const { state, actions } = useAppScope();
  const { login } = useWalletLogin();

  const { fetchInitialData, fetchStarredItems, fetchServers } = actions;

  const hasFetchedInitialData = state.selectHasFetchedInitialData();

  useSystemNotifications();

  useWalletEvent("disconnect", () => {
    if (authStatus === "not-authenticated") return;
    if (!confirm("Wallet disconnected. Do you wish to log out?")) return;
    actions.logout();
    navigate("/");
  });

  useWalletEvent("account-change", (newAddress, previousAddress) => {
    if (
      // Ignore initial connect
      previousAddress == null ||
      // We only care about logged in users
      authStatus === "not-authenticated" ||
      user?.wallet_address.toLowerCase() === newAddress.toLowerCase()
    )
      return;

    // Suggest login with new account
    if (
      !confirm(
        `Do you wish to login as ${eth.truncateAddress(newAddress)} instead?`
      )
    )
      return;

    actions.logout();
    login(newAddress).then(() => {
      navigate("/");
    });
  });

  React.useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetchServers();
  }, [authStatus, fetchServers]);

  React.useEffect(() => {
    if (user == null || hasFetchedInitialData) return null;
    fetchInitialData();
  }, [user, fetchInitialData, hasFetchedInitialData]);

  React.useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetchStarredItems();
  }, [authStatus, fetchStarredItems]);

  useWindowFocusListener(() => {
    actions.fetchInitialData();
  });

  useOnlineListener(() => {
    actions.fetchInitialData();
  });

  return (
    <>
      <Global
        styles={(theme) =>
          css({
            body: {
              color: theme.colors.textNormal,
              fontFamily: theme.fontStacks.default,
              "::selection": {
                background: theme.colors.textSelectionBackground,
              },
            },
          })
        }
      />

      {isNative && <TitleBar />}

      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <UnifiedLayout />
            </RequireAuth>
          }
        >
          <Route index element={<EmptyHome />} />
          <Route path="starred" element={<Channel />} />
          <Route path="starred/channels/:channelId" element={<Channel />} />
          <Route path="/channels">
            <Route
              index
              element={
                <div
                  css={(theme) =>
                    css({
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                      background: theme.colors.backgroundPrimary,
                    })
                  }
                >
                  <ChatBubblesIcon
                    style={{
                      width: "6rem",
                      color: "rgb(255 255 255 / 5%)",
                    }}
                  />
                </div>
              }
            />
            <Route path=":channelId" element={<Channel />} />
          </Route>
          <Route path="c/:channelId" element={<Channel noSideMenu />} />
          <Route path="servers/:serverId" element={<Channel />} />
          <Route
            path="servers/:serverId/:channelId"
            element={<Channel server />}
          />
        </Route>

        <Route
          path="/discover"
          element={
            <RequireAuth>
              <Discover />
            </RequireAuth>
          }
        />
        {/* Public routes below */}
        <Route path="/servers/:serverId/join" element={<JoinServer />} />
        <Route path="*" element={null} />
      </Routes>
    </>
  );
};

const EmptyHome = () => {
  // const { state } = useAppScope();
  const { isFloating: isMenuTogglingEnabled } = useSideMenu();
  // const hasFetchedInitialData = state.selectHasFetchedInitialData();
  // const starredChannels = state.selectStarredChannels();
  // const hasNoStarredChannels =
  //   hasFetchedInitialData && starredChannels.length === 0;
  return (
    <div
      css={(theme) =>
        css({
          flex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: theme.colors.backgroundPrimary,
        })
      }
    >
      {isMenuTogglingEnabled && <ChannelHeader />}
      <div
        css={css({
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        })}
      >
        <div
          css={css({
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          })}
        >
          <HomeIcon
            style={{
              width: "6rem",
              color: "rgb(255 255 255 / 5%)",
            }}
          />
        </div>
      </div>
    </div>
  );
};

const RequireAuth = ({ children }) => {
  const { status: authStatus } = useAuth();

  if (authStatus === "not-authenticated") return <LoginScreen />;

  if (authStatus !== "authenticated") return null; // Spinner

  return children;
};

export default function Root() {
  return (
    <React.StrictMode>
      <WagmiConfig client={wagmiClient}>
        <IntlProvider locale="en">
          <AuthProvider apiOrigin="/api">
            <ServerConnectionProvider
              Pusher={Pusher}
              pusherKey={process.env.PUSHER_KEY}
            >
              <AppScopeProvider>
                <WalletLoginProvider>
                  <ThemeProvider theme={defaultTheme}>
                    <Tooltip.Provider delayDuration={300}>
                      <SideMenuProvider>
                        <GlobalMediaQueriesProvider>
                          <App />
                        </GlobalMediaQueriesProvider>
                      </SideMenuProvider>
                    </Tooltip.Provider>
                  </ThemeProvider>
                </WalletLoginProvider>
              </AppScopeProvider>
            </ServerConnectionProvider>
          </AuthProvider>
        </IntlProvider>
      </WagmiConfig>
    </React.StrictMode>
  );
}
