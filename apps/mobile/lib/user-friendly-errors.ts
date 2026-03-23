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
