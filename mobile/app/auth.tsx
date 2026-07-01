// ============================================================================
// Auth Screen — Email + Password (MVP)
// Clean, minimal, iOS-native feel
// ============================================================================

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useAuthStore } from '@/src/store/authStore';
import { COLORS, SPACING, FONT, RADIUS } from '@/src/constants/theme';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuthStore();

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('', 'Введи email і пароль');
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email.trim(), password);
        Alert.alert('Готово', 'Перевір email для підтвердження');
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err: unknown) {
      Alert.alert('Помилка', err instanceof Error ? err.message : 'Спробуй ще раз');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>giggle</Text>
        <Text style={styles.subtitle}>персональний резонанс</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={COLORS.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Пароль"
            placeholderTextColor={COLORS.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? '...' : isSignUp ? 'Створити акаунт' : 'Увійти'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.switchButton}
            onPress={() => setIsSignUp(!isSignUp)}
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Вже є акаунт? Увійти' : 'Немає акаунту? Створити'}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.screenPadding,
  },
  title: {
    ...FONT.bold,
    fontSize: FONT.size.largeTitle,
    color: COLORS.textPrimary,
    textAlign: 'center',
    letterSpacing: -1,
  },
  subtitle: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
    marginBottom: SPACING.xxl,
  },
  form: {
    gap: SPACING.md,
  },
  input: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.separator,
  },
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...FONT.semibold,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
  switchButton: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  switchText: {
    ...FONT.regular,
    fontSize: FONT.size.subheadline,
    color: COLORS.textSecondary,
  },
});
