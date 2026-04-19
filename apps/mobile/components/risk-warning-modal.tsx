import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type RiskWarningModalProps = {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function RiskWarningModal({ visible, onAccept, onDecline }: RiskWarningModalProps) {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [riskUnderstood, setRiskUnderstood] = useState(false);

  const canProceed = ageConfirmed && riskUnderstood;

  const handleAccept = () => {
    if (canProceed) {
      onAccept();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDecline}>
        <BlurView intensity={40} tint="dark" style={styles.blurView} />
      </Pressable>
      
      <View style={styles.bottomSheet}>
        <View style={styles.modal}>
          {/* Drag Handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <MaterialIcons name="warning" size={32} color="#ff6b6b" />
            </View>
            <Text style={styles.title}>Important Disclosure</Text>
          </View>

          {/* Content */}
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⚠️ Risk Warning</Text>
              <Text style={styles.text}>
                Trading cryptocurrencies involves substantial risk of loss and is not suitable for every investor. 
                The valuation of cryptocurrencies may fluctuate, and you may lose all or more than the amount you invest.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Not Financial Advice</Text>
              <Text style={styles.text}>
                This app does not provide investment advice, financial advice, trading advice, or any other sort of advice. 
                You are solely responsible for evaluating the merits and risks associated with using this app.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔒 Your Responsibility</Text>
              <Text style={styles.text}>
                All trades are executed on-chain and are irreversible. Always verify transaction details before confirming. 
                You are responsible for securing your wallet and private keys.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⚖️ Regulatory Notice</Text>
              <Text style={styles.text}>
                Cryptocurrency trading may be subject to regulation in your jurisdiction. 
                It is your responsibility to ensure compliance with applicable laws.
              </Text>
            </View>

            {/* Checkboxes */}
            <View style={styles.checkboxSection}>
              <Pressable 
                style={styles.checkboxRow} 
                onPress={() => setAgeConfirmed(!ageConfirmed)}
              >
                <View style={[styles.checkbox, ageConfirmed && styles.checkboxChecked]}>
                  {ageConfirmed && <MaterialIcons name="check" size={16} color="#fff" />}
                </View>
                <Text style={styles.checkboxText}>
                  I confirm that I am at least 18 years old
                </Text>
              </Pressable>

              <Pressable 
                style={styles.checkboxRow} 
                onPress={() => setRiskUnderstood(!riskUnderstood)}
              >
                <View style={[styles.checkbox, riskUnderstood && styles.checkboxChecked]}>
                  {riskUnderstood && <MaterialIcons name="check" size={16} color="#fff" />}
                </View>
                <Text style={styles.checkboxText}>
                  I understand the risks and accept full responsibility for my trading decisions
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable 
              style={[styles.button, styles.declineButton]} 
              onPress={onDecline}
            >
              <Text style={styles.declineButtonText}>Decline</Text>
            </Pressable>
            
            <Pressable 
              style={[styles.button, styles.acceptButton, !canProceed && styles.buttonDisabled]} 
              onPress={handleAccept}
              disabled={!canProceed}
            >
              <Text style={[styles.acceptButtonText, !canProceed && styles.buttonTextDisabled]}>
                Accept & Continue
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  blurView: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_HEIGHT * 0.9,
  },
  modal: {
    backgroundColor: '#1a1d28',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,107,107,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  content: {
    maxHeight: SCREEN_HEIGHT * 0.6,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.75)',
  },
  checkboxSection: {
    marginTop: 8,
    gap: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  checkboxText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#fff',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  declineButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  acceptButton: {
    backgroundColor: '#4ade80',
  },
  acceptButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    backgroundColor: 'rgba(74,222,128,0.3)',
  },
  buttonTextDisabled: {
    color: 'rgba(0,0,0,0.4)',
  },
});
