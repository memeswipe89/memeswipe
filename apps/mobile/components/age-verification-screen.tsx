import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const AGE_VERIFIED_KEY = '@memeswipe:ageVerified:v1';

interface AgeVerificationScreenProps {
  onVerified: () => void;
}

export function AgeVerificationScreen({ onVerified }: AgeVerificationScreenProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm18Plus = async () => {
    try {
      setIsLoading(true);
      await AsyncStorage.setItem(AGE_VERIFIED_KEY, 'true');
      console.log("Age verification saved to storage");
      // Small delay to ensure state updates
      setTimeout(() => {
        console.log("Calling onVerified callback");
        onVerified();
      }, 100);
    } catch (error) {
      console.error('Error saving age verification:', error);
      Alert.alert('Error', 'Could not save your preference. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecline = () => {
    Alert.alert(
      'Age Requirement',
      'You must be 18 years or older to use this app.',
      [{ text: 'OK' }]
    );
  };

  return (
    <LinearGradient
      colors={['#000000', '#1a1a1a', '#000000']}
      style={styles.container}
    >
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconCircle}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.iconImage}
            resizeMode="contain"
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>Age Verification</Text>

        {/* Warning Icon */}
        <Text style={styles.warningIcon}>⚠️</Text>

        {/* Description */}
        <Text style={styles.description}>
          This app involves cryptocurrency trading and carries significant financial risk.
        </Text>

        <Text style={styles.description}>
          You must be at least 18 years old to use this application.
        </Text>

        {/* Confirmation Text */}
        <View style={styles.confirmationBox}>
          <Text style={styles.confirmationText}>
            I confirm that I am 18 years of age or older and understand the risks involved in cryptocurrency trading.
          </Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttonContainer}>
          <Pressable
            style={[styles.button, styles.confirmButton]}
            onPress={handleConfirm18Plus}
            disabled={isLoading}
          >
            <Text style={styles.confirmButtonText}>
              {isLoading ? 'CONFIRMING...' : 'I CONFIRM, I AM 18+'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.declineButton]}
            onPress={handleDecline}
            disabled={isLoading}
          >
            <Text style={styles.declineButtonText}>I AM UNDER 18</Text>
          </Pressable>
        </View>

        {/* Legal Footer */}
        <Text style={styles.legalText}>
          By confirming, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  iconImage: {
    width: 70,
    height: 70,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  warningIcon: {
    fontSize: 48,
    marginBottom: 24,
  },
  description: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 24,
  },
  confirmationBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginVertical: 24,
  },
  confirmationText: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 20,
    fontWeight: '500',
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
    marginTop: 24,
    paddingHorizontal: 16,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButton: {
    backgroundColor: '#007AFF',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  declineButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  declineButtonText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '600',
  },
  legalText: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
