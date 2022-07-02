import { getChecksumAddress } from "../utils/ethereum";

const commands = {
  "create-channel": ({
    context,
    user,
    state,
    actions,
    serverId,
    navigate,
  }) => ({
    description: "Create a new channel",
    arguments: ["name"],
    execute: async ({ args, editor }) => {
      const name = args.join(" ");
      if (name.trim().length === 0) {
        alert('"name" is a required argument!');
        return;
      }

      const channel = await actions.createServerChannel(serverId, { name });
      editor.clear();
      navigate(`/channels/${serverId}/${channel.id}`);
    },
    exclude: () => {
      if (context !== "server") return true;
      const server = state.selectServer(serverId);
      return server?.ownerUserId !== user.id;
    },
  }),
  "create-topic-channel": ({ actions, navigate }) => ({
    description: "Start a new topic channel",
    arguments: ["name"],
    execute: async ({ args, editor }) => {
      const name = args.join(" ");
      if (name.trim().length === 0) {
        alert('"name" is a required argument!');
        return;
      }

      const channel = await actions.createChannel({ name });
      editor.clear();
      navigate(`/channels/${channel.id}`);
    },
  }),
  "rename-channel": ({
    context,
    user,
    state,
    actions,
    serverId,
    channelId,
  }) => ({
    description: "Set a new name for this channel",
    arguments: ["channel-name"],
    execute: async ({ args, editor }) => {
      if (args.length < 1) {
        alert('Argument "channel-name" is required');
        return;
      }
      const channelName = args.join(" ");
      await actions.updateChannel(channelId, { name: channelName });
      editor.clear();
    },
    exclude: () => {
      if (context === "dm") return false;

      if (context === "server") {
        const server = state.selectServer(serverId);
        return server?.ownerUserId !== user.id;
      }

      if (context === "topic") {
        const channel = state.selectChannel(channelId);
        return user.id !== channel.ownerUserId;
      }

      return true;
    },
  }),
  "set-channel-description": ({
    context,
    user,
    state,
    actions,
    channelId,
  }) => ({
    description: "Set a new description for this channel",
    arguments: ["channel-description"],
    execute: async ({ args, editor }) => {
      if (args.length < 1) return;
      const description = args.join(" ");
      await actions.updateChannel(channelId, { description });
      editor.clear();
    },
    exclude: () => {
      if (context === "dm") return false;

      if (context === "server") return true;
      // if (context === "server") {
      //   const server = state.selectServer(serverId);
      //   return server?.ownerUserId !== user.id;
      // }

      if (context === "topic") {
        const channel = state.selectChannel(channelId);
        return channel?.ownerUserId !== user.id;
      }

      return true;
    },
  }),
  "delete-channel": ({
    context,
    user,
    state,
    actions,
    navigate,
    serverId,
    channelId,
  }) => ({
    description: "Delete the current channel",
    execute: async ({ editor }) => {
      if (!confirm("Are you sure you want to delete this channel?")) return;
      await actions.deleteChannel(channelId);
      editor.clear();
      navigate(`/channels/${serverId}`);
    },
    exclude: () => {
      if (context === "dm") return true;

      if (context === "server") {
        const server = state.selectServer(serverId);
        return server?.ownerUserId !== user.id;
      }

      if (context === "topic") {
        const channel = state.selectChannel(channelId);
        return user.id !== channel.ownerUserId;
      }

      return true;
    },
  }),
  "move-channel": ({ context, user, state, actions, serverId, channelId }) => ({
    description: `Move the current channel one step in the given direction ("up" or "down")`,
    arguments: ["direction"],
    execute: async ({ args, editor }) => {
      const [direction] = args;
      if (!["up", "down"].includes(direction)) {
        alert(`"${direction}" is not a valid direction!`);
        return;
      }

      const serverChannelSections = state.selectServerChannelSections(serverId);
      const currentSection = serverChannelSections.find((s) =>
        s.channelIds.includes(channelId)
      );

      if (currentSection == null) {
        alert(
          "Currently not possible to sort channels without a parent section, sorry!"
        );
        return;
      }

      const currentChannelIndex = currentSection.channelIds.indexOf(channelId);

      const nextIndex = Math.max(
        0,
        Math.min(
          currentSection.channelIds.length - 1,
          direction === "up" ? currentChannelIndex - 1 : currentChannelIndex + 1
        )
      );

      const reorderedChannelIds = [...currentSection.channelIds];
      const temp = reorderedChannelIds[nextIndex];
      reorderedChannelIds[nextIndex] = channelId;
      reorderedChannelIds[currentChannelIndex] = temp;

      await actions.updateChannelSection(currentSection.id, {
        channelIds: reorderedChannelIds,
      });
      editor.clear();
    },
    exclude: () => {
      if (context !== "server") return true;
      const server = state.selectServer(serverId);
      return server?.ownerUserId !== user.id;
    },
  }),
  "star-channel": ({ navigate, state, actions, channelId }) => ({
    description: "Star this channel to list it on your home screen",
    execute: async ({ editor }) => {
      const channels = state.selectStarredChannels();
      const isStarred = channels.some((c) => c.id === channelId);
      if (!isStarred) await actions.starChannel(channelId);
      navigate(`/starred/channels/${channelId}`);
      editor.clear();
    },
    exclude: () => {
      const channels = state.selectStarredChannels();
      const isStarred = channels.some((c) => c.id === channelId);
      return isStarred;
    },
  }),
  "unstar-channel": ({ navigate, state, actions, channelId }) => ({
    description: "Unstar this channel to remove it from your home screen",
    execute: async ({ editor }) => {
      const channels = state.selectStarredChannels();
      const index = channels.findIndex((c) => c.id === channelId);
      await actions.unstarChannel(channelId);
      const indexToSelect = Math.max(0, index - 1);
      const channelsAfterUnstar = channels.filter((c) => c.id !== channelId);
      const channelToSelect = channelsAfterUnstar[indexToSelect];
      navigate(
        channelToSelect == null
          ? "/"
          : `/starred/channels/${channelToSelect.id}`
      );
      editor.clear();
    },
    exclude: () => {
      const channels = state.selectStarredChannels();
      return channels.every((c) => c.id !== channelId);
    },
  }),
  "add-member": ({ state, actions, channelId, user, ethersProvider }) => ({
    description: "Add a member to this channel",
    arguments: ["wallet-address-or-ens"],
    execute: async ({ args, editor }) => {
      const [walletAddressOrEns] = args;
      if (walletAddressOrEns == null) return;

      try {
        const address = await ethersProvider
          .resolveName(walletAddressOrEns)
          .then(getChecksumAddress);

        await actions.addChannelMember(channelId, address);
        editor.clear();
      } catch (e) {
        if (e.code === "INVALID_ARGUMENT") throw new Error("Invalid address");
        throw e;
      }
    },
    exclude: () => {
      const channel = state.selectChannel(channelId);
      return channel.kind !== "topic" || channel.ownerUserId !== user.id;
    },
  }),
  "remove-member": ({ state, actions, channelId, user, ethersProvider }) => ({
    description: "Remove a member from this channel",
    arguments: ["wallet-address-or-ens"],
    execute: async ({ args, editor }) => {
      const [walletAddressOrEns] = args;
      if (walletAddressOrEns == null) return;

      try {
        const address = await ethersProvider
          .resolveName(walletAddressOrEns)
          .then(getChecksumAddress);

        const user = state.selectUserFromWalletAddress(address);

        if (user == null) {
          alert(`No member with address "${address}"!`);
          return;
        }

        await actions.removeChannelMember(channelId, user.id);
        editor.clear();
      } catch (e) {
        if (e.code === "INVALID_ARGUMENT") throw new Error("Invalid address");
        throw e;
      }
    },
    exclude: () => {
      const channel = state.selectChannel(channelId);
      return channel.kind !== "topic" || channel.ownerUserId !== user.id;
    },
  }),
  "join-channel": ({ state, actions, channelId, user }) => {
    const channel = state.selectChannel(channelId);
    return {
      description: `Join "#${channel.name}".`,
      execute: async ({ editor }) => {
        await actions.joinChannel(channelId);
        editor.clear();
      },
      exclude: () =>
        channel.kind !== "topic" || channel.memberUserIds.includes(user.id),
    };
  },
  "leave-channel": ({ state, actions, channelId, user }) => {
    const channel = state.selectChannel(channelId);
    return {
      description: `Leave "#${channel.name}".`,
      execute: async ({ editor }) => {
        await actions.leaveChannel(channelId);
        editor.clear();
      },
      exclude: () => {
        return channel.kind !== "topic" || channel.ownerUserId === user.id;
      },
    };
  },
  "make-public": ({ state, actions, channelId, user }) => {
    const channel = state.selectChannel(channelId);
    return {
      description: `Make "#${channel.name}" public.`,
      execute: async ({ editor }) => {
        await actions.makeChannelPublic(channelId);
        editor.clear();
      },
      exclude: () =>
        channel.kind !== "topic" ||
        channel.isPublic ||
        channel.ownerUserId !== user.id,
    };
  },
  "make-private": ({ state, actions, channelId, user }) => {
    const channel = state.selectChannel(channelId);
    return {
      description: `Make "#${channel.name}" private.`,
      execute: async ({ editor }) => {
        await actions.makeChannelPrivate(channelId);
        editor.clear();
      },
      exclude: () =>
        channel.kind !== "topic" ||
        !channel.isPublic ||
        channel.ownerUserId !== user.id,
    };
  },
};

export default commands;
