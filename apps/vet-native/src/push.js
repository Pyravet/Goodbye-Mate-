import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch } from './api/client.js';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#BE8A3C',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return { ok: false, reason: 'denied' };
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  const res = await apiFetch('/push/register-expo-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  if (!res.ok) return { ok: false, reason: 'server_error' };

  return { ok: true, token };
}

// Handles a tap on a notification — navigates to the relevant job.
// `navigationRef` is a React Navigation ref set up in App.js.
export function addNotificationResponseListener(navigationRef) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (url && navigationRef.isReady()) {
      const jobId = url.split('/jobs/')[1];
      if (jobId) navigationRef.navigate('JobDetail', { id: jobId });
    }
  });
}
