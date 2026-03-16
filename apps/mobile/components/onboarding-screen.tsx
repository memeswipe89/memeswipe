import React, { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { usePrivy, useLoginWithOAuth } from "@privy-io/expo";
import { useAuth } from "@/contexts/auth-context";
import { API_BASE } from "@/lib/api-base";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type OnboardingStep = "twitter" | "email" | "wallet";

export function OnboardingScreen() {

  const { user, isReady } = usePrivy();
  const { login } = useLoginWithOAuth(); // ✅ correct
  const { isLoggedIn } = useAuth();

  const [currentStep, setCurrentStep] = useState<OnboardingStep>("twitter");
  const [isOnboarding, setIsOnboarding] = useState(false);

  useEffect(() => {

    if (!isReady) return;
    if (isLoggedIn && user) return;

    const twitterId = (user as any)?.twitter?.subject;
    const email = (user as any)?.email?.address;

    const wallet =
      (user as any)?.wallet?.address ||
      (user as any)?.wallets?.[0]?.address;

    if (twitterId && email && wallet) {
      completeOnboarding();
    } else if (twitterId && email) {
      setCurrentStep("wallet");
    } else if (twitterId) {
      setCurrentStep("email");
    } else {
      setCurrentStep("twitter");
    }

  }, [user, isReady]);

  const completeOnboarding = useCallback(async () => {

    if (!user) return;

    try {

      setIsOnboarding(true);

      const walletAddress =
        (user as any)?.wallet?.address ||
        (user as any)?.wallets?.[0]?.address;

      const payload = {
        privy_user_id: user.id,
        twitter_user_id: (user as any)?.twitter?.subject || "",
        twitter_username: (user as any)?.twitter?.username || "",
        email: (user as any)?.email?.address || "",
        wallet_address: walletAddress || "",
      };

      const response = await fetch(`${API_BASE}/api/onboard-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Onboarding failed");
      }

      await response.json();

      setIsOnboarding(false);

    } catch (error) {

      console.error("Onboarding error:", error);
      setIsOnboarding(false);

    }

  }, [user]);

  const handleTwitterConnect = async () => {

    try {

      await login({
        provider: "twitter"
      });

    } catch (error) {

      console.error("Twitter login error:", error);

    }

  };

  if (!isReady) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: "#fff" }}>Loading...</Text>
      </View>
    );
  }

  if (isLoggedIn) return null;

  return (
    <LinearGradient
      colors={["#000000", "#1a1a1a", "#000000"]}
      style={styles.container}
    >
      <View style={styles.content}>

        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Memeswipe</Text>
          <Text style={styles.subtitle}>Trade memes, earn rewards</Text>
        </View>

        <View style={styles.steps}>
          {renderStep("twitter", "1", "Connect Twitter", currentStep)}
          {renderStep("email", "2", "Verify Email", currentStep)}
          {renderStep("wallet", "3", "Create Wallet", currentStep)}
        </View>

        <View style={styles.actionContainer}>

          {currentStep === "twitter" && (
            <Pressable style={styles.primaryButton} onPress={handleTwitterConnect}>
              <Text style={styles.primaryButtonText}>Connect Twitter</Text>
            </Pressable>
          )}

          {currentStep === "email" && (
            <View style={styles.infoContainer}>
              <Text style={styles.infoText}>
                Verify your email to continue
              </Text>
            </View>
          )}

          {currentStep === "wallet" && (
            <View style={styles.infoContainer}>
              <Text style={styles.infoText}>
                Creating your trading wallet...
              </Text>
            </View>
          )}

        </View>

        {isOnboarding && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.loadingText}>
              Setting up your account...
            </Text>
          </View>
        )}

      </View>
    </LinearGradient>
  );
}

function renderStep(step: OnboardingStep, number: string, title: string, currentStep: OnboardingStep) {

  const active = currentStep === step;

  return (
    <View style={[styles.step, active && styles.activeStep]}>
      <View style={[styles.stepIndicator, active && styles.activeIndicator]}>
        <Text style={[styles.stepNumber, active && styles.activeStepNumber]}>
          {number}
        </Text>
      </View>

      <Text style={[styles.stepTitle, active && styles.activeStepTitle]}>
        {title}
      </Text>
    </View>
  );

}

const styles = StyleSheet.create({
  container:{flex:1,width:SCREEN_WIDTH,height:SCREEN_HEIGHT},
  center:{justifyContent:"center",alignItems:"center"},
  content:{flex:1,paddingHorizontal:24,paddingTop:80,paddingBottom:40},
  header:{alignItems:"center",marginBottom:60},
  title:{fontSize:32,fontWeight:"700",color:"#fff"},
  subtitle:{fontSize:18,color:"#888"},
  steps:{flex:1,justifyContent:"center",gap:24},
  step:{flexDirection:"row",alignItems:"center",padding:20,backgroundColor:"#1a1a1a",borderRadius:16,borderWidth:1,borderColor:"#333"},
  activeStep:{borderColor:"#007AFF",backgroundColor:"#001122"},
  stepIndicator:{width:40,height:40,borderRadius:20,backgroundColor:"#333",justifyContent:"center",alignItems:"center",marginRight:16},
  activeIndicator:{backgroundColor:"#007AFF"},
  stepNumber:{fontSize:18,color:"#888"},
  activeStepNumber:{color:"#fff"},
  stepTitle:{fontSize:18,color:"#888"},
  activeStepTitle:{color:"#fff"},
  actionContainer:{marginTop:40},
  primaryButton:{backgroundColor:"#007AFF",paddingVertical:16,borderRadius:12,alignItems:"center"},
  primaryButtonText:{color:"#fff",fontSize:18,fontWeight:"600"},
  infoContainer:{padding:20,backgroundColor:"#1a1a1a",borderRadius:12,alignItems:"center"},
  infoText:{color:"#fff",fontSize:16},
  loadingOverlay:{position:"absolute",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0,0,0,0.8)",justifyContent:"center",alignItems:"center"},
  loadingText:{fontSize:18,color:"#fff",fontWeight:"600"}
});