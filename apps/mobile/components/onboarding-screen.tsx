import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  Pressable,
  Alert,
  StyleSheet,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { usePrivy, useLoginWithOAuth, useLinkWithOAuth, useLinkEmail } from "@privy-io/expo";
import { useAuth } from "@/contexts/auth-context";
import { useWalletContext } from "@/contexts/wallet-context";
import { API_BASE } from "@/lib/api-base";
import { getUserFriendlyAuthError } from "@/lib/user-friendly-errors";
import { persistUserIds } from "@/lib/local-user-id";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type OnboardingStep = "twitter" | "email" | "wallet";

const getLinkedAccounts = (privyUser: any): any[] => {
  if (!privyUser) return [];
  if (Array.isArray(privyUser?.linked_accounts)) return privyUser.linked_accounts;
  if (Array.isArray(privyUser?.linkedAccounts)) return privyUser.linkedAccounts;
  return [];
};

const getTwitterFromPrivy = (privyUser: any) => {
  if (!privyUser) return null;
  const linked = getLinkedAccounts(privyUser);
  const twitter = linked.find((account: any) => account?.type === "twitter_oauth");
  if (!twitter) {
    const legacy = privyUser?.twitter;
    if (legacy && typeof legacy?.subject === "string" && typeof legacy?.username === "string") {
      return { id: legacy.subject, username: legacy.username };
    }
    return null;
  }
  const username =
    typeof twitter?.username === "string"
      ? twitter.username
      : typeof twitter?.handle === "string"
        ? twitter.handle
        : null;
  const id =
    typeof twitter?.subject === "string"
      ? twitter.subject
      : typeof twitter?.id === "string"
        ? twitter.id
        : null;
  if (!username || !id) return null;
  return { id, username };
};

const getEmailFromPrivy = (privyUser: any): string | null => {
  if (!privyUser) return null;
  const linked = getLinkedAccounts(privyUser);
  const email = linked.find((account: any) => account?.type === "email");
  if (typeof email?.address === "string") return email.address;
  const legacy = privyUser?.email;
  if (typeof legacy?.address === "string") return legacy.address;
  return null;
};

const getWalletAddressFromPrivy = (privyUser: any): string | null => {
  if (!privyUser) return null;
  const legacyAddress =
    (privyUser as any)?.wallet?.address ||
    (privyUser as any)?.wallets?.[0]?.address;
  if (typeof legacyAddress === "string" && legacyAddress.length > 0) return legacyAddress;
  const linked = getLinkedAccounts(privyUser);
  const withAddress = linked.find((account: any) => typeof account?.address === "string");
  if (typeof withAddress?.address === "string") return withAddress.address;
  return null;
};

