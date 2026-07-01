import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { COLORS, FONT } from '@/src/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.bg,
          borderTopColor: COLORS.separator,
          borderTopWidth: 0.5,
        },
        tabBarActiveTintColor: COLORS.textPrimary,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarLabelStyle: {
          ...FONT.medium,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Стрічка',
          tabBarIcon: ({ color }) => (
            <TabIcon name="cards" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="canon"
        options={{
          title: 'Канон',
          tabBarIcon: ({ color }) => (
            <TabIcon name="heart" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ще',
          tabBarIcon: ({ color }) => (
            <TabIcon name="more" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

// Simple text-based icons (no external dep needed for MVP)
function TabIcon({ name, color }: { name: string; color: string }) {
  const icons: Record<string, string> = {
    cards: '◈',
    heart: '♡',
    more: '⋯',
  };
  return (
    <Text style={{ fontSize: 22, color, marginBottom: -2 }}>
      {icons[name] || '•'}
    </Text>
  );
}
