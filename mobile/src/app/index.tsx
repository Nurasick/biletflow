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
    <SafeAreaViewContext style={{ flex: 1, backgroundColor: '#101828' }}>
      <StatusBar barStyle="light-content" backgroundColor="#101828" />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: '#182230', borderBottomWidth: 1, borderBottomColor: '#344054' }}>
          {/* Logo */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 24, height: 28, backgroundColor: '#FF5C35', borderRadius: 4 }} />
            <ThemedText style={{ fontSize: 20, fontWeight: '800' }}>
              Bilet<ThemedText style={{ color: '#FF5C35' }}>Flow</ThemedText>
            </ThemedText>
          </View>

          {/* Settings Icon */}
          <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#344054', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D2939' }}>
            <ThemedText style={{ fontSize: 18 }}>♧</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Location & Search Section */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#182230', borderBottomWidth: 1, borderBottomColor: '#344054' }}>
          {/* Location */}
          <ThemedText style={{ fontSize: 12, fontWeight: '600', color: '#98A2B3', marginBottom: 12 }}>
            ⌖ Almaty, Kazakhstan ▾
          </ThemedText>

          {/* Search Bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1D2939', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#344054' }}>
            <ThemedText style={{ color: '#98A2B3', fontSize: 14, marginRight: 8 }}>⌕</ThemedText>
            <TextInput
              placeholder="Search events, artists, or venues…"
              placeholderTextColor="#98A2B3"
              style={{ color: '#F5F5F0', flex: 1, fontSize: 13, paddingVertical: 4 }}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* Categories Scroll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ borderBottomWidth: 1, borderBottomColor: '#344054' }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => setActiveCategory(cat.id)}
              style={{ alignItems: 'center' }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                  borderWidth: 1,
                  backgroundColor: activeCategory === cat.id ? '#FF5C35' : '#1D2939',
                  borderColor: activeCategory === cat.id ? '#FF5C35' : '#344054',
                }}
              >
                <ThemedText style={{ fontSize: 16, color: activeCategory === cat.id ? '#101828' : '#FF5C35' }}>
                  {cat.icon}
                </ThemedText>
              </View>
              <ThemedText style={{ fontSize: 12, fontWeight: activeCategory === cat.id ? '700' : '400', color: activeCategory === cat.id ? '#F5F5F0' : '#98A2B3' }}>
                {cat.id}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Featured Section */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <ThemedText style={{ fontSize: 18, fontWeight: '700' }}>Featured this weekend</ThemedText>
            <TouchableOpacity>
              <ThemedText style={{ fontSize: 12, fontWeight: '700', color: '#FF5C35' }}>See all →</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Featured Banner */}
          <TouchableOpacity style={{ backgroundColor: '#182230', borderRadius: 16, overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 16, marginBottom: 16, borderWidth: 1, borderColor: '#344054', minHeight: 120 }}>
            <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#FFA38B', marginBottom: 8, letterSpacing: 1 }}>
              FEATURED
            </ThemedText>
            <ThemedText style={{ fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#F5F5F0' }}>
              {FEATURED_EVENTS[0].title}
            </ThemedText>
            <ThemedText style={{ fontSize: 12, color: '#D0D5DD', marginBottom: 8 }}>
              {FEATURED_EVENTS[0].date} · {FEATURED_EVENTS[0].venue}
            </ThemedText>
            <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#FF5C35', position: 'absolute', right: 16, bottom: 16 }}>
              {FEATURED_EVENTS[0].price}
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Events List */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '700' }}>Afisha · Sat 18 Apr</ThemedText>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 16 }}
        >
          {EVENTS.map((event) => (
            <TouchableOpacity key={event.id} style={{ width: 160 }}>
              {/* Event Poster */}
              <View style={{ backgroundColor: '#182230', borderRadius: 16, aspectRatio: 0.75, marginBottom: 8, justifyContent: 'flex-end', paddingHorizontal: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#344054', position: 'relative', overflow: 'hidden' }}>
                <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: '#0C111D', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
                  <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>{event.rating}</ThemedText>
                </View>

                {/* Icon placeholder */}
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: 0.2 }}>
                  <ThemedText style={{ fontSize: 56 }}>♪</ThemedText>
                </View>
              </View>

              {/* Event Info */}
              <ThemedText style={{ fontSize: 13, fontWeight: '600', marginBottom: 4, color: '#F5F5F0' }}>
                {event.title}
              </ThemedText>
              <ThemedText style={{ fontSize: 12, color: '#98A2B3' }}>
                {event.date}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* More Events Section */}
        <View style={{ paddingHorizontal: 16 }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '700', marginBottom: 12 }}>More events today</ThemedText>

          {[...EVENTS, ...EVENTS.slice(0, 2)].map((event, idx) => (
            <TouchableOpacity
              key={`${event.id}-${idx}`}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1D2939', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, borderWidth: 1, borderColor: '#344054' }}
            >
              {/* Thumbnail */}
              <View style={{ width: 56, height: 56, backgroundColor: '#182230', borderRadius: 8, marginRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#344054' }}>
                <ThemedText style={{ fontSize: 24, opacity: 0.5 }}>♪</ThemedText>
              </View>

              {/* Event Details */}
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontSize: 13, fontWeight: '600', marginBottom: 4 }}>{event.title}</ThemedText>
                <ThemedText style={{ fontSize: 12, color: '#98A2B3' }}>{event.date}</ThemedText>
              </View>

              {/* Arrow */}
              <ThemedText style={{ fontSize: 18, color: '#98A2B3' }}>›</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaViewContext>
  );
}
