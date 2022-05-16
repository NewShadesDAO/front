import throttle from "lodash.throttle";
import React from "react";
import { useParams } from "react-router";
import { css } from "@emotion/react";
import {
  useAppScope,
  useLatestCallback,
  getImageFileDimensions,
} from "@shades/common";
import usePageVisibilityChangeListener from "../hooks/page-visibility-change-listener";
import stringifyMessageBlocks from "../slate/stringify";
import { createEmptyParagraph, isNodeEmpty, cleanNodes } from "../slate/utils";
import useCommands from "../hooks/commands";
import MessageInput from "./message-input";
import Spinner from "./spinner";
import ChannelMessage from "./channel-message";
import { Hash as HashIcon, AtSign as AtSignIcon } from "./icons";
import {
  HamburgerMenu as HamburgerMenuIcon,
  PlusCircle as PlusCircleIcon,
  CrossCircle as CrossCircleIcon,
} from "./icons";
import useSideMenu from "../hooks/side-menu";
import useIsOnScreen from "../hooks/is-on-screen";
import useScrollListener from "../hooks/scroll-listener";
import useMutationObserver from "../hooks/mutation-observer";

// This fetcher only allows for a single request (with the same query) to be
// pending at once. Subsequent "equal" request will simply return the initial
// pending request promise.
const useMessageFetcher = () => {
  const pendingPromisesRef = React.useRef({});
  const { actions } = useAppScope();

  const fetchMessages = useLatestCallback(
    async (channelId, { limit, beforeMessageId, afterMessageId } = {}) => {
      const key = new URLSearchParams([
        ["limit", limit],
        ["before-message-id", beforeMessageId],
        ["after-message-id", afterMessageId],
      ]).toString();

      let pendingPromise = pendingPromisesRef.current[key];

      if (pendingPromise == null) {
        pendingPromise = actions.fetchMessages(channelId, {
          limit,
          beforeMessageId,
          afterMessageId,
        });
        pendingPromisesRef.current[key] = pendingPromise;
      }

      try {
        return await pendingPromise;
      } finally {
        delete pendingPromisesRef.current[key];
      }
    }
  );

  return fetchMessages;
};

const useMessages = (channelId) => {
  const { state } = useAppScope();
  const unsortedMessages = state.selectChannelMessages(channelId);
  const hasAllMessages = state.selectHasAllMessages(channelId);

  const messages = React.useMemo(
    () =>
      unsortedMessages.sort(
        (m1, m2) => new Date(m1.created_at) - new Date(m2.created_at)
      ),
    [unsortedMessages]
  );

  return { messages, hasAllMessages };
};

const useScroll = (scrollContainerRef, channelId) => {
  const [didScrollToBottom, setScrolledToBottom] = React.useState(false);

  const scrollToBottom = React.useCallback(
    (options) => {
      const isScrollable =
        scrollContainerRef.current.scrollHeight >
        scrollContainerRef.current.getBoundingClientRect().height;

      if (!isScrollable) {
        setScrolledToBottom(true);
        return;
      }

      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        ...options,
      });
    },
    [scrollContainerRef]
  );

  React.useEffect(() => {
    const { scrollTop: cachedScrollTop } = scrollPositionCache[channelId] ?? {};

    if (cachedScrollTop == null) {
      scrollToBottom();
      return;
    }

    scrollContainerRef.current.scrollTop = cachedScrollTop;
  }, [scrollContainerRef, channelId, scrollToBottom]);

  useScrollListener(scrollContainerRef, (e) => {
    scrollPositionCache[channelId] = { scrollTop: e.target.scrollTop };

    const isAtBottom =
      Math.ceil(e.target.scrollTop) + e.target.getBoundingClientRect().height >=
      e.target.scrollHeight;

    setScrolledToBottom(isAtBottom);
  });

  return { didScrollToBottom, scrollToBottom };
};

