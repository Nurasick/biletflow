import { Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/floating-tab-bar';

/** The three top-level sections. Detail screens live in the root stack and cover the bar. */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="tickets" />
      <Tabs.Screen name="workspace" />
    </Tabs>
  );
}
