import React from "react";
import { useSearchParams } from "react-router-dom";
import { css } from "@emotion/react";
import { TITLE_BAR_HEIGHT } from "../constants/ui";
import { useAuth } from "@shades/common";
import * as eth from "../utils/ethereum";
import usePageVisibilityChangeListener from "../hooks/page-visibility-change-listener";
import * as Tooltip from "../components/tooltip";
import Spinner from "../components/spinner";

const isNative = window.Native != null;

const SignInScreen = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { accessToken, signIn, verifyAccessToken } = useAuth();

  const providerRef = React.useRef();

  const [isProviderConnected, setProviderConnected] = React.useState(false);
  const [selectedChainId, setSelectedChainId] = React.useState(null);
  const [selectedAddress, setSelectedAddress] = React.useState(null);
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState(null);

  const handleClickConnectWallet = async () => {
    setError(null);

    try {
      setStatus("requesting-address");
      const addresses = await providerRef.current.request({
        method: "eth_requestAccounts",
      });
      handleAccountsChange(addresses);
      setStatus("idle");
    } catch (e) {
      // Love WalletConnect
      if (e.message === "User closed modal") {
        await connectProvider();
        setStatus("idle");
        return;
      }

      if (e.code === 4001) {
        // User rejected the request
        setStatus("idle");
        return;
      }

      setStatus("idle");
      setError("connect-wallet-error");
      console.error(e);
    }
  };

  const handleClickSignIn = async () => {
    setError(null);
    setStatus("requesting-signature");

    eth
      .signAddress(providerRef.current, selectedAddress)
      .catch((e) =>
        Promise.reject(
          new Error(
            e.code === 4001
              ? "signature-rejected"
              : "signature-rejected-or-failed"
          )
        )
      )
      .then(([signature, message, signedAt, nonce]) => {
        setStatus("requesting-access-token");
        return signIn({
          message,
          signature,
          signedAt,
          address: selectedAddress,
          nonce,
        }).catch(() => Promise.reject(new Error("login-error")));
      })
      .catch((e) => {
        setStatus("idle");
        setError(e.message);
      });
  };

  const handleChainChange = React.useCallback((chainId) => {
    eth.numberToHex(parseInt(chainId)).then((hexChainId) => {
      setSelectedChainId(hexChainId);
    });
  }, []);

  const handleAccountsChange = React.useCallback((accounts) => {
    if (accounts.length === 0) {
      setSelectedAddress(null);
      return;
    }

    // Login endpoint expects a checksum address
    eth.getChecksumAddress(accounts[0]).then((a) => {
      setSelectedAddress(a);
    });
  }, []);

  const updateChainId = React.useCallback(
    async (provider) => {
      try {
        const chainId = await provider.request({ method: "net_version" });
        handleChainChange(chainId);
      } catch (e) {
        setSelectedChainId("unsupported");
      }
    },
    [handleChainChange]
  );

  const updateAccount = React.useCallback(
    async (provider) => {
      try {
        const addresses = await provider.request({ method: "eth_accounts" });
        handleAccountsChange(addresses);
      } catch (e) {
        handleAccountsChange([]);
      }
    },
    [handleAccountsChange]
  );

  const connectProvider = React.useCallback(async () => {
    const provider = await eth.connectProvider();
    providerRef.current = provider;

    provider.on("accountsChanged", handleAccountsChange);

    provider.on("chainChanged", handleChainChange);

    provider.on("disconnect", () => {
      setStatus("idle");
      setSelectedAddress(null);
      setSelectedChainId(null);

      // WalletConnect kills the previous provider so we have to reconnect
      if (provider.isWalletConnect) connectProvider();
    });

    await updateChainId(provider);

    // WalletConnect will prompt the connect modal when sending requests
    if (!provider.isWalletConnect) {
      try {
        const permissions = await provider.request({
          method: "wallet_getPermissions",
        });
        if (permissions.some((p) => p.parentCapability === "eth_accounts"))
          updateAccount(provider);
      } catch (e) {
        // We can’t expect wallet_getPermissions to be supported
      }
    }

    setProviderConnected(true);

    return provider;
  }, [updateChainId, updateAccount, handleChainChange, handleAccountsChange]);

  React.useEffect(() => {
    connectProvider();
  }, [connectProvider]);

  React.useEffect(() => {
    if (accessToken == null || searchParams.get("redirect") == null) return;

    verifyAccessToken().then(() => {
      searchParams.set("token", encodeURIComponent(accessToken));
      setSearchParams(searchParams);
    });
  }, [accessToken, verifyAccessToken, searchParams, setSearchParams]);

  usePageVisibilityChangeListener((visibilityState) => {
    if (visibilityState !== "visible" || providerRef.current == null) return;

    if (selectedAddress != null) updateAccount(providerRef.current);

    updateChainId(providerRef.current);
  });

  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        text-align: center;
        padding: 2rem;

        & > * {
          min-width: 0;
        }
      `}
      style={{
        height: isNative ? `calc(100% - ${TITLE_BAR_HEIGHT})` : "100%",
      }}
    >
      {!isProviderConnected || selectedChainId == null ? (
        <Spinner color="rgb(255 255 255 / 15%)" size="2.6rem" />
      ) : selectedChainId !== "0x1" ? (
        status === "requesting-network-switch" ? (
          <div>
            <Spinner
              color="rgb(255 255 255 / 15%)"
              size="2.4rem"
              style={{ margin: "0 auto 2rem" }}
            />
            <div style={{ marginBottom: "1rem" }}>
              Requesting network change...
            </div>
            <Small>Check your wallet</Small>
          </div>
        ) : (
          <div>
            <div style={{ margin: "0 0 2rem", color: "#ffc874" }}>
              Network not supported
            </div>
            <Button
              onClick={() => {
                setError(null);
                setStatus("requesting-network-switch");
                providerRef.current
                  .request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: "0x1" }],
                  })
                  .catch(() => {
                    // Ignore
                  })
                  .then(() => {
                    setStatus("idle");
                  });
              }}
            >
              Switch to Ethereum Mainnet
            </Button>
          </div>
        )
      ) : status === "requesting-address" ? (
        <div>
          <Spinner
            color="rgb(255 255 255 / 15%)"
            size="2.4rem"
            style={{ margin: "0 auto 2rem" }}
          />
          <div style={{ marginBottom: "1rem" }}>
            Requesting wallet address...
          </div>
          <Small>Check your wallet</Small>
        </div>
      ) : status === "requesting-signature" ? (
        <div>
          <Spinner
            color="rgb(255 255 255 / 15%)"
            size="2.4rem"
            style={{ margin: "0 auto 2rem" }}
          />
          <div style={{ marginBottom: "1rem" }}>
            Requesting signature from {eth.truncateAddress(selectedAddress)}
            ...
          </div>
          <Small>Check your wallet</Small>
        </div>
      ) : status === "requesting-access-token" ? (
        <div>
          <Spinner
            color="rgb(255 255 255 / 15%)"
            size="2.4rem"
            style={{ margin: "0 auto 2rem" }}
          />
          Signing in...
        </div>
      ) : (
        <div>
          {error != null && (
            <div style={{ color: "#ff9e9e", margin: "0 0 3.4rem" }}>
              {error === "connect-wallet-error"
                ? "Could not connect to wallet"
                : error === "signature-rejected"
                ? "Signature rejected by user"
                : error === "signature-rejected-or-failed"
                ? "Signature rejected or failed"
                : error === "login-error"
                ? "Could not log in address. Check console for hints if you’re into that kind of thing."
                : "A wild error has appeard! Check you Internet connection or go grab a snack."}
            </div>
          )}
          {selectedAddress == null ? (
            <>
              <Button onClick={handleClickConnectWallet}>Connect wallet</Button>
              <Small
                style={{
                  width: "42rem",
                  maxWidth: "100%",
                  marginTop: "2rem",
                  lineHeight: 1.3,
                }}
              >
                Make sure to enable any browser extension wallets before you try
                to connect. If you use a mobile wallet, no action is requred.
              </Small>
            </>
          ) : (
            <>
              <Button onClick={handleClickSignIn}>
                Log in with wallet signature
              </Button>
              <div
                css={(theme) =>
                  css({
                    fontSize: theme.fontSizes.small,
                    color: theme.colors.textMuted,
                    marginTop: "2rem",
                  })
                }
              >
                Connected as{" "}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <a
                      href={`https://etherscan.io/address/${selectedAddress}`}
                      rel="noreferrer"
                      target="_blank"
                      css={(theme) =>
                        css({
                          color: theme.colors.linkColor,
                          ":hover": { color: theme.colors.linkColorHighlight },
                        })
                      }
                    >
                      {eth.truncateAddress(selectedAddress)}
                    </a>
                  </Tooltip.Trigger>
                  <Tooltip.Content side="top" sideOffset={4}>
                    <div>
                      Click to see address on{" "}
                      <span
                        css={(theme) =>
                          css({
                            color: theme.colors.linkColor,
                            marginBottom: "0.3rem",
                          })
                        }
                      >
                        etherscan.io
                      </span>
                    </div>
                    <div
                      css={(theme) => css({ color: theme.colors.textMuted })}
                    >
                      {selectedAddress}
                    </div>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const Button = ({ css: cssProp, ...props }) => (
  <button
    css={css`
      color: white;
      background: hsl(0 0% 100% / 7%);
      border: 0;
      padding: 1.1rem 2.4rem;
      font-weight: 500;
      font-size: 1.5rem;
      border-radius: 0.3rem;
      cursor: pointer;
      transition: 0.15s ease-out background;
      text-align: center;
      :hover {
        background: hsl(0 0% 100% / 9%);
      }
      ${cssProp}
    `}
    {...props}
  />
);

const Small = (props) => (
  <div
    css={(theme) =>
      css({
        fontSize: theme.fontSizes.small,
        color: theme.colors.textMuted,
      })
    }
    {...props}
  />
);

export default SignInScreen;