const useReverseScrollPositionMaintainer = (scrollContainerRef) => {
  // Whenever this ref is truthy we will try to maintain the scroll position
  // (keep the same distance to the bottom) when the scroll container’s scroll
  // height changes
  const maintainScrollPositionRef = React.useRef(false);

  const maintainScrollPositionDuringTheNextDomMutation =
    React.useCallback(() => {
      maintainScrollPositionRef.current = true;
    }, []);

  const prevScrollHeightRef = React.useRef();
  const prevScrollTopRef = React.useRef();

  React.useEffect(() => {
    if (prevScrollHeightRef.current == null)
      prevScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
    if (prevScrollTopRef.current == null)
      prevScrollTopRef.current = scrollContainerRef.current.scrollTop;
  }, [scrollContainerRef]);

  useMutationObserver(
    scrollContainerRef,
    () => {
      const el = scrollContainerRef.current;

      if (maintainScrollPositionRef.current) {
        maintainScrollPositionRef.current = false;

        if (prevScrollHeightRef.current === el.scrollHeight) return;

        const scrollHeightDiff = el.scrollHeight - prevScrollHeightRef.current;

        // console.log(
        //   "scroll adjust",
        //   [el.scrollTop, prevScrollHeightRef.current + scrollHeightDiff].join(
        //     " -> "
        //   )
        // );

        // Even with 'overflow-anchor' set to 'none', some browsers still mess
        // with the scroll, so we keep track of the most recent position in
        // `prevScrollTopRef` and use that when adjusting `scrollTop`
        el.scrollTop = prevScrollTopRef.current + scrollHeightDiff;
        prevScrollTopRef.current = el.scrollTop;
      }

      // if (prevScrollHeightRef.current !== el.scrollHeight) {
      //   console.log(
      //     "height change",
      //     [prevScrollHeightRef.current, el.scrollHeight].join(" -> ")
      //   );
      // }

      prevScrollHeightRef.current = el.scrollHeight;
    },
    { subtree: true, childList: true }
  );

  useScrollListener(scrollContainerRef, () => {
    prevScrollTopRef.current = scrollContainerRef.current.scrollTop;
  });

  return maintainScrollPositionDuringTheNextDomMutation;
};

const scrollPositionCache = {};

