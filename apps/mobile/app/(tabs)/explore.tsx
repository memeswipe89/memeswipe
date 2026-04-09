import { ScrollView, StyleSheet, Text, View } from 'react-native';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Para = ({ children }: { children: string }) => (
  <Text style={styles.para}>{children}</Text>
);

const Bullet = ({ children }: { children: string }) => (
  <View style={styles.bulletRow}>
    <Text style={styles.bulletDot}>•</Text>
    <Text style={styles.bulletText}>{children}</Text>
  </View>
);

export default function TandCScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.appName}>Swipe It</Text>
        <Text style={styles.headerSub}>Terms &amp; Conditions</Text>
        <Text style={styles.lastUpdated}>Last updated: April 2026</Text>
      </View>

      <Section title="1. About Swipe It">
        <Para>
          Swipe It is a mobile-first crypto trading app that lets you discover, evaluate, and trade meme tokens on Solana and Base by swiping through a curated token deck. Swipe right to buy, swipe left to skip — trading made intuitive.
        </Para>
      </Section>

      <Section title="2. Acceptance of Terms">
        <Para>
          By downloading, installing, or using Swipe It, you agree to be bound by these Terms &amp; Conditions. If you do not agree, please do not use the app.
        </Para>
      </Section>

      <Section title="3. Eligibility">
        <Para>You must meet all of the following to use Swipe It:</Para>
        <Bullet>Be at least 18 years of age</Bullet>
        <Bullet>Not be located in a jurisdiction where crypto trading is prohibited</Bullet>
        <Bullet>Have the legal capacity to enter into a binding agreement</Bullet>
      </Section>

      <Section title="4. How Swipe It Works">
        <Para>
          Swipe It connects to decentralised exchanges (DEXs) such as Jupiter on Solana to execute token swaps on your behalf using your embedded trading wallet. You set your trade amount, take-profit (ROI), and stop-loss (SL) thresholds — the app handles execution automatically when conditions are met.
        </Para>
      </Section>

      <Section title="5. Financial Risk Disclaimer">
        <Para>
          Crypto trading involves substantial risk of loss. Meme tokens are highly speculative and volatile assets. You may lose some or all of your invested capital. Nothing in Swipe It constitutes financial advice, investment advice, or a recommendation to buy or sell any asset.
        </Para>
        <Bullet>Past performance is not indicative of future results</Bullet>
        <Bullet>Automated trades may execute at unfavourable prices due to slippage or market conditions</Bullet>
        <Bullet>Network fees (gas) are non-refundable regardless of trade outcome</Bullet>
        <Bullet>Token liquidity may be insufficient to fill your order at the expected price</Bullet>
      </Section>

      <Section title="6. Your Wallet &amp; Funds">
        <Para>
          Swipe It uses a non-custodial embedded wallet. You are solely responsible for the security of your wallet credentials and private keys. Swipe It does not store, control, or have access to your private keys. Lost credentials cannot be recovered by us.
        </Para>
      </Section>

      <Section title="7. Prohibited Use">
        <Para>You agree not to use Swipe It to:</Para>
        <Bullet>Engage in market manipulation or wash trading</Bullet>
        <Bullet>Circumvent applicable laws or regulations</Bullet>
        <Bullet>Attempt to reverse-engineer or exploit the app</Bullet>
        <Bullet>Use automated bots or scripts outside of the app's intended functionality</Bullet>
      </Section>

      <Section title="8. Limitation of Liability">
        <Para>
          To the maximum extent permitted by law, Swipe It and its developers shall not be liable for any direct, indirect, incidental, or consequential losses arising from your use of the app, including but not limited to trading losses, missed opportunities, or technical failures.
        </Para>
      </Section>

      <Section title="9. Changes to Terms">
        <Para>
          We may update these Terms &amp; Conditions at any time. Continued use of the app after changes are posted constitutes your acceptance of the revised terms.
        </Para>
      </Section>

      <Section title="10. Contact">
        <Para>
          For questions or concerns regarding these terms, please reach out through the official Swipe It support channels.
        </Para>
      </Section>

      <Text style={styles.footer}>© 2026 Swipe It. All rights reserved.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#07090f',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginTop: 54,
    marginBottom: 28,
    alignItems: 'center',
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  lastUpdated: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 6,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#61b4ff',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  para: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  bulletDot: {
    color: '#61b4ff',
    fontSize: 13,
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 20,
  },
  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    marginTop: 16,
  },
});
