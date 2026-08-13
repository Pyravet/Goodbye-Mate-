import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useAuth } from '../AuthContext.js';
import { colors } from '../theme.js';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();

  const onSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      <View style={styles.form}>
        <Text style={styles.subtitle}>VET SIGN IN</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="username"
          style={styles.input}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          style={styles.input}
        />
        <TouchableOpacity onPress={onSubmit} disabled={submitting} style={styles.button}>
          <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { width: 120, height: 120, marginBottom: 28, borderRadius: 24 },
  form: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 14, padding: 24 },
  subtitle: { fontSize: 12, letterSpacing: 0.6, color: colors.inkSoft, marginBottom: 18, fontWeight: '600' },
  label: { fontSize: 12, color: colors.inkSoft, marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 12, fontSize: 16 },
  button: { backgroundColor: colors.forest, borderRadius: 6, padding: 14, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  error: { color: colors.brick, fontSize: 13, marginBottom: 10 },
});