export const ChannelBase = ({
  channel,
  members,
  typingMembers,
  isAdmin = false,
  createMessage,
  headerContent,
}) => {
  const { actions, state, serverConnection, addBeforeDispatchListener } =
    useAppScope();

  const messagesContainerRef = React.useRef();
  const scrollContainerRef = React.useRef();

  const maintainScrollPositionDuringTheNextDomMutation =
    useReverseScrollPositionMaintainer(scrollContainerRef);

  const { didScrollToBottom, scrollToBottom } = useScroll(
    scrollContainerRef,
    channel.id
  );
  const didScrollToBottomRef = React.useRef(didScrollToBottom);
  React.useEffect(() => {
    didScrollToBottomRef.current = didScrollToBottom;
  });

  React.useEffect(() => {
    const removeListener = addBeforeDispatchListener((action) => {
      // Maintain scroll position when new messages arrive
      if (action.type === "messages-fetched" && action.channelId === channel.id)
        maintainScrollPositionDuringTheNextDomMutation();
    });
    return () => {
      removeListener();
    };
  }, [
    channel.id,
    addBeforeDispatchListener,
    maintainScrollPositionDuringTheNextDomMutation,
  ]);

  const fetchMessages_ = useMessageFetcher();
  const fetchMessages = useLatestCallback((channelId, query) => {
    if (query.beforeMessageId) {
      // Maintain scroll position when we render the loading placeholder
      maintainScrollPositionDuringTheNextDomMutation();
      setPendingMessagesBeforeCount(query.limit);
    }

    return fetchMessages_(channelId, query).finally(() => {
      if (query.beforeMessageId) {
        // Maintain scroll position when we remove the loading placeholder
        maintainScrollPositionDuringTheNextDomMutation();
        setPendingMessagesBeforeCount(0);
      }
    });
  });

  const { messages, hasAllMessages } = useMessages(channel.id);

  const { isFloating: isMenuTogglingEnabled, toggle: toggleMenu } =
    useSideMenu();

  const getMember = React.useCallback(
    (ref) => members.find((m) => m.id === ref),
    [members]
  );

  const inputRef = React.useRef();

  React.useEffect(() => {
    inputRef.current.focus();
  }, [inputRef, channel.id]);

  const [pendingReplyMessageId, setPendingReplyMessageId] =
    React.useState(null);

  const initReply = React.useCallback((messageId) => {
    setPendingReplyMessageId(messageId);
    inputRef.current.focus();
  }, []);

  const cancelReply = React.useCallback(() => {
    setPendingReplyMessageId(null);
    inputRef.current.focus();
  }, []);

  React.useEffect(() => {
    if (messages.length !== 0) return;

    // This should be called after the first render, and when navigating to
    // emply channels
    fetchMessages(channel.id, { limit: 50 });
  }, [fetchMessages, channel.id, messages.length]);

  const channelHasUnread = state.selectChannelHasUnread(channel.id);

  const [pendingMessagesBeforeCount, setPendingMessagesBeforeCount] =
    React.useState(0);

  const [averageMessageListItemHeight, setAverageMessageListItemHeight] =
    React.useState(0);

  React.useEffect(() => {
    if (messages.length === 0) return;
    // Keep track of the average message height, so that we can make educated
    // guesses at what the placeholder height should be when fetching messages
    setAverageMessageListItemHeight(
      messagesContainerRef.current.scrollHeight / messages.length
    );
  }, [messages.length]);

  useScrollListener(scrollContainerRef, () => {
    // Bounce back when scrolling to the top of the "loading" placeholder. Makes
    // it feel like you keep scrolling like normal (ish).
    if (scrollContainerRef.current.scrollTop < 10 && pendingMessagesBeforeCount)
      scrollContainerRef.current.scrollTop =
        pendingMessagesBeforeCount * averageMessageListItemHeight -
        scrollContainerRef.current.getBoundingClientRect().height;
  });

  // Fetch new messages as the user scrolls up
  useScrollListener(scrollContainerRef, (e, { direction }) => {
    if (
      // We only care about upward scroll
      direction !== "up" ||
      // Wait until we have fetched the initial batch of messages
      messages.length === 0 ||
      // No need to react if we’ve already fetched the full message history
      hasAllMessages ||
      // Wait for any pending fetch requests to finish before we fetch again
      pendingMessagesBeforeCount !== 0
    )
      return;

    const isCloseToTop =
      // ~4 viewport heights from top
      e.target.scrollTop < e.target.getBoundingClientRect().height * 4;

    if (!isCloseToTop) return;

    fetchMessages(channel.id, {
      beforeMessageId: messages[0].id,
      limit: 50,
    });
  });

  // Mark channel as read when new messages arrive, if scrolled to bottom
  React.useEffect(() => {
    // Can’t send event if not connected
    if (!serverConnection.isConnected) return;

    if (messages.length === 0 || !didScrollToBottom || !channelHasUnread)
      return;

    // Ignore the users’s own messages before we know they have been persisted
    const lastPersistedMessage = messages
      .filter((m) => !m.isOptimistic)
      .slice(-1)[0];

    if (lastPersistedMessage != null)
      actions.markChannelRead({ channelId: channel.id });
  }, [
    actions,
    channel.id,
    channelHasUnread,
    messages,
    serverConnection.isConnected,
    didScrollToBottom,
  ]);

  const lastMessage = messages.slice(-1)[0];

  // Keep scroll at bottom when new messages arrive
  React.useEffect(() => {
    if (lastMessage == null || !didScrollToBottomRef.current) return;
    scrollToBottom();
  }, [lastMessage, scrollToBottom, didScrollToBottomRef]);

  usePageVisibilityChangeListener((state) => {
    if (state === "visible") return;
    actions.fetchInitialData();
    fetchMessages(channel.id, { limit: 50 });
  });

  const submitMessage = React.useCallback(
    (blocks) => {
      setPendingReplyMessageId(null);
      return createMessage({
        blocks,
        replyToMessageId: pendingReplyMessageId,
      });
    },
    [createMessage, pendingReplyMessageId]
  );

  const throttledRegisterTypingActivity = React.useMemo(
    () =>
      throttle(() => actions.registerChannelTypingActivity(channel.id), 3000, {
        trailing: false,
      }),
    [actions, channel.id]
  );
  const handleInputChange = React.useCallback(
    (blocks) => {
      if (blocks.length > 1 || !isNodeEmpty(blocks[0]))
        throttledRegisterTypingActivity();
    },
    [throttledRegisterTypingActivity]
  );

  return (
    <div
      css={(theme) => css`
        position: relative;
        z-index: 0;
        flex: 1;
        min-width: min(30.6rem, 100vw);
        background: ${theme.colors.backgroundPrimary};
        display: flex;
        flex-direction: column;
      `}
    >
      <div
        css={css({
          height: "4.8rem",
          padding: "0 1.6rem",
          display: "flex",
          alignItems: "center",
          boxShadow:
            "0 1px 0 rgba(4,4,5,0.2),0 1.5px 0 rgba(6,6,7,0.05),0 2px 0 rgba(4,4,5,0.05)",
        })}
      >
        {isMenuTogglingEnabled && (
          <button
            onClick={() => {
              toggleMenu();
            }}
            css={(theme) =>
              css({
                background: "none",
                border: 0,
                color: "white",
                cursor: "pointer",
                padding: "0.8rem 0.6rem",
                marginLeft: "-0.6rem",
                marginRight: "calc(-0.6rem + 1.6rem)",
                borderRadius: "0.4rem",
                ":hover": {
                  background: theme.colors.backgroundModifierHover,
                },
              })
            }
          >
            <HamburgerMenuIcon style={{ width: "1.5rem" }} />
          </button>
        )}
        {headerContent}
      </div>

      <div
        css={css({
          position: "relative",
          flex: 1,
          display: "flex",
          minHeight: 0,
          minWidth: 0,
        })}
      >
        <div
          ref={scrollContainerRef}
          css={css({
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflowY: "scroll",
            overflowX: "hidden",
            minHeight: 0,
            flex: 1,
            overflowAnchor: "none",
          })}
        >
          <div
            css={css({
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "stretch",
              minHeight: "100%",
            })}
          >
            {hasAllMessages && (
              <div
                css={css({ padding: "6rem 1.6rem 0" })}
                style={{ paddingBottom: messages.length !== 0 ? "1rem" : 0 }}
              >
                <div
                  css={(theme) =>
                    css({
                      borderBottom: "0.1rem solid",
                      borderColor: theme.colors.backgroundModifierAccent,
                      padding: "0 0 1.5rem",
                    })
                  }
                >
                  <div
                    css={(theme) =>
                      css({
                        fontSize: "2.5rem",
                        fontWeight: "500",
                        color: theme.colors.textHeader,
                        margin: "0 0 0.5rem",
                      })
                    }
                  >
                    Welcome to #{channel.name}!
                  </div>
                  <div
                    css={(theme) =>
                      css({
                        fontSize: theme.fontSizes.default,
                        color: theme.colors.textHeaderSecondary,
                      })
                    }
                  >
                    This is the start of #{channel.name}.
                  </div>
                </div>
              </div>
            )}
            {!hasAllMessages && messages.length > 0 && (
              <OnScreenTrigger
                callback={() => {
                  // This should only happen on huge viewports where all messages from the
                  // initial fetch fit in view without a scrollbar. All other cases should be
                  // covered by the scroll listener
                  fetchMessages(channel.id, {
                    beforeMessageId: messages[0].id,
                    limit: 30,
                  });
                }}
              />
            )}
            {pendingMessagesBeforeCount > 0 && (
              <div
                css={css({
                  height: `${
                    pendingMessagesBeforeCount * averageMessageListItemHeight
                  }px`,
                })}
              />
            )}
            <div
              ref={messagesContainerRef}
              css={(theme) =>
                css({
                  minHeight: 0,
                  fontSize: theme.fontSizes.channelMessages,
                  fontWeight: "400",
                })
              }
            >
              {messages.map((m, i, ms) => (
                <ChannelMessage
                  key={m.id}
                  channel={channel}
                  message={m}
                  previousMessage={ms[i - 1]}
                  hasPendingReply={pendingReplyMessageId === m.id}
                  initReply={initReply}
                  members={members}
                  getMember={getMember}
                  isAdmin={isAdmin}
                />
              ))}
              <div css={css({ height: "1.6rem" })} />
            </div>
          </div>
        </div>
      </div>
      <div css={css({ padding: "0 1.6rem 2.4rem", position: "relative" })}>
        <NewMessageInput
          ref={inputRef}
          isDM={channel.kind === "dm"}
          serverId={channel.serverId}
          channelId={channel.id}
          replyingToMessage={
            pendingReplyMessageId == null
              ? null
              : state.selectMessage(pendingReplyMessageId)
          }
          cancelReply={cancelReply}
          uploadImage={actions.uploadImage}
          submit={submitMessage}
          placeholder={
            channel.kind === "dm"
              ? `Message ${channel.name}`
              : `Message #${channel.name}`
          }
          members={members}
          getMember={getMember}
          onInputChange={handleInputChange}
        />
        {typingMembers.length > 0 && (
          <TypingIndicator members={typingMembers} />
        )}
      </div>
    </div>
  );
};

