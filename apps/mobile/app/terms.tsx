import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TermsScreen() {
  const insets = useSafeAreaInsets();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scrollRef = React.useRef<ScrollView>(null);
  const [termsOffsetY, setTermsOffsetY] = React.useState<number | null>(null);
  const [privacyOffsetY, setPrivacyOffsetY] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!section) return;
    if (section === 'privacy' && privacyOffsetY != null) {
      scrollRef.current?.scrollTo({ y: privacyOffsetY, animated: true });
    } else if (section === 'terms' && termsOffsetY != null) {
      scrollRef.current?.scrollTo({ y: termsOffsetY, animated: true });
    }
  }, [privacyOffsetY, section, termsOffsetY]);

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
        <Text style={styles.title}>Legal</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <ScrollView ref={scrollRef} style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Terms of Service */}
        <Text
          style={styles.mainTitle}
          onLayout={(event) => setTermsOffsetY(event.nativeEvent.layout.y)}
        >
          Terms of Service
        </Text>
        <Text style={styles.lastUpdated}>Last Updated: {new Date().toLocaleDateString()}</Text>
        
        <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
        <Text style={styles.text}>
          By accessing and using Swipeit (&quot;the App&quot;), you accept and agree to be bound by these Terms of Service. 
          If you do not agree to these terms, please do not use the App.
        </Text>
        
        <Text style={styles.sectionTitle}>2. Description of Service</Text>
        <Text style={styles.text}>
          Swipeit is a cryptocurrency trading platform that allows users to discover and trade digital tokens. 
          The App provides access to blockchain-based trading services through third-party providers.
        </Text>
        
        <Text style={styles.sectionTitle}>3. Age Requirement</Text>
        <Text style={styles.text}>
          You must be at least 18 years old to use this App. By using the App, you represent and warrant that 
          you are of legal age to form a binding contract.
        </Text>
        
        <Text style={styles.sectionTitle}>4. Trading Risks</Text>
        <Text style={styles.text}>
          Trading cryptocurrencies involves substantial risk of loss and is not suitable for all investors. 
          You acknowledge that:
        </Text>
        <Text style={styles.bulletText}>• Cryptocurrency markets are highly volatile</Text>
        <Text style={styles.bulletText}>• You may lose all or part of your investment</Text>
        <Text style={styles.bulletText}>• Past performance does not guarantee future results</Text>
        <Text style={styles.bulletText}>• You are solely responsible for your trading decisions</Text>
        
        <Text style={styles.sectionTitle}>5. Not Financial Advice</Text>
        <Text style={styles.text}>
          The App does not provide investment, financial, legal, or tax advice. All content is for informational 
          purposes only. You should consult with qualified professionals before making any financial decisions.
        </Text>
        
        <Text style={styles.sectionTitle}>6. User Responsibilities</Text>
        <Text style={styles.text}>
          You are responsible for:
        </Text>
        <Text style={styles.bulletText}>• Maintaining the security of your account credentials</Text>
        <Text style={styles.bulletText}>• All activities that occur under your account</Text>
        <Text style={styles.bulletText}>• Complying with all applicable laws and regulations</Text>
        <Text style={styles.bulletText}>• Paying any applicable taxes on your transactions</Text>
        
        <Text style={styles.sectionTitle}>7. Prohibited Activities</Text>
        <Text style={styles.text}>
          You agree not to:
        </Text>
        <Text style={styles.bulletText}>• Use the App for any illegal purposes</Text>
        <Text style={styles.bulletText}>• Attempt to manipulate markets or prices</Text>
        <Text style={styles.bulletText}>• Interfere with the App’s operation or security</Text>
        <Text style={styles.bulletText}>• Use automated systems without authorization</Text>
        
        <Text style={styles.sectionTitle}>8. Wallet and Custody</Text>
        <Text style={styles.text}>
          Your cryptocurrency wallet is provided by Privy, a third-party service. You acknowledge that:
        </Text>
        <Text style={styles.bulletText}>• We do not have access to your private keys</Text>
        <Text style={styles.bulletText}>• You are responsible for wallet security</Text>
        <Text style={styles.bulletText}>• Lost credentials cannot be recovered</Text>
        <Text style={styles.bulletText}>• Transactions on blockchain are irreversible</Text>
        
        <Text style={styles.sectionTitle}>9. Fees and Charges</Text>
        <Text style={styles.text}>
          Trading may incur network fees, transaction fees, and other charges. You are responsible for all 
          fees associated with your use of the App.
        </Text>
        
        <Text style={styles.sectionTitle}>10. Limitation of Liability</Text>
        <Text style={styles.text}>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
          SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED 
          DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
        </Text>
        
        <Text style={styles.sectionTitle}>11. Disclaimer of Warranties</Text>
        <Text style={styles.text}>
          THE APP IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR 
          IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, 
          OR NON-INFRINGEMENT.
        </Text>
        
        <Text style={styles.sectionTitle}>12. Termination</Text>
        <Text style={styles.text}>
          We reserve the right to suspend or terminate your access to the App at any time, with or without 
          cause, with or without notice.
        </Text>
        
        <Text style={styles.sectionTitle}>13. Changes to Terms</Text>
        <Text style={styles.text}>
          We may modify these Terms at any time. Continued use of the App after changes constitutes acceptance 
          of the modified Terms.
        </Text>
        
        {/* Privacy Policy */}
        <Text
          style={[styles.mainTitle, { marginTop: 40 }]}
          onLayout={(event) => setPrivacyOffsetY(event.nativeEvent.layout.y)}
        >
          Privacy Policy
        </Text>
        <Text style={styles.lastUpdated}>Last Updated: {new Date().toLocaleDateString()}</Text>
        
        <Text style={styles.sectionTitle}>1. Information We Collect</Text>
        <Text style={styles.text}>
          We collect the following information:
        </Text>
        <Text style={styles.bulletText}>• Account information (email, social media profile)</Text>
        <Text style={styles.bulletText}>• Wallet addresses and transaction data</Text>
        <Text style={styles.bulletText}>• Device information and usage data</Text>
        <Text style={styles.bulletText}>• IP address and location data</Text>
        
        <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
        <Text style={styles.text}>
          We use your information to:
        </Text>
        <Text style={styles.bulletText}>• Provide and improve our services</Text>
        <Text style={styles.bulletText}>• Process your transactions</Text>
        <Text style={styles.bulletText}>• Communicate with you about your account</Text>
        <Text style={styles.bulletText}>• Comply with legal obligations</Text>
        <Text style={styles.bulletText}>• Prevent fraud and ensure security</Text>
        
        <Text style={styles.sectionTitle}>3. Data Security</Text>
        <Text style={styles.text}>
          We implement industry-standard security measures to protect your data, including encryption, 
          secure servers, and access controls. However, no method of transmission over the internet is 
          100% secure.
        </Text>
        
        <Text style={styles.sectionTitle}>4. Third-Party Services</Text>
        <Text style={styles.text}>
          We use third-party services including:
        </Text>
        <Text style={styles.bulletText}>• Privy (wallet and authentication)</Text>
        <Text style={styles.bulletText}>• Solana blockchain (transaction processing)</Text>
        <Text style={styles.bulletText}>• Analytics providers</Text>
        <Text style={styles.text}>
          These services have their own privacy policies and we are not responsible for their practices.
        </Text>
        
        <Text style={styles.sectionTitle}>5. Data Sharing</Text>
        <Text style={styles.text}>
          We do not sell your personal information. We may share your information:
        </Text>
        <Text style={styles.bulletText}>• With service providers who assist our operations</Text>
        <Text style={styles.bulletText}>• When required by law or legal process</Text>
        <Text style={styles.bulletText}>• To protect our rights and prevent fraud</Text>
        <Text style={styles.bulletText}>• With your consent</Text>
        
        <Text style={styles.sectionTitle}>6. Your Rights</Text>
        <Text style={styles.text}>
          You have the right to:
        </Text>
        <Text style={styles.bulletText}>• Access your personal information</Text>
        <Text style={styles.bulletText}>• Request correction of inaccurate data</Text>
        <Text style={styles.bulletText}>• Request deletion of your data</Text>
        <Text style={styles.bulletText}>• Opt-out of marketing communications</Text>
        <Text style={styles.bulletText}>• Export your data</Text>
        
        <Text style={styles.sectionTitle}>7. Data Retention</Text>
        <Text style={styles.text}>
          We retain your information for as long as necessary to provide our services and comply with legal 
          obligations. Transaction data on the blockchain is permanent and cannot be deleted.
        </Text>
        
        <Text style={styles.sectionTitle}>8. Children’s Privacy</Text>
        <Text style={styles.text}>
          Our App is not intended for users under 18 years of age. We do not knowingly collect information 
          from children.
        </Text>
        
        <Text style={styles.sectionTitle}>9. International Users</Text>
        <Text style={styles.text}>
          Your information may be transferred to and processed in countries other than your own. By using 
          the App, you consent to such transfers.
        </Text>
        
        <Text style={styles.sectionTitle}>10. Contact Us</Text>
        <Text style={styles.text}>
          For questions about these Terms or Privacy Policy, please contact us through the App’s support 
          channels.
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
  mainTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 8,
  },
  lastUpdated: {
    color: '#888',
    fontSize: 12,
    marginBottom: 20,
    fontStyle: 'italic',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 12,
  },
  text: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  bulletText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
    paddingLeft: 16,
  },
  spacer: {
    height: 60,
  },
});
