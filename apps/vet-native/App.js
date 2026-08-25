import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/AuthContext.js';
import LoginScreen from './src/screens/LoginScreen.js';
import RootNavigator from './src/navigation/RootNavigator.js';
import { addNotificationResponseListener } from './src/push.js';

const navigationRef = createNavigationContainerRef();

function Gate() {
  const { user, loading } = useAuth();

  useEffect(() => {
    const sub = addNotificationResponseListener(navigationRef);
    return () => sub.remove();
  }, []);

  // A spinner, not null. Returning null renders a blank white screen
  // that is indistinguishable from a crash — which is exactly how this
  // looked when the startup auth check was slow.
  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#33453A" />
        <Text style={styles.splashText}>Goodbye Mate</Text>
      </View>
    );
  }
  return user ? <RootNavigator /> : <LoginScreen />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAF7F1' },
  splashText: { marginTop: 14, fontSize: 15, color: '#6B6559' },
});

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="light" />
        <Gate />
      </NavigationContainer>
    </AuthProvider>
  );
}
