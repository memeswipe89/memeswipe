export type TwitterProfile = {
  id: string;
  username: string;
};

function getLinkedAccounts(user: any): any[] {
  if (!user) return [];
  if (Array.isArray(user.linked_accounts)) return user.linked_accounts;
  if (Array.isArray(user.linkedAccounts)) return user.linkedAccounts;
  return [];
}

export function getDisplayNameFromUser(user: any): string {
  if (!user) return "Trader";
  if (typeof user?.name === "string" && user.name.trim().length > 0) {
    return user.name;
  }
  if (typeof user?.email?.address === "string" && user.email.address.trim().length > 0) {
    return user.email.address;
  }
  if (typeof user?.metadata?.shortName === "string" && user.metadata.shortName.trim().length > 0) {
    return user.metadata.shortName;
  }
  return "Trader";
}

export function getSolanaWalletAddressFromUser(user: any): string | null {
  if (!user) return null;
  const accounts = getLinkedAccounts(user);
  const solWallet = accounts.find(
    (account) =>
      account?.type === "wallet" &&
      (!account.chainType || account.chainType === "solana") &&
      typeof account?.address === "string" &&
      account.address.length > 0
  );
  if (solWallet?.address) return solWallet.address;

  if (Array.isArray(user?.wallets)) {
    const wallet = user.wallets.find((wallet: any) => typeof wallet?.publicKey === "string");
    if (wallet?.publicKey) return wallet.publicKey;
  }

  if (typeof user?.walletAddress === "string" && user.walletAddress.length > 0) {
    return user.walletAddress;
  }

  return null;
}

export function getTwitterProfileFromUser(user: any): TwitterProfile | null {
  if (!user) return null;
  const accounts = getLinkedAccounts(user);
  const twitterAccount =
    accounts.find((account) => account?.type === "twitter_oauth") ||
    accounts.find((account) => account?.provider === "twitter");
  if (twitterAccount?.twitterUserId || twitterAccount?.subject) {
    const username =
      typeof twitterAccount?.username === "string"
        ? twitterAccount.username
        : typeof twitterAccount?.handle === "string"
        ? twitterAccount.handle
        : null;
    const id =
      typeof twitterAccount?.twitterUserId === "string"
        ? twitterAccount.twitterUserId
        : typeof twitterAccount?.subject === "string"
        ? twitterAccount.subject
        : null;
    if (username && id) {
      return { username, id };
    }
  }

  const legacy = user?.twitter;
  if (legacy && typeof legacy?.subject === "string" && typeof legacy?.username === "string") {
    return { id: legacy.subject, username: legacy.username };
  }

  return null;
}
