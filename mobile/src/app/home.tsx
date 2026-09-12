import { useState } from 'react';
import { StatusBar, TextInput, TouchableOpacity, SafeAreaView, View, ScrollView } from 'react-native';
import { SafeAreaView as SafeAreaViewContext } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const CATEGORIES = [
  { id: 'Concerts', icon: '♪' },
  { id: 'Festivals', icon: '✦' },
  { id: 'Theatre', icon: '◫' },
  { id: 'Sports', icon: '◉' },
  { id: 'Arts', icon: '◇' },
];

const FEATURED_EVENTS = [
  {
    id: 1,
    title: 'Almaty Indie Night',
    date: 'Sat 18 Apr',
    venue: 'Palace of Republic',
    price: 'from 8 500 ₸',
  },
];

const EVENTS = [
  { id: 1, title: 'Jazz on Panfilova', date: 'Sat 18 Apr', rating: '16+' },
  { id: 2, title: 'Electronic Dreams', date: 'Sun 19 Apr', rating: '18+' },
  { id: 3, title: 'Folk Festival', date: 'Mon 20 Apr', rating: 'All ages' },
  { id: 4, title: 'Rock Night', date: 'Tue 21 Apr', rating: '16+' },
];

export default function HomeScreen() {
  const [activeCategory, setActiveCategory] = useState('Concerts');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <SafeAreaViewContext className="flex-1 bg-slate-950">
      <StatusBar barStyle="light-content" backgroundColor="#101828" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4 bg-slate-900 border-b border-slate-700">
          {/* Logo */}
          <View className="flex-row items-center gap-2">
            <View className="w-6 h-7 bg-orange-500 rounded" />
            <ThemedText className="text-xl font-extrabold">
              Bilet<ThemedText className="text-orange-500">Flow</ThemedText>
            </ThemedText>
          </View>

          {/* Settings Icon */}
          <TouchableOpacity className="w-9 h-9 rounded border border-slate-600 items-center justify-center bg-slate-800">
            <ThemedText className="text-lg">♧</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Location & Search Section */}
        <View className="px-4 py-3 bg-slate-900 border-b border-slate-700">
          {/* Location */}
          <ThemedText className="text-xs font-semibold text-gray-400 mb-3">
            ⌖ Almaty, Kazakhstan ▾
          </ThemedText>

          {/* Search Bar */}
          <View className="flex-row items-center bg-slate-800 rounded-xl px-3 py-2 border border-slate-700">
            <ThemedText className="text-gray-500 text-sm mr-2">⌕</ThemedText>
            <TextInput
              placeholder="Search events, artists, or venues…"
              placeholderTextColor="#98A2B3"
              style={{ color: '#F5F5F0', flex: 1, fontSize: 13 }}
              className="py-2"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* Categories Scroll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="border-b border-slate-700"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => setActiveCategory(cat.id)}
              className="items-center"
            >
              <View
                className={`w-10 h-10 rounded-full items-center justify-center mb-2 border ${
                  activeCategory === cat.id
                    ? 'bg-orange-500 border-orange-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <ThemedText
                  className={`text-base ${
                    activeCategory === cat.id ? 'text-black' : 'text-orange-500'
                  }`}
                >
                  {cat.icon}
                </ThemedText>
              </View>
              <ThemedText
                className={`text-xs ${
                  activeCategory === cat.id ? 'font-bold text-white' : 'text-gray-500'
                }`}
              >
                {cat.id}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Featured Section */}
        <View className="px-4 pt-4">
          <View className="flex-row items-center justify-between mb-3">
            <ThemedText className="text-lg font-bold">Featured this weekend</ThemedText>
            <TouchableOpacity>
              <ThemedText className="text-xs font-bold text-orange-500">See all →</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Featured Banner */}
          <TouchableOpacity className="bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl overflow-hidden p-4 mb-4 border border-slate-700 min-h-32">
            <ThemedText className="text-xs font-bold text-orange-300 mb-1 tracking-widest">
              FEATURED
            </ThemedText>
            <ThemedText className="text-xl font-bold mb-1 text-white">
              {FEATURED_EVENTS[0].title}
            </ThemedText>
            <ThemedText className="text-xs text-gray-300 mb-3">
              {FEATURED_EVENTS[0].date} · {FEATURED_EVENTS[0].venue}
            </ThemedText>
            <ThemedText className="text-sm font-bold text-orange-500 absolute right-4 bottom-4">
              {FEATURED_EVENTS[0].price}
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Events List */}
        <View className="px-4 mb-2">
          <ThemedText className="text-lg font-bold">Afisha · Sat 18 Apr</ThemedText>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 16 }}
        >
          {EVENTS.map((event) => (
            <TouchableOpacity key={event.id} className="w-40">
              {/* Event Poster */}
              <View className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl aspect-[3/4] mb-2 justify-end p-2 border border-slate-600 relative overflow-hidden">
                <View className="absolute top-2 left-2 bg-slate-950 px-2 py-1 rounded">
                  <ThemedText className="text-xs font-bold text-white">{event.rating}</ThemedText>
                </View>

                {/* Icon placeholder */}
                <View className="absolute inset-0 items-center justify-center opacity-20">
                  <ThemedText className="text-6xl">♪</ThemedText>
                </View>
              </View>

              {/* Event Info */}
              <ThemedText className="text-sm font-semibold mb-1 leading-tight">
                {event.title}
              </ThemedText>
              <ThemedText className="text-xs text-gray-500">
                {event.date}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* More Events Section */}
        <View className="px-4">
          <ThemedText className="text-lg font-bold mb-3">More events today</ThemedText>

          {[...EVENTS, ...EVENTS.slice(0, 2)].map((event, idx) => (
            <TouchableOpacity
              key={`${event.id}-${idx}`}
              className="flex-row items-center bg-slate-800 rounded-lg p-3 mb-2 border border-slate-700"
            >
              {/* Thumbnail */}
              <View className="w-14 h-14 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg mr-3 items-center justify-center border border-slate-600">
                <ThemedText className="text-2xl opacity-50">♪</ThemedText>
              </View>

              {/* Event Details */}
              <View className="flex-1">
                <ThemedText className="text-sm font-semibold mb-1">{event.title}</ThemedText>
                <ThemedText className="text-xs text-gray-500">{event.date}</ThemedText>
              </View>

              {/* Arrow */}
              <ThemedText className="text-lg text-gray-500">›</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaViewContext>
  );
}
