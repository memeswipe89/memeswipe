type FriendlyError = {
  title: string;
  message: string;
};

const toErrorMessage = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  const maybeError = error as { message?: unknown };
  if (typeof maybeError?.message === "string") return maybeError.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const getUserFriendlyAuthError = (
  error: unknown,
  fallback: FriendlyError = { title: "Something went wrong", message: "Please try again." }
): FriendlyError => {
  const raw = toErrorMessage(error);
  const message = raw.toLowerCase();

  if (
    message.includes("email already") ||
    message.includes("already used") ||
    message.includes("already linked")
  ) {
    return {
      title: "Email already used",
      message: "This email is already linked to another account. Try a different email or log in with that account.",
    };
  }

  if (
    message.includes("twitter already") ||
    message.includes("twitter_already") ||
    (message.includes("twitter") && message.includes("already"))
  ) {
    return {
      title: "Twitter already connected",
      message: "This Twitter account is already linked. Please use another Twitter account.",
    };
  }

  if (
    message.includes("invalid email and code combination") ||
    message.includes("invalid code") ||
    message.includes("code is wrong") ||
    message.includes("verification code")
  ) {
    return {
      title: "Incorrect verification code",
      message: "The email or verification code is incorrect. Please check and try again.",
    };
  }

  if (message.includes("invalid email") || message.includes("email format")) {
    return {
      title: "Invalid email",
      message: "Please enter a valid email address.",
    };
  }

  if (
    message.includes("wallet not create yet") ||
    message.includes("wallet not created") ||
    message.includes("wallet address not found") ||
    message.includes("embedded wallet")
  ) {
    return {
      title: "Wallet not ready",
      message: "Your wallet is not created yet. Please tap Create Wallet and try again.",
    };
  }

  if (message.includes("missing required fields") && message.includes("wallet_address")) {
    return {
      title: "Wallet required",
      message: "Please create your wallet before continuing.",
    };
  }

  return fallback;
};

// ─── Swap / trade error translator ───────────────────────────────────────────

export const getFriendlySwapError = (error: unknown): FriendlyError => {
  const raw = toErrorMessage(error);
  const msg = raw.toLowerCase();

  // Slippage / price moved
  if (
    raw.includes("0x1788") ||
    msg.includes("slippage") ||
    msg.includes("simulation failed") ||
    msg.includes("price impact")
  ) {
    return {
      title: "Price moved",
      message: "The price changed before your trade went through. Tap Retry — it will try with higher slippage automatically.",
    };
  }

  // No route / not tradable
  if (
    msg.includes("no route") ||
    msg.includes("no sell route") ||
    msg.includes("route not found") ||
    msg.includes("token_not_tradable") ||
    msg.includes("not tradable")
  ) {
    return {
      title: "Token not tradable",
      message: "No swap route found for this token right now. It may have very low liquidity. Try again in a moment.",
    };
  }

  // Insufficient balance
  if (
    msg.includes("insufficient sol") ||
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("cannot debit") ||
    msg.includes("prior credit")
  ) {
    return {
      title: "Insufficient balance",
      message: "You don't have enough SOL to cover this trade and network fees. Top up your wallet and try again.",
    };
  }

  // Wallet not signed / rejected
  if (
    msg.includes("could not sign") ||
    msg.includes("user rejected") ||
    msg.includes("wallet could not sign") ||
    msg.includes("signing failed")
  ) {
    return {
      title: "Transaction not signed",
      message: "Your wallet didn't sign the transaction. Please try again.",
    };
  }

  // Network / RPC issues
  if (
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("rpc")
  ) {
    return {
      title: "Network error",
      message: "Couldn't reach the network. Check your connection and try again.",
    };
  }

  // Jupiter API down
  if (
    msg.includes("jupiter") ||
    msg.includes("quote failed") ||
    msg.includes("swap failed")
  ) {
    return {
      title: "Swap service unavailable",
      message: "The swap service is temporarily unavailable. Please try again in a few seconds.",
    };
  }

  // Wallet not set up
  if (
    msg.includes("no wallet address") ||
    msg.includes("create wallet first") ||
    msg.includes("wallet address not found")
  ) {
    return {
      title: "Wallet not set up",
      message: "Please create your wallet from the Wallet tab before trading.",
    };
  }

  // SOL price fetch failed
  if (msg.includes("sol price") || msg.includes("price-usd")) {
    return {
      title: "Price unavailable",
      message: "Couldn't fetch the current SOL price. Check your connection and try again.",
    };
  }

  // Generic fallback — strip any hex codes, program addresses, and log dumps
  const sanitized = raw
    .replace(/0x[0-9a-fA-F]+/g, "")           // hex codes
    .replace(/[A-Za-z0-9]{32,}/g, "")          // long base58/base64 strings
    .replace(/\[.*?\]/gs, "")                   // log arrays
    .replace(/\{.*?\}/gs, "")                   // JSON objects
    .replace(/Program\s+\S+/g, "")             // "Program XYZ..."
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    title: "Trade failed",
    message: sanitized || "Something went wrong. Please try again.",
  };
};