const TypingIndicator = ({ members }) => (
  <div
    css={(theme) =>
      css({
        position: "absolute",
        left: 0,
        bottom: 0,
        padding: "0 1.5rem 0.4rem 6.5rem",
        pointerEvents: "none",
        color: theme.colors.textHeaderSecondary,
        width: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
        fontSize: theme.fontSizes.tiny,
        strong: { fontWeight: "600" },
      })
    }
  >
    {/* <svg width="24.5" height="7"> */}
    {/*   <g> */}
    {/*     <circle cx="3.5" cy="3.5" r="3.5" fill="currentColor" /> */}
    {/*     <circle cx="12.25" cy="3.5" r="3.5" fill="currentColor" /> */}
    {/*     <circle cx="21" cy="3.5" r="3.5" fill="currentColor" /> */}
    {/*   </g> */}
    {/* </svg> */}
    <span aria-live="polite" aria-atomic="true">
      {members.length === 1 ? (
        <strong>{members[0].displayName}</strong>
      ) : members.length === 2 ? (
        <>
          {members[0].displayName} and {members[1].displayName}
        </>
      ) : (
        members.map((m, i, ms) => {
          if (i === 0) return <strong key={m.id}>{m.displayName}</strong>;
          const isLast = i === ms.length - 1;
          if (isLast)
            return (
              <React.Fragment key={m.id}>
                {" "}
                , and<strong>{m.displayName}</strong>
              </React.Fragment>
            );
          return (
            <React.Fragment key={m.id}>
              {" "}
              , <strong>{m.displayName}</strong>
            </React.Fragment>
          );
        })
      )}{" "}
      is typing...
    </span>
  </div>
);

