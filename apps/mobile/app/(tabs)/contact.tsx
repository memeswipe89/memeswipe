import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform, Pressable, Animated, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

type Message = {
  id: string;
  text: string;
  isBot: boolean;
  timestamp: Date;
};

const FAQ_RESPONSES: Record<string, string> = {
  'what is swipeit': 'SwipeIt is a fun and intuitive mobile app for trading meme coins! Swipe right to buy, swipe left to skip. It\'s like Tinder, but for crypto trading! 🚀',
  'how does it work': 'Simply swipe through trending meme coins. Swipe right to buy with your preferred amount, swipe left to pass. All trades are executed on-chain instantly! 💫',
  'how to trade': 'Trading is easy! Set your trade amount in settings, then swipe right on any coin you like. Your trade executes instantly on the blockchain. 📈',
  'is it safe': 'Yes! All trades are executed on-chain through secure smart contracts. You maintain full control of your wallet and private keys. Always trade responsibly! 🔒',
  'what coins': 'We feature trending meme coins from PumpFun and other popular sources. New coins are added regularly based on community interest and trading volume! 🪙',
  'fees': 'SwipeIt charges a small platform fee on each trade. Blockchain gas fees also apply. Check the trade preview before confirming any transaction. 💰',
  'wallet': 'We support embedded wallets through Privy. You can also connect external wallets. Your keys, your crypto! 👛',
  'age requirement': 'You must be at least 18 years old to use SwipeIt. Age verification is required during onboarding. 🔞',
  'support': 'Need help? Email us at memeswipe89@gmail.com or reach out on Twitter @swipeitXYZ. We typically respond within 24-48 hours! 💬',
  'risk': 'Crypto trading involves substantial risk. Prices can be volatile. Never invest more than you can afford to lose. This is not financial advice! ⚠️',
};

const getBotResponse = (userMessage: string): string => {
  const lowerMessage = userMessage.toLowerCase().trim();
  
  // Check for exact or partial matches
  for (const [key, response] of Object.entries(FAQ_RESPONSES)) {
    if (lowerMessage.includes(key) || key.includes(lowerMessage)) {
      return response;
    }
  }
  
  // Check for common greetings
  if (lowerMessage.match(/^(hi|hello|hey|sup|yo)/)) {
    return 'Hey there! 👋 I\'m here to answer questions about SwipeIt. Ask me anything about how it works, trading, safety, or features!';
  }
  
  // Default response
  return 'I\'m not sure about that, but I\'d love to help! Try asking about:\n\n• What is SwipeIt?\n• How does trading work?\n• Is it safe?\n• What coins are available?\n• Fees and costs\n• Wallet support\n\nOr contact our team directly via email or Twitter! 😊';
};

const SUGGESTED_QUESTIONS = [
  'What is SwipeIt?',
  'How does trading work?',
  'Is it safe?',
  'What coins are available?',
  'Tell me about fees',
  'How to create a wallet?',
  'What are the risks?',
  'How to deposit SOL?',
];

