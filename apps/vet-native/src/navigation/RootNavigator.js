import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import JobsListScreen from '../screens/JobsListScreen.js';
import JobDetailScreen from '../screens/JobDetailScreen.js';
import ProfileScreen from '../screens/ProfileScreen.js';
import { colors } from '../theme.js';

const Tab = createBottomTabNavigator();
const JobsStack = createNativeStackNavigator();

function JobsStackNavigator() {
  return (
    <JobsStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.forest }, headerTintColor: '#fff' }}>
      <JobsStack.Screen name="JobsList" component={JobsListScreen} options={{ title: 'Your jobs' }} />
      <JobsStack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: '' }} />
    </JobsStack.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.forestDark,
        tabBarInactiveTintColor: colors.inkSoft,
      }}
    >
      <Tab.Screen name="Jobs" component={JobsStackNavigator} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
