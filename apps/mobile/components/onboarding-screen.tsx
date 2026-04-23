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
  Modal,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { usePrivy, useLoginWithOAuth, useLinkWithOAuth, useLinkEmail } from "@privy-io/expo";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/auth-context";
import { useWalletContext } from "@/contexts/wallet-context";
import { useTradeSettings } from "@/contexts/trade-settings-context";
import { API_BASE } from "@/lib/api-base";
import { getUserFriendlyAuthError } from "@/lib/user-friendly-errors";
import { persistUserIds } from "@/lib/local-user-id";
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const AGE_VERIFIED_KEY = '@memeswipe:ageVerified:v1';
const RISK_WARNING_ACCEPTED_KEY = '@memeswipe:riskWarningAccepted:v1';

type OnboardingStep = "age" | "risk" | "social" | "email" | "wallet";

const getLinkedAccounts = (privyUser: any): any[] => {
  if (!privyUser) return [];
  if (Array.isArray(privyUser?.linked_accounts)) return privyUser.linked_accounts;
  if (Array.isArray(privyUser?.linkedAccounts)) return privyUser.linkedAccounts;
  return [];
};

const getAppleFromPrivy = (privyUser: any) => {
  if (!privyUser) return null;
  const linked = getLinkedAccounts(privyUser);
  const apple = linked.find((account: any) => account?.type === "apple_oauth" || account?.type === "apple");
  if (!apple) return null;
  return {
    id: apple?.subject || apple?.id,
    email: apple?.email,
  };
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
  const { profileName, setProfileName } = useTradeSettings();
  
  useEffect(() => {
    // User object loaded
  }, [user]);

  const [currentStep, setCurrentStep] = useState<OnboardingStep>("age");
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false); // Track email manually
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [riskAgeConfirmed, setRiskAgeConfirmed] = useState(false);
  const [riskUnderstood, setRiskUnderstood] = useState(false);

  const twitterProfile = getTwitterFromPrivy(user);
  const appleProfile = getAppleFromPrivy(user);
  const emailFromUser = getEmailFromPrivy(user);
  const walletFromUser = getWalletAddressFromPrivy(user) || tradingWalletAddress;
  const hasTwitter = Boolean(twitterProfile?.id);
  const hasApple = Boolean(appleProfile?.id);
  const hasSocialLogin = hasTwitter || hasApple;
  const hasEmail = Boolean(emailFromUser) || emailVerified; // Use manual tracking
  const hasWallet = Boolean(walletFromUser);

  const completeOnboarding = useCallback(async (overrides?: {
    walletAddress?: string;
    email?: string;
  }) => {

    if (!user) return;

    try {

      setIsOnboarding(true);

      const walletAddress = overrides?.walletAddress || walletFromUser || "";
      const email = overrides?.email || emailFromUser || emailInput.trim() || ""; // Make email optional

      const missing: string[] = [];
      // Accept either Twitter OR Apple for social login
      const socialId = twitterProfile?.id || appleProfile?.id || "";
      
      if (!socialId) missing.push("social_login");
      // Email is now optional
      if (!walletAddress) missing.push("wallet_address");
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(", ")}`);
      }

      const payload = {
        privy_user_id: user.id,
        twitter_user_id: twitterProfile?.id || "",
        twitter_username: twitterProfile?.username || "",
        apple_user_id: appleProfile?.id || "",
        apple_email: appleProfile?.email || "",
        email: email || emailInput.trim() || "", // Use the input if emailFromUser is empty
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
        const trimmed = responseText.trim();
        if (trimmed.startsWith('<')) {
          throw new Error(`Server returned HTML (${response.status}). The backend may be starting up — please try again in a moment.`);
        }
        throw new Error(responseJson?.error || `Onboarding failed (${response.status})`);
      }
      if (responseJson?.user_id) {
        await persistUserIds(responseJson.user_id, user.id);
      }

      // Set initial profile name to first 2 letters of Twitter username or Apple ID if not already set
      if (!profileName || profileName.trim() === '') {
        const twitterUsername = twitterProfile?.username;
        const appleUserId = appleProfile?.id;
        const authInitial =
          (typeof twitterUsername === "string" && twitterUsername.length > 0 ? twitterUsername.slice(0, 2) : null) ||
          (typeof appleUserId === "string" && appleUserId.length > 0 ? appleUserId.slice(0, 2) : null);
        if (authInitial) {
          setProfileName(authInitial.toUpperCase());
        }
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

  }, [emailFromUser, emailInput, tradingWalletAddress, user, walletFromUser, twitterProfile, appleProfile]);

  // Determine which step to show
  useEffect(() => {
    if (!isReady) return;

    // Complete onboarding if all steps are done
    if (ageConfirmed && riskAgeConfirmed && riskUnderstood && hasSocialLogin && hasEmail && hasWallet && user) {
      void completeOnboarding();
    }
    // Auto-advance through steps (but NOT from risk to social - that requires button click)
    else if (currentStep === "age" && ageConfirmed) {
      setCurrentStep("risk");
    } else if (currentStep === "social" && hasSocialLogin) {
      setCurrentStep("email");
    } else if (currentStep === "email" && hasSocialLogin && hasEmail) {
      setCurrentStep("wallet");
    }
  }, [ageConfirmed, riskAgeConfirmed, riskUnderstood, hasSocialLogin, hasEmail, hasWallet, isReady, currentStep, user, completeOnboarding]);

  const handleTwitterConnect = async () => {
    try {
      if (hasTwitter) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        setCurrentStep("email");
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setTwitterLoading(true);
      if (user) {
        await link({ provider: "twitter" });
      } else {
        await login({ provider: "twitter" });
      }
    } catch (error) {
      const message = String((error as any)?.message || error || "");
      const isCancelled =
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("cancelled") ||
        message.toLowerCase().includes("canceled");
      if (isCancelled) {
        return;
      }
      console.error("Twitter login error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Twitter connection failed",
        message: "Could not connect your Twitter account. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setTwitterLoading(false);
    }
  };

  const handleAppleConnect = async () => {
    try {
      if (hasApple) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        setCurrentStep("email");
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setAppleLoading(true);
      if (user) {
        await link({ provider: "apple" });
      } else {
        await login({ provider: "apple" });
      }
    } catch (error) {
      console.error("Apple login error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Apple connection failed",
        message: "Could not connect your Apple account. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setAppleLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!user) {
      return;
    }
    const email = emailInput.trim();
    if (!email) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      Alert.alert("Email required", "Please enter your email address.");
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setSendingCode(true);
      await sendCode({ email });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setCodeSent(true);
    } catch (error) {
      console.error("Email send code error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      Alert.alert("Missing details", "Please enter both email and verification code.");
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setVerifyingCode(true);
      await linkWithCode({ email, code });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setEmailVerified(true); // Mark email as verified
      // Move to wallet step
      setCurrentStep("wallet");
    } catch (error) {
      console.error("Email verify error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      setCreatingWallet(true);
      await getOrCreateTradingWalletAddress();
      // Save age verification and risk warning acceptance
      await AsyncStorage.setItem(AGE_VERIFIED_KEY, 'true');
      await AsyncStorage.setItem(RISK_WARNING_ACCEPTED_KEY, 'true');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // Wallet created, onboarding will complete via useEffect
    } catch (error) {
      console.error("Wallet create error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const friendly = getUserFriendlyAuthError(error, {
        title: "Wallet creation failed",
        message: "Could not create your wallet right now. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setCreatingWallet(false);
    }
  };

  const handleAgeConfirm = () => {
    console.log('Age confirm pressed - triggering haptics');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      .then(() => console.log('Haptics success notification triggered'))
      .catch((error) => console.log('Haptics error:', error));
    setAgeConfirmed(true);
  };

  const handleAgeDecline = () => {
    console.log('Age decline pressed - triggering haptics');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      .then(() => console.log('Haptics warning notification triggered'))
      .catch((error) => console.log('Haptics error:', error));
    Alert.alert(
      'Age Requirement',
      'You must be 18 years or older to use this app.',
      [{ text: 'OK' }]
    );
  };

  const handleRiskAccept = () => {
    if (riskAgeConfirmed && riskUnderstood) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // Both checkboxes confirmed, proceed to next step
      setCurrentStep("social");
    }
  };

  if (!isReady) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: "#fff" }}>Loading...</Text>
      </View>
    );
  }

  return (
    <LinearGradient 
      colors={["#000000", "#1a1a1a", "#000000"]} 
      style={[styles.container, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }]}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.centerContainer}>
        
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Image 
              source={require('@/assets/images/icon.png')} 
              style={styles.iconImage}
              resizeMode="contain"
            />
          </View>
          
          <Text style={styles.title}>Welcome to Swipeit</Text>
          <Text style={styles.subtitle}>Discover and trade tokens</Text>
        </View>

        <View style={styles.actionContainer}>

          {currentStep === "age" && (
            <>
              <Text style={styles.ageTitle}>Age Verification</Text>
              <Text style={styles.ageWarning}>⚠️</Text>
              <Text style={styles.ageDescription}>
                This app involves cryptocurrency trading and carries significant financial risk.
                {'\n\n'}
                You must be at least 18 years old to use this application.
              </Text>
              <View style={styles.ageConfirmBox}>
                <Text style={styles.ageConfirmText}>
                  I confirm that I am 18 years of age or older and understand the risks involved in cryptocurrency trading.
                </Text>
              </View>
              <Pressable style={styles.primaryButton} onPress={handleAgeConfirm}>
                <Text style={styles.primaryButtonText}>I CONFIRM, I AM 18+</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={handleAgeDecline}>
                <Text style={styles.secondaryButtonText}>I AM UNDER 18</Text>
              </Pressable>
            </>
          )}

          {currentStep === "risk" && (
            <>
              <Text style={styles.ageTitle}>Risk Disclosure</Text>
              <ScrollView style={styles.riskScrollView} showsVerticalScrollIndicator={false}>
                <View style={styles.riskSection}>
                  <Text style={styles.riskSectionTitle}>⚠️ Risk Warning</Text>
                  <Text style={styles.riskText}>
                    Trading cryptocurrencies involves substantial risk of loss and is not suitable for every investor.
                  </Text>
                </View>
                <View style={styles.riskSection}>
                  <Text style={styles.riskSectionTitle}>📊 Not Financial Advice</Text>
                  <Text style={styles.riskText}>
                    This app does not provide investment advice. You are solely responsible for your trading decisions.
                  </Text>
                </View>
                <View style={styles.riskSection}>
                  <Text style={styles.riskSectionTitle}>🔒 Your Responsibility</Text>
                  <Text style={styles.riskText}>
                    All trades are executed on-chain and are irreversible. You are responsible for securing your wallet.
                  </Text>
                </View>
                <View style={styles.checkboxContainer}>
                  <Pressable style={styles.checkboxRow} onPress={() => {
                    Haptics.selectionAsync().catch(() => undefined);
                    setRiskAgeConfirmed(!riskAgeConfirmed);
                  }}>
                    <View style={[styles.checkbox, riskAgeConfirmed && styles.checkboxChecked]}>
                      {riskAgeConfirmed && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>I confirm that I am at least 18 years old</Text>
                  </Pressable>
                  <Pressable style={styles.checkboxRow} onPress={() => {
                    Haptics.selectionAsync().catch(() => undefined);
                    setRiskUnderstood(!riskUnderstood);
                  }}>
                    <View style={[styles.checkbox, riskUnderstood && styles.checkboxChecked]}>
                      {riskUnderstood && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>I understand the risks and accept full responsibility</Text>
                  </Pressable>
                </View>
              </ScrollView>
              <View style={styles.riskButtonContainer}>
                <Pressable 
                  style={[styles.primaryButton, (!riskAgeConfirmed || !riskUnderstood) && styles.buttonDisabled]} 
                  onPress={handleRiskAccept}
                  disabled={!riskAgeConfirmed || !riskUnderstood}
                >
                  <Text style={styles.primaryButtonText}>ACCEPT & CONTINUE</Text>
                </Pressable>
              </View>
            </>
          )}

          {currentStep === "social" && (
            <>
              {Platform.OS === "ios" && (
                <Pressable
                  style={[styles.appleButton, (appleLoading || hasApple) && styles.buttonDisabled]}
                  onPress={handleAppleConnect}
                  disabled={appleLoading || hasApple}
                >
                  {appleLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <View style={styles.socialButtonContent}>
                      <Ionicons name="logo-apple" size={20} color="#fff" />
                      <Text style={styles.appleButtonText}>
                        {hasApple ? "Apple Connected" : "Sign in with Apple"}
                      </Text>
                    </View>
                  )}
                </Pressable>
              )}

              <Pressable 
                style={[styles.twitterButton, (twitterLoading || hasTwitter) && styles.buttonDisabled]} 
                onPress={handleTwitterConnect} 
                disabled={twitterLoading || hasTwitter}
              >
                {twitterLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <View style={styles.socialButtonContent}>
                    <Ionicons name="logo-twitter" size={20} color="#fff" />
                    <Text style={styles.twitterButtonText}>
                      {hasTwitter ? "Twitter Connected" : "Sign in with Twitter"}
                    </Text>
                  </View>
                )}
              </Pressable>
            </>
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

        <View style={styles.legalFooter}>
          <Text style={styles.legalFooterText}>
            By continuing, you agree to our{' '}
          </Text>
          <Pressable 
            onPress={() => setShowTermsModal(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.legalFooterLink}>Terms & Privacy Policy</Text>
          </Pressable>
        </View>

      </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Terms Modal */}
      <Modal
        visible={showTermsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTermsModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Legal</Text>
            <Pressable onPress={() => setShowTermsModal(false)} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            
            <Text style={styles.modalMainTitle}>Terms of Service</Text>
            <Text style={styles.modalLastUpdated}>Last Updated: {new Date().toLocaleDateString()}</Text>
            
            <Text style={styles.modalSectionTitle}>1. Acceptance of Terms</Text>
            <Text style={styles.modalText}>
              By using Swipeit, you accept these Terms of Service. If you don’t agree, please don’t use the App.
            </Text>
            
            <Text style={styles.modalSectionTitle}>2. Age Requirement</Text>
            <Text style={styles.modalText}>
              You must be at least 18 years old to use this App.
            </Text>
            
            <Text style={styles.modalSectionTitle}>3. Trading Risks</Text>
            <Text style={styles.modalText}>
              Cryptocurrency trading involves substantial risk. You may lose all or part of your investment. 
              You are solely responsible for your trading decisions.
            </Text>
            
            <Text style={styles.modalSectionTitle}>4. Not Financial Advice</Text>
            <Text style={styles.modalText}>
              The App does not provide investment or financial advice. All content is for informational purposes only.
            </Text>
            
            <Text style={styles.modalSectionTitle}>5. Limitation of Liability</Text>
            <Text style={styles.modalText}>
              We are not liable for any losses, damages, or expenses arising from your use of the App.
            </Text>
            
            <Text style={[styles.modalMainTitle, { marginTop: 32 }]}>Privacy Policy</Text>
            <Text style={styles.modalLastUpdated}>Last Updated: {new Date().toLocaleDateString()}</Text>
            
            <Text style={styles.modalSectionTitle}>1. Information We Collect</Text>
            <Text style={styles.modalText}>
              We collect your email, social media profile, wallet addresses, and usage data.
            </Text>
            
            <Text style={styles.modalSectionTitle}>2. How We Use Your Information</Text>
            <Text style={styles.modalText}>
              We use your information to provide services, process transactions, and improve the App.
            </Text>
            
            <Text style={styles.modalSectionTitle}>3. Data Security</Text>
            <Text style={styles.modalText}>
              We implement industry-standard security measures including encryption and secure servers.
            </Text>
            
            <Text style={styles.modalSectionTitle}>4. Your Rights</Text>
            <Text style={styles.modalText}>
              You have the right to access, correct, or delete your personal information.
            </Text>
            
            <Text style={styles.modalText}>
              For full Terms and Privacy Policy, see the Legal section in your profile.
            </Text>
            
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,width:SCREEN_WIDTH,height:SCREEN_HEIGHT},
  scrollContent:{flexGrow:1,justifyContent:"center",paddingHorizontal:24,paddingVertical:40},
  centerContainer:{alignItems:"center"},
  center:{justifyContent:"center",alignItems:"center"},
  header:{alignItems:"center",marginBottom:24},
  iconCircle:{width:100,height:100,borderRadius:50,backgroundColor:"rgba(255,255,255,0.1)",alignItems:"center",justifyContent:"center",marginBottom:16,borderWidth:2,borderColor:"rgba(255,255,255,0.2)",overflow:"hidden"},
  iconImage:{width:70,height:70},
  title:{fontSize:28,fontWeight:"700",color:"#fff",textAlign:"center"},
  subtitle:{fontSize:16,color:"#888",textAlign:"center",marginBottom:12},
  actionContainer:{marginTop:20,width:"100%",maxWidth:400},
  socialButtonContent:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10},
  twitterButton:{backgroundColor:"#1DA1F2",paddingVertical:16,borderRadius:12,alignItems:"center",justifyContent:"center",marginBottom:12},
  twitterButtonText:{color:"#fff",fontSize:18,fontWeight:"600"},
  appleButton:{backgroundColor:"#000000",paddingVertical:16,borderRadius:12,alignItems:"center",justifyContent:"center",marginBottom:12},
  appleButtonText:{color:"#ffffff",fontSize:18,fontWeight:"600"},
  buttonDisabled:{opacity:0.5},
  primaryButton:{backgroundColor:"#007AFF",paddingVertical:16,borderRadius:12,alignItems:"center"},
  primaryButtonText:{color:"#fff",fontSize:18,fontWeight:"600"},
  secondaryButton:{backgroundColor:"#1a1a1a",paddingVertical:14,borderRadius:12,alignItems:"center",borderWidth:1,borderColor:"#333",marginTop:12},
  secondaryButtonText:{color:"#fff",fontSize:16,fontWeight:"600"},
  loadingOverlay:{position:"absolute",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0,0,0,0.8)",justifyContent:"center",alignItems:"center"},
  loadingText:{fontSize:18,color:"#fff",fontWeight:"600"},
  emailContainer:{gap:12,width:"100%"},
  input:{backgroundColor:"#111",borderWidth:1,borderColor:"#333",borderRadius:12,paddingHorizontal:14,paddingVertical:12,color:"#fff",fontSize:16},
  ageContainer:{gap:16,width:"100%",alignItems:"center"},
  ageTitle:{fontSize:24,fontWeight:"700",color:"#fff",marginBottom:8,textAlign:"center"},
  ageWarning:{fontSize:40,marginBottom:12,textAlign:"center"},
  ageDescription:{fontSize:14,color:"#ccc",textAlign:"center",lineHeight:20,marginBottom:16},
  ageConfirmBox:{backgroundColor:"rgba(255,255,255,0.05)",borderWidth:1,borderColor:"rgba(255,255,255,0.1)",borderRadius:12,padding:14,marginBottom:16,width:"100%"},
  ageConfirmText:{fontSize:13,color:"#fff",textAlign:"center",lineHeight:18,fontWeight:"500"},
  riskScrollView:{maxHeight:300,width:"100%",marginBottom:16},
  riskSection:{marginBottom:16},
  riskSectionTitle:{fontSize:16,fontWeight:"700",color:"#fff",marginBottom:8},
  riskText:{fontSize:13,color:"#ccc",lineHeight:18},
  checkboxContainer:{marginTop:8,gap:12,marginBottom:16},
  checkboxRow:{flexDirection:"row",alignItems:"flex-start",gap:10},
  checkbox:{width:22,height:22,borderRadius:6,borderWidth:2,borderColor:"rgba(255,255,255,0.3)",justifyContent:"center",alignItems:"center",marginTop:2},
  checkboxChecked:{backgroundColor:"#4ade80",borderColor:"#4ade80"},
  checkmark:{color:"#fff",fontSize:14,fontWeight:"800"},
  checkboxLabel:{flex:1,fontSize:13,color:"#fff",lineHeight:18,fontWeight:"500"},
  riskButtonContainer:{paddingTop:8,width:"100%"},
  legalFooter:{flexDirection:"row",alignItems:"center",justifyContent:"center",paddingVertical:16,paddingHorizontal:24,flexWrap:"wrap",marginTop:32},
  legalFooterText:{color:"#888",fontSize:12,textAlign:"center"},
  legalFooterLink:{color:"#007AFF",fontSize:12,fontWeight:"600",textDecorationLine:"underline"},
  modalContainer:{flex:1,backgroundColor:"#000"},
  modalHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingHorizontal:16,paddingVertical:16,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"rgba(255,255,255,0.1)"},
  modalTitle:{color:"#fff",fontSize:18,fontWeight:"600"},
  modalCloseButton:{paddingHorizontal:12,paddingVertical:6,borderRadius:8,backgroundColor:"#1a1a1a"},
  modalCloseText:{color:"#007AFF",fontSize:14,fontWeight:"600"},
  modalContent:{flex:1,paddingHorizontal:20,paddingTop:8},
  modalMainTitle:{color:"#fff",fontSize:22,fontWeight:"700",marginTop:16,marginBottom:4},
  modalLastUpdated:{color:"#888",fontSize:11,marginBottom:16,fontStyle:"italic"},
  modalSectionTitle:{color:"#fff",fontSize:16,fontWeight:"600",marginTop:20,marginBottom:8},
  modalText:{color:"rgba(255,255,255,0.8)",fontSize:14,lineHeight:20,marginBottom:12}
});
