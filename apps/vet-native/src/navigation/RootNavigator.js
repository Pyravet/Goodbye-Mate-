import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import JobsListScreen from '../screens/JobsListScreen.js';
import JobDetailScreen from '../screens/JobDetailScreen.js';
import ProfileScreen from '../screens/ProfileScreen.js';
import MessagesScreen from '../screens/MessagesScreen.js';
import EarningsScreen from '../screens/EarningsScreen.js';
import OffersScreen from '../screens/OffersScreen.js';
import DaySheetScreen from '../screens/DaySheetScreen.js';
import LeaveScreen from '../screens/LeaveScreen.js';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme.js';

/**
 * Tab bar icons.
 *
 * HIG §7: match size, stroke weight and detail level across the whole
 * set — one set (Ionicons), filled variants throughout, same size. A
 * single heavier or more detailed icon stands out for the wrong reason.
 *
 * The bar previously had NO icons at all, which is unusual on both iOS
 * and Android and made the sections harder to scan than a labelled row
 * of glyphs.
 */
const TAB_ICONS = {
  Today: 'today',
  Jobs: 'briefcase',
  Offers: 'hand-left',
  Messages: 'chatbubble',
  Earnings: 'cash',
  Profile: 'person',
};

const Tab = createBottomTabNavigator();
const JobsStack = createNativeStackNavigator();

const ProfileStack = createNativeStackNavigator();

/**
 * Profile as a stack so Leave is reachable without a sixth tab — six
 * would crowd the bar, and time off is something a vet sets occasionally
 * rather than every day.
 */
function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Your profile' }} />
      <ProfileStack.Screen name="Leave" component={LeaveScreen} options={{ title: 'Time off' }} />
    </ProfileStack.Navigator>
  );
}

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
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.forestDark,
        tabBarInactiveTintColor: colors.inkSoft,
        // HIG §7: filled symbols throughout for platform consistency,
        // one size, one set.
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name] || 'ellipse'} size={size} color={color} />
        ),
        // HIG §5: one-word labels. All four already are.
        tabBarLabelStyle: { fontSize: 11 },
        // Keeps the whole tab (icon + label) inside a 44pt-tall region
        // on devices without a home indicator.
        tabBarStyle: { minHeight: 56 },
      })}
    >
      <Tab.Screen name="Today" component={DaySheetScreen} />
      <Tab.Screen name="Offers" component={OffersScreen} />
      <Tab.Screen name="Jobs" component={JobsStackNavigator} />
      <Tab.Screen name="Messages" component={MessagesScreen} options={{ headerShown: true, headerStyle: { backgroundColor: colors.forest }, headerTintColor: '#fff' }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Profile" component={ProfileStackNavigator} />
    </Tab.Navigator>
  );
}