// ─── Close trade error translator ────────────────────────────────────────────

export const getFriendlyCloseError = (error: unknown): FriendlyError => {
  const raw = toErrorMessage(error);
  const msg = raw.toLowerCase();

  if (
    raw.includes("0x1788") ||
    msg.includes("slippage") ||
    msg.includes("simulation failed")
  ) {
    return {
      title: "Price moved",
      message: 'Price moved too fast. Tap "Retry Close" to try again — it will use higher slippage automatically.',
    };
  }

  if (msg.includes("no route") || msg.includes("no sell route")) {
    return {
      title: "No sell route",
      message: "No swap route found to sell this token right now. Try again in a moment.",
    };
  }

  if (msg.includes("missing token amount") || msg.includes("outamountraw")) {
    return {
      title: "Trade data missing",
      message: "Token amount not found. Please reopen the app to refresh your trade data, then try closing again.",
    };
  }

  if (msg.includes("insufficient") || msg.includes("cannot debit")) {
    return {
      title: "Insufficient balance",
      message: "Not enough SOL for fees. Add a small amount of SOL to your wallet and try again.",
    };
  }

  if (msg.includes("could not sign") || msg.includes("user rejected")) {
    return {
      title: "Not signed",
      message: "Your wallet didn't sign the close transaction. Please try again.",
    };
  }

  if (msg.includes("network") || msg.includes("timeout") || msg.includes("fetch failed")) {
    return {
      title: "Network error",
      message: "Couldn't reach the network. Check your connection and try again.",
    };
  }

  // Sanitize raw message
  const sanitized = raw
    .replace(/0x[0-9a-fA-F]+/g, "")
    .replace(/[A-Za-z0-9]{32,}/g, "")
    .replace(/\[.*?\]/gs, "")
    .replace(/\{.*?\}/gs, "")
    .replace(/Program\s+\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    title: "Close failed",
    message: sanitized || "Couldn't close the trade. Please try again.",
  };
};

// ─── Order / API error translator ────────────────────────────────────────────

export const getFriendlyOrderError = (error: unknown): FriendlyError => {
  const raw = toErrorMessage(error);
  const msg = raw.toLowerCase();

  if (msg.includes("user session") || msg.includes("user id")) {
    return {
      title: "Session expired",
      message: "Your session expired. Please reopen the app and try again.",
    };
  }

  if (msg.includes("token address missing")) {
    return {
      title: "Token error",
      message: "This token is missing required data. Please skip it and try another.",
    };
  }

  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) {
    return {
      title: "Network error",
      message: "Couldn't save your trade. Check your connection — your on-chain swap may have gone through.",
    };
  }

  return {
    title: "Order failed",
    message: "Couldn't record your trade. Please try again.",
  };
};