const NewMessageInput = React.memo(
  React.forwardRef(function NewMessageInput_(
    {
      submit,
      uploadImage,
      replyingToMessage,
      cancelReply,
      isDM,
      serverId,
      channelId,
      onInputChange,
      ...props
    },
    editorRef
  ) {
    const [pendingMessage, setPendingMessage] = React.useState(() => [
      createEmptyParagraph(),
    ]);

    const [isPending, setPending] = React.useState(false);

    const [imageUploads, setImageUploads] = React.useState([]);

    const fileInputRef = React.useRef();
    const uploadPromiseRef = React.useRef();
    const previousPendingMessageRef = React.useRef(pendingMessage);

    React.useEffect(() => {
      if (previousPendingMessageRef.current !== pendingMessage) {
        onInputChange(pendingMessage);
      }
      previousPendingMessageRef.current = pendingMessage;
    }, [pendingMessage, onInputChange]);

    const {
      execute: executeCommand,
      isCommand,
      commands,
    } = useCommands({
      context: isDM ? "dm" : "server-channel",
      serverId,
      channelId,
    });

    const executeMessage = async () => {
      const blocks = cleanNodes(pendingMessage);

      const isEmpty = blocks.every(isNodeEmpty);

      if (
        isEmpty &&
        // We want to allow "empty" messages if it has attachements
        imageUploads.length === 0
      )
        return;

      const messageString = editorRef.current.string();

      if (messageString.startsWith("/")) {
        const [commandName, ...args] = messageString
          .slice(1)
          .split(" ")
          .map((s) => s.trim())
          .filter(Boolean);

        if (isCommand(commandName)) {
          setPending(true);
          try {
            await executeCommand(commandName, {
              args,
              editor: editorRef.current,
            });
          } catch (e) {
            alert(e.message);
          }
          setPending(false);
          return;
        }
      }

      // Regular submit if we don’t have pending file uploads
      if (imageUploads.length === 0 && uploadPromiseRef.current == null) {
        editorRef.current.clear();
        return submit(blocks);
      }

      const submitWithAttachments = (attachments) => {
        editorRef.current.clear();
        setImageUploads([]);

        const attachmentsBlock = {
          type: "attachments",
          children: attachments.map((u) => ({
            type: "image-attachment",
            url: u.url,
            width: u.width,
            height: u.height,
          })),
        };

        return submit([...blocks, attachmentsBlock]);
      };

      if (uploadPromiseRef.current == null)
        return submitWithAttachments(imageUploads);

      // Craziness otherwise
      try {
        setPending(true);
        const attachments = await uploadPromiseRef.current.then();
        // Only mark as pending during the upload phase. We don’t want to wait
        // for the message creation to complete since the UI is optimistic
        // and adds the message right away
        setPending(false);
        submitWithAttachments(attachments);
      } catch (e) {
        setPending(false);
        return Promise.reject(e);
      }
    };

    React.useEffect(() => {
      if (isPending) return;
      editorRef.current.focus();
    }, [isPending, editorRef]);

    return (
      <div css={css({ position: "relative" })}>
        {replyingToMessage && (
          <div
            css={(theme) =>
              css({
                position: "absolute",
                bottom: "100%",
                left: 0,
                width: "100%",
                display: "flex",
                alignItems: "center",
                background: theme.colors.backgroundSecondary,
                borderTopLeftRadius: "0.7rem",
                borderTopRightRadius: "0.7rem",
                padding: "0.6rem 1rem 0.6rem 1.1rem",
                fontSize: "1.2rem",
                color: "rgb(255 255 255 / 54%)",
              })
            }
          >
            <div css={css({ flex: 1, paddingTop: "0.2rem" })}>
              Replying to{" "}
              <span css={css({ fontWeight: "500" })}>
                {replyingToMessage.authorServerMember?.displayName}
              </span>
            </div>
            <button
              onClick={cancelReply}
              css={(theme) =>
                css({
                  color: theme.colors.interactiveNormal,
                  cursor: "pointer",
                  ":hover": { color: theme.colors.interactiveHover },
                })
              }
            >
              <CrossCircleIcon style={{ width: "1.6rem", height: "auto" }} />
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeMessage();
          }}
          css={(theme) =>
            css({
              padding: "1rem",
              maxHeight: "60vh",
              overflow: "auto",
              background: theme.colors.channelInputBackground,
              borderRadius: "0.7rem",
              borderTopLeftRadius: replyingToMessage ? 0 : undefined,
              borderTopRightRadius: replyingToMessage ? 0 : undefined,
              "[role=textbox] [data-slate-placeholder]": {
                color: "rgb(255 255 255 / 40%)",
                opacity: "1 !important",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
              // Prevents iOS zooming in on input fields
              "@supports (-webkit-touch-callout: none)": {
                "[role=textbox]": { fontSize: "1.6rem" },
              },
            })
          }
          // TODO: Nicer pending state
          style={{ opacity: isPending ? 0.5 : 1 }}
        >
          <div
            css={{
              display: "grid",
              gridTemplateColumns: "auto minmax(0,1fr)",
              gridGap: "1.2rem",
              alignItems: "flex-start",
              paddingLeft: "0.3rem",
            }}
          >
            <button
              type="button"
              onClick={() => {
                fileInputRef.current.click();
              }}
              disabled={isPending}
              css={(theme) =>
                css({
                  cursor: "pointer",
                  color: theme.colors.interactiveNormal,
                  svg: {
                    display: "block",
                    width: "2.4rem",
                    height: "auto",
                  },
                  "&[disabled]": { pointerEvents: "none" },
                  ":hover": {
                    color: theme.colors.interactiveHover,
                  },
                })
              }
            >
              <PlusCircleIcon />
            </button>

            <MessageInput
              ref={editorRef}
              initialValue={pendingMessage}
              onChange={(value) => {
                setPendingMessage(value);
              }}
              onKeyDown={(e) => {
                if (
                  !e.isDefaultPrevented() &&
                  !e.shiftKey &&
                  e.key === "Enter"
                ) {
                  e.preventDefault();
                  executeMessage();
                }
              }}
              commands={commands}
              disabled={isPending}
              {...props}
            />
          </div>

          {imageUploads.length !== 0 && (
            <div
              css={css({
                overflow: "auto",
                paddingTop: "1.2rem",
                pointerEvents: isPending ? "none" : "all",
              })}
            >
              <AttachmentList
                items={imageUploads}
                remove={({ url }) => {
                  setImageUploads((fs) => fs.filter((f) => f.url !== url));
                }}
              />
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => {
              editorRef.current.focus();

              const filesToUpload = [...e.target.files];

              setImageUploads((fs) => [
                ...fs,
                ...filesToUpload.map((f) => ({
                  name: encodeURIComponent(f.name),
                  url: URL.createObjectURL(f),
                })),
              ]);

              fileInputRef.current.value = "";

              let lastImageUploads = imageUploads;

              // Buckle up!
              uploadPromiseRef.current = Promise.all([
                uploadPromiseRef.current ?? Promise.resolve(),
                ...filesToUpload.map((file) =>
                  Promise.all([
                    getImageFileDimensions(file),
                    uploadImage({ files: [file] }).catch(() => {
                      setImageUploads((fs) => {
                        const newImageUploads = fs.filter(
                          (f) => f.name !== file.name
                        );
                        lastImageUploads = newImageUploads;
                        return newImageUploads;
                      });
                      const error = new Error(
                        `Could not upload file "${file.name}"`
                      );
                      alert(error.message);
                      return Promise.reject(error);
                    }),
                  ]).then(([dimensions, [uploadedFile]]) => {
                    setImageUploads((fs) => {
                      const newImageUploads = fs.map((f) => {
                        if (!uploadedFile.filename.endsWith(f.name)) return f;
                        return {
                          id: uploadedFile.id,
                          name: uploadedFile.filename,
                          url: uploadedFile.variants.find((url) =>
                            url.endsWith("/public")
                          ),
                          previewUrl: f.url,
                          ...dimensions,
                        };
                      });

                      lastImageUploads = newImageUploads;
                      return newImageUploads;
                    });
                  })
                ),
              ]).then(() => {
                uploadPromiseRef.current = null;
                return lastImageUploads;
              });
            }}
            hidden
          />
          <input type="submit" hidden />
        </form>
      </div>
    );
  })
);

const AttachmentList = ({ items, remove }) => (
  <div
    css={(theme) =>
      css({
        display: "grid",
        gridAutoColumns: "max-content",
        gridAutoFlow: "column",
        justifyContent: "flex-start",
        gridGap: "1rem",
        img: {
          display: "block",
          width: "6rem",
          height: "6rem",
          borderRadius: "0.5rem",
          objectFit: "cover",
          background: theme.colors.backgroundSecondary,
        },
      })
    }
  >
    {items.map(({ id, url, previewUrl }) => (
      <div
        key={url}
        css={css({
          position: "relative",
          ".delete-button": { opacity: 0 },
          ":hover .delete-button": { opacity: 1 },
        })}
      >
        <button
          type="button"
          onClick={() => {
            window.open(url, "_blank");
          }}
          css={css({
            display: "block",
            cursor: "pointer",
          })}
        >
          <img
            src={url}
            style={{
              transition: "0.1s opacity",
              opacity: id == null ? 0.7 : 1,
              background: previewUrl == null ? undefined : `url(${previewUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </button>

        {id == null && (
          <div
            style={{
              pointerEvents: "none",
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translateX(-50%) translateY(-50%)",
            }}
            css={(theme) => css({ color: theme.colors.interactiveNormal })}
          >
            <Spinner />
          </div>
        )}

        <button
          type="button"
          className="delete-button"
          css={(theme) =>
            css({
              position: "absolute",
              top: 0,
              right: 0,
              transform: "translateX(50%) translateY(-50%)",
              cursor: "pointer",
              background: theme.colors.channelInputBackground,
              borderRadius: "50%",
              boxShadow: `0 0 0 0.2rem ${theme.colors.channelInputBackground}`,
              svg: {
                width: "2.2rem",
                height: "auto",
                color: theme.colors.interactiveNormal,
              },
              ":hover svg": {
                color: theme.colors.interactiveHover,
              },
            })
          }
          onClick={() => {
            remove({ url });
          }}
        >
          <PlusCircleIcon style={{ transform: "rotate(45deg" }} />
        </button>
      </div>
    ))}
  </div>
);

const Header = ({ children }) => (
  <div
    css={(theme) =>
      css({
        fontSize: "1.5rem",
        fontWeight: "600",
        color: theme.colors.textHeader,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      })
    }
  >
    {children}
  </div>
);

const Channel = () => {
  const params = useParams();
  const { state, actions } = useAppScope();
  const { isFloating: isMenuTogglingEnabled } = useSideMenu();

  const channel = state.selectChannel(params.channelId);

  const server = state.selectServer(params.serverId);

  const members = state.selectChannelMembers(params.channelId);

  const createMessage = React.useCallback(
    ({ blocks, replyToMessageId }) => {
      return actions.createMessage({
        server: channel?.kind === "dm" ? undefined : params.serverId,
        channel: params.channelId,
        content: stringifyMessageBlocks(blocks),
        blocks,
        replyToMessageId,
      });
    },
    [actions, channel?.kind, params.serverId, params.channelId]
  );

  const headerContent = React.useMemo(
    () =>
      channel == null ? null : (
        <>
          {!isMenuTogglingEnabled && (
            <div
              css={(theme) =>
                css({ color: theme.colors.textMuted, marginRight: "0.9rem" })
              }
            >
              {channel?.kind === "dm" ? (
                <AtSignIcon style={{ width: "2.2rem" }} />
              ) : (
                <HashIcon style={{ width: "1.9rem" }} />
              )}
            </div>
          )}
          <Header>{channel?.name}</Header>
        </>
      ),
    [isMenuTogglingEnabled, channel]
  );

  if (channel == null)
    return (
      <div
        css={(theme) =>
          css({ background: theme.colors.backgroundPrimary, flex: 1 })
        }
      />
    );

  const typingChannelMembers = state.selectChannelTypingMembers(
    params.channelId
  );

  return (
    <ChannelBase
      channel={channel}
      members={members}
      typingMembers={typingChannelMembers}
      createMessage={createMessage}
      isAdmin={server?.isAdmin}
      headerContent={headerContent}
    />
  );
};

const OnScreenTrigger = ({ callback }) => {
  const ref = React.useRef();
  const callbackRef = React.useRef(callback);

  const isOnScreen = useIsOnScreen(ref);

  React.useEffect(() => {
    callbackRef.current = callback;
  });

  React.useEffect(() => {
    if (isOnScreen) callbackRef.current();
  }, [isOnScreen]);

  return <div ref={ref} />;
};

export default Channel;
