import { useEffect, useRef } from 'react';
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

  if (loading) return null; // could show a splash/spinner
  return user ? <RootNavigator /> : <LoginScreen />;
}

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