export function OnboardingScreen() {

  const { user, isReady } = usePrivy();
  const { login } = useLoginWithOAuth();
  const { link } = useLinkWithOAuth();
  const { sendCode, linkWithCode } = useLinkEmail();
  const { isLoggedIn } = useAuth();
  const { getOrCreateTradingWalletAddress, tradingWalletAddress } = useWalletContext();
  useEffect(() => {
    console.log("API_BASE:", API_BASE);
  }, []);

  const [currentStep, setCurrentStep] = useState<OnboardingStep>("twitter");
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);

  const twitterProfile = getTwitterFromPrivy(user);
  const emailFromUser = getEmailFromPrivy(user);
  const walletFromUser = getWalletAddressFromPrivy(user) || tradingWalletAddress;
  const hasTwitter = Boolean(twitterProfile?.id);
  const hasEmail = Boolean(emailFromUser);
  const hasWallet = Boolean(walletFromUser);

  const completeOnboarding = useCallback(async (overrides?: {
    walletAddress?: string;
    email?: string;
  }) => {

    if (!user) return;

    try {

      setIsOnboarding(true);

      const walletAddress = overrides?.walletAddress || walletFromUser || "";
      const email = overrides?.email || emailFromUser || emailInput.trim();

      const missing: string[] = [];
      if (!twitterProfile?.id) missing.push("twitter_user_id");
      if (!twitterProfile?.username) missing.push("twitter_username");
      if (!email) missing.push("email");
      if (!walletAddress) missing.push("wallet_address");
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(", ")}`);
      }

      const payload = {
        privy_user_id: user.id,
        twitter_user_id: twitterProfile?.id || "",
        twitter_username: twitterProfile?.username || "",
        email: email || "",
        wallet_address: walletAddress || "",
      };

      const response = await fetch(`${API_BASE}/api/onboard-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responseJson: { user_id?: string; error?: string } | null = null;
      if (responseText) {
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          responseJson = null;
        }
      }
      if (!response.ok) {
        throw new Error(`Onboarding failed (${response.status}): ${responseText}`);
      }
      if (responseJson?.user_id) {
        await persistUserIds(responseJson.user_id, user.id);
      }

      setIsOnboarding(false);

    } catch (error) {

      console.error("Onboarding error:", error);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Setup failed",
        message: "Could not save your account right now. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
      setIsOnboarding(false);

    }

  }, [emailFromUser, emailInput, tradingWalletAddress, user, walletFromUser, twitterProfile]);

  useEffect(() => {

    if (!isReady) return;

    if (hasTwitter && hasEmail && hasWallet && user) {
      void completeOnboarding();
    } else if (hasTwitter && hasEmail) {
      setCurrentStep("wallet");
    } else if (hasTwitter) {
      setCurrentStep("email");
    } else {
      setCurrentStep("twitter");
    }

  }, [completeOnboarding, hasEmail, hasTwitter, hasWallet, isLoggedIn, isReady, user, tradingWalletAddress]);

  const handleTwitterConnect = async () => {
    try {
      if (hasTwitter) {
        setCurrentStep("email");
        return;
      }
      setTwitterLoading(true);
      if (user) {
        await link({ provider: "twitter" });
      } else {
        await login({ provider: "twitter" });
      }
    } catch (error) {
      console.error("Twitter login error:", error);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Twitter connection failed",
        message: "Could not connect your Twitter account. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setTwitterLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!user) {
      return;
    }
    const email = emailInput.trim();
    if (!email) {
      Alert.alert("Email required", "Please enter your email address.");
      return;
    }
    try {
      setSendingCode(true);
      await sendCode({ email });
      setCodeSent(true);
    } catch (error) {
      console.error("Email send code error:", error);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Could not send code",
        message: "We couldn't send a verification code. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!user) return;
    const email = emailInput.trim();
    const code = codeInput.trim();
    if (!email || !code) {
      Alert.alert("Missing details", "Please enter both email and verification code.");
      return;
    }
    try {
      setVerifyingCode(true);
      await linkWithCode({ email, code });
      setCurrentStep("wallet");
    } catch (error) {
      console.error("Email verify error:", error);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Verification failed",
        message: "We couldn't verify this code. Please check and try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleCreateWallet = async () => {
    try {
      setCreatingWallet(true);
      const createdWalletAddress = await getOrCreateTradingWalletAddress();
      await completeOnboarding({ walletAddress: createdWalletAddress });
    } catch (error) {
      console.error("Wallet create error:", error);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Wallet creation failed",
        message: "Could not create your wallet right now. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setCreatingWallet(false);
    }
  };

  if (!isReady) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: "#fff" }}>Loading...</Text>
      </View>
    );
  }

  // Keep showing onboarding until Twitter (and other steps) are satisfied.

  return (
    <LinearGradient colors={["#000000", "#1a1a1a", "#000000"]} style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Swipeit</Text>
          <Text style={styles.subtitle}>Trade memes, earn rewards</Text>
        </View>

        <View style={styles.steps}>
          {renderStep("twitter", "1", "Connect Twitter", currentStep, () => setCurrentStep("twitter"), true)}
          {renderStep("email", "2", "Verify Email", currentStep, () => setCurrentStep("email"), hasTwitter)}
          {renderStep("wallet", "3", "Create Wallet", currentStep, () => setCurrentStep("wallet"), hasTwitter && hasEmail)}
        </View>

        <View style={styles.actionContainer}>

          {currentStep === "twitter" && (
            <Pressable style={[styles.primaryButton, twitterLoading && styles.primaryButtonDisabled]} onPress={handleTwitterConnect} disabled={twitterLoading}>
              {twitterLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Connect Twitter</Text>
              )}
            </Pressable>
          )}

          {currentStep === "email" && (
            <View style={styles.emailContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter email"
                placeholderTextColor="#666"
                value={emailInput}
                onChangeText={setEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Pressable style={styles.secondaryButton} onPress={handleSendCode} disabled={sendingCode}>
                <Text style={styles.secondaryButtonText}>
                  {sendingCode ? "SENDING..." : "SEND CODE"}
                </Text>
              </Pressable>
              {codeSent && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter code"
                    placeholderTextColor="#666"
                    value={codeInput}
                    onChangeText={setCodeInput}
                    keyboardType="number-pad"
                  />
                  <Pressable style={styles.primaryButton} onPress={handleVerifyCode} disabled={verifyingCode}>
                    <Text style={styles.primaryButtonText}>
                      {verifyingCode ? "VERIFYING..." : "VERIFY EMAIL"}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {currentStep === "wallet" && (
            <Pressable style={styles.primaryButton} onPress={handleCreateWallet} disabled={creatingWallet}>
              <Text style={styles.primaryButtonText}>
                {creatingWallet ? "CREATING..." : tradingWalletAddress ? "CONTINUE" : "CREATE WALLET"}
              </Text>
            </Pressable>
          )}

        </View>

        {isOnboarding && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.loadingText}>
              Setting up your account...
            </Text>
          </View>
        )}

        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function renderStep(
  step: OnboardingStep,
  number: string,
  title: string,
  currentStep: OnboardingStep,
  onPress: () => void,
  enabled: boolean
) {

  const active = currentStep === step;

  return (
    <Pressable
      style={[styles.step, active && styles.activeStep, !enabled && styles.disabledStep]}
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
    >
      <View style={[styles.stepIndicator, active && styles.activeIndicator]}>
        <Text style={[styles.stepNumber, active && styles.activeStepNumber]}>
          {number}
        </Text>
      </View>

      <Text style={[styles.stepTitle, active && styles.activeStepTitle]}>
        {title}
      </Text>
    </Pressable>
  );

}

const styles = StyleSheet.create({
  container:{flex:1,width:SCREEN_WIDTH,height:SCREEN_HEIGHT},
  keyboard:{flex:1},
  center:{justifyContent:"center",alignItems:"center"},
  content:{flexGrow:1,paddingHorizontal:24,paddingTop:190,paddingBottom:40},
  header:{alignItems:"center",marginBottom:60},
  title:{fontSize:32,fontWeight:"700",color:"#fff",textAlign:"center"},
  subtitle:{fontSize:18,color:"#888",textAlign:"center"},
  steps:{flex:1,justifyContent:"center",gap:24},
  step:{flexDirection:"row",alignItems:"center",padding:20,backgroundColor:"#1a1a1a",borderRadius:16,borderWidth:1,borderColor:"#333"},
  activeStep:{borderColor:"#007AFF",backgroundColor:"#001122"},
  disabledStep:{opacity:0.4},
  stepIndicator:{width:40,height:40,borderRadius:20,backgroundColor:"#333",justifyContent:"center",alignItems:"center",marginRight:16},
  activeIndicator:{backgroundColor:"#007AFF"},
  stepNumber:{fontSize:18,color:"#888"},
  activeStepNumber:{color:"#fff"},
  stepTitle:{fontSize:18,color:"#888"},
  activeStepTitle:{color:"#fff"},
  actionContainer:{marginTop:40},
  primaryButton:{backgroundColor:"#007AFF",paddingVertical:16,borderRadius:12,alignItems:"center"},
  primaryButtonDisabled:{opacity:0.7},
  primaryButtonText:{color:"#fff",fontSize:18,fontWeight:"600"},
  secondaryButton:{backgroundColor:"#1a1a1a",paddingVertical:14,borderRadius:12,alignItems:"center",borderWidth:1,borderColor:"#333",marginTop:12},
  secondaryButtonText:{color:"#fff",fontSize:16,fontWeight:"600"},
  infoContainer:{padding:20,backgroundColor:"#1a1a1a",borderRadius:12,alignItems:"center"},
  infoText:{color:"#fff",fontSize:16},
  loadingOverlay:{position:"absolute",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0,0,0,0.8)",justifyContent:"center",alignItems:"center"},
  loadingText:{fontSize:18,color:"#fff",fontWeight:"600"},
  emailContainer:{gap:12},
  input:{backgroundColor:"#111",borderWidth:1,borderColor:"#333",borderRadius:12,paddingHorizontal:14,paddingVertical:12,color:"#fff",fontSize:16}
});
