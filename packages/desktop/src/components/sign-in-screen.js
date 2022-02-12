import React from "react";
import { useSearchParams } from "react-router-dom";
import { css } from "@emotion/react";
import { TITLE_BAR_HEIGHT } from "../constants/ui";
import * as eth from "../utils/ethereum";
import { useAuth } from "@shades/common";

const isNative = window.Native != null;

const SignInScreen = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { accessToken, signIn, verifyAccessToken } = useAuth();

  const [status, setStatus] = React.useState("idle");
  const [signInError, setSignInError] = React.useState(null);

  const handleClickSignIn = async () => {
    setSignInError(null);

    try {
      setStatus("connecting-provider");
      const provider = await eth.connectProvider();

      setStatus("requesting-address");
      const addresses = await eth.getUserAccounts(provider);
      setStatus("requesting-signature");
      const [signature, message, signedAt, nonce] = await eth.signAddress(
        provider,
        addresses[0]
      );

      setStatus("requesting-access-token");
      await signIn({
        message,
        signature,
        signedAt,
        address: addresses[0],
        nonce,
      });
    } catch (e) {
      setStatus("idle");

      if (e.message === "wallet-connect:user-closed-modal") return;

      console.error(e);
      setSignInError(e.message);
    }
  };

  React.useEffect(() => {
    if (accessToken == null || searchParams.get("redirect") == null) return;

    verifyAccessToken().then(() => {
      searchParams.set("token", encodeURIComponent(accessToken));
      setSearchParams(searchParams);
    });
  }, [accessToken, verifyAccessToken, searchParams, setSearchParams]);

  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        text-align: center;
        padding: 2rem;
      `}
      style={{
        height: isNative ? `calc(100vh - ${TITLE_BAR_HEIGHT})` : "100vh",
      }}
    >
      {status === "connecting-provider" ? (
        "Connecting wallet..."
      ) : status === "requesting-address" ? (
        "Requesting wallet address..."
      ) : status === "requesting-signature" ? (
        "Requesting signature..."
      ) : status === "requesting-access-token" ? (
        "Signing in..."
      ) : (
        <div>
          {signInError != null && (
            <div style={{ fontSize: "1.4rem", margin: "0 0 5rem" }}>
              Something went wrong. Check the console for hints if you’re into
              that kind of thing.
            </div>
          )}
          <Button onClick={handleClickSignIn}>Sign in with wallet</Button>
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
      :hover {
        background: hsl(0 0% 100% / 9%);
      }
      ${cssProp}
    `}
    {...props}
  />
);

export default SignInScreen;