export default function ContactScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hi! 👋 I\'m the SwipeIt assistant. Ask me anything about the app, trading, features, or how to get started!',
      isBot: true,
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isInputVisible, setIsInputVisible] = useState(false);
  const scrollX = useRef(new Animated.Value(0)).current;
  const inputOpacity = useRef(new Animated.Value(0)).current;
  const fabOpacity = useRef(new Animated.Value(1)).current;
  const inputRef = useRef<TextInput>(null);

  // Auto-scroll animation
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -1000, // Scroll distance
        duration: 20000, // 20 seconds for smooth scroll
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, []);

  // Hide input when keyboard is dismissed
  useEffect(() => {
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => {
      hideInput();
    });

    return () => {
      keyboardDidHide.remove();
    };
  }, []);
  
  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText.trim(),
      isBot: false,
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    
    // Generate bot response after a short delay
    setTimeout(() => {
      const botResponse: Message = {
        id: (Date.now() + 1).toString(),
        text: getBotResponse(inputText),
        isBot: true,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botResponse]);
    }, 500);
  };

  const showInput = () => {
    setIsInputVisible(true);
    Animated.parallel([
      Animated.timing(inputOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fabOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const hideInput = () => {
    Animated.parallel([
      Animated.timing(inputOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fabOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsInputVisible(false);
    });
  };

  const handleQuestionPress = (question: string) => {
    setInputText(question);
    showInput();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleFabPress = () => {
    showInput();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView 
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.fullPageContainer}>
          {/* Animated Question Banner - Top */}
          <View style={styles.bannerContainer}>
            <Animated.View 
              style={[
                styles.bannerContent,
                { transform: [{ translateX: scrollX }] }
              ]}
            >
              {/* Render questions twice for seamless loop */}
              {[...SUGGESTED_QUESTIONS, ...SUGGESTED_QUESTIONS].map((question, index) => (
                <Pressable 
                  key={index}
                  style={styles.questionBadge}
                  onPress={() => handleQuestionPress(question)}
                >
                  <MaterialIcons name="help-outline" size={14} color="#4ade80" />
                  <Text style={styles.questionBadgeText}>{question}</Text>
                </Pressable>
              ))}
            </Animated.View>
          </View>

          {/* Header - Compact */}
          <View style={styles.compactHeader}>
            <View style={styles.headerRow}>
              <View style={styles.smallIconContainer}>
                <MaterialIcons name="smart-toy" size={28} color="#4ade80" />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.compactTitle}>SwipeIt Assistant</Text>
                <Text style={styles.compactSubtitle}>Ask me anything!</Text>
              </View>
            </View>
          </View>

          {/* Chat Messages - Full Height */}
          <ScrollView 
            style={styles.fullChatMessages} 
            contentContainerStyle={styles.chatMessagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.messageBubble,
                  message.isBot ? styles.botMessage : styles.userMessage,
                ]}
              >
                {message.isBot && (
                  <View style={styles.botAvatar}>
                    <MaterialIcons name="smart-toy" size={16} color="#4ade80" />
                  </View>
                )}
                <View style={styles.messageContent}>
                  <Text style={styles.messageText}>{message.text}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Floating Action Button - Bottom Right */}
          <Animated.View style={[styles.fab, { opacity: fabOpacity }]} pointerEvents={isInputVisible ? 'none' : 'auto'}>
            <Pressable 
              style={styles.fabButton}
              onPress={handleFabPress}
            >
              <MaterialIcons name="chat" size={28} color="#000" />
            </Pressable>
          </Animated.View>

          {/* Chat Input - Shows when FAB is clicked */}
          {isInputVisible && (
            <Animated.View style={[styles.chatInputContainer, { opacity: inputOpacity }]}>
              <View style={styles.chatInput}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  placeholder="Ask a question..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={handleSendMessage}
                  returnKeyType="send"
                  multiline
                  maxLength={500}
                />
                <Pressable 
                  style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
                  onPress={handleSendMessage}
                  disabled={!inputText.trim()}
                >
                  <MaterialIcons 
                    name="send" 
                    size={20} 
                    color={inputText.trim() ? '#000' : 'rgba(255,255,255,0.3)'} 
                  />
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  keyboardView: {
    flex: 1,
  },
  fullPageContainer: {
    flex: 1,
  },
  bannerContainer: {
    height: 36,
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(74,222,128,0.2)',
    overflow: 'hidden',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    paddingHorizontal: 8,
  },
  questionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  questionBadgeText: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  compactHeader: {
    backgroundColor: '#1a1d28',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  smallIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(74,222,128,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  compactTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 2,
  },
  compactSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  fullChatMessages: {
    flex: 1,
    backgroundColor: '#000',
  },
  chatMessagesContent: {
    padding: 16,
    paddingBottom: 80,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4ade80',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  messageBubble: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  botMessage: {
    alignSelf: 'flex-start',
  },
  userMessage: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  botAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(74,222,128,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageContent: {
    maxWidth: '80%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#fff',
  },
  chatInputContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  chatInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    minHeight: 40,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 6,
    maxHeight: 80,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4ade80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
