import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TermsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header with back button */}
      <View style={styles.header}>
        <Pressable 
          onPress={() => router.back()} 
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Terms & Conditions</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Terms of Service</Text>
        <Text style={styles.text}>
          Welcome to our trading platform. By using this application, you agree to the following terms and conditions.
        </Text>
        
        <Text style={styles.sectionTitle}>Privacy Policy</Text>
        <Text style={styles.text}>
          We are committed to protecting your privacy and personal information. Your data is encrypted and stored securely.
        </Text>
        
        <Text style={styles.sectionTitle}>Trading Risks</Text>
        <Text style={styles.text}>
          Trading cryptocurrencies involves substantial risk and may not be suitable for all investors. Past performance does not guarantee future results.
        </Text>
        
        <Text style={styles.sectionTitle}>Liability</Text>
        <Text style={styles.text}>
          The platform is provided "as is" without warranties of any kind. We are not liable for any losses incurred through the use of this application.
        </Text>
        
        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    color: '#007AFF',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 32,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 32,
    marginBottom: 12,
  },
  text: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  spacer: {
    height: 40,
  },
});