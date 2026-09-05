import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  StatusBar,
} from 'react-native';

const COLORS = {
  bg: '#101828',
  surface: '#182230',
  surface2: '#1D2939',
  line: '#344054',
  text: '#F5F5F0',
  muted: '#98A2B3',
  accent: '#FF5C35',
  accentInk: '#101828',
  sold: '#344054',
};

export default function Index() {
  const [activeTab, setActiveTab] = useState('Home');
  const [activeCategory, setActiveCategory] = useState('Concerts');
  const [selectedPayment, setSelectedPayment] = useState('card');
  const [selectedSeats, setSelectedSeats] = useState<string[]>(['3-6', '3-7']);

  const toggleSeat = (seatId: string) => {
    if (selectedSeats.includes(seatId)) {
      setSelectedSeats(selectedSeats.filter((id) => id !== seatId));
    } else {
      setSelectedSeats([...selectedSeats, seatId]);
    }
  };

  const calculateTotal = () => selectedSeats.length * 8500;

  return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

        {/* Header Bar */}
        <View style={styles.appBar}>
          <View style={styles.logoRow}>
            <View style={styles.logoMark} />
            <Text style={styles.brandText}>
              Bilet<Text style={{ color: COLORS.accent }}>Flow</Text>
            </Text>
          </View>
          <TouchableOpacity style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>♧</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {/* Search & Location */}
          <View style={styles.homeTop}>
            <Text style={styles.cityText}>⌖ Almaty, Kazakhstan ▾</Text>
            <View style={styles.searchBar}>
              <Text style={{ color: COLORS.muted, fontSize: 14 }}>⌕ </Text>
              <TextInput
                  placeholder="Search events, artists, or venues…"
                  placeholderTextColor={COLORS.muted}
                  style={styles.searchInput}
              />
            </View>
          </View>

          {/* Categories */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesContainer}>
            {[
              { id: 'Concerts', icon: '♪' },
              { id: 'Festivals', icon: '✦' },
              { id: 'Theatre', icon: '◫' },
              { id: 'Sports', icon: '◉' },
              { id: 'Arts', icon: '◇' },
            ].map((cat) => (
                <TouchableOpacity
                    key={cat.id}
                    onPress={() => setActiveCategory(cat.id)}
                    style={styles.catItem}
                >
                  <View
                      style={[
                        styles.catCircle,
                        activeCategory === cat.id && styles.catCircleActive,
                      ]}
                  >
                    <Text
                        style={[
                          styles.catIcon,
                          activeCategory === cat.id && { color: COLORS.accentInk },
                        ]}
                    >
                      {cat.icon}
                    </Text>
                  </View>
                  <Text
                      style={[
                        styles.catLabel,
                        activeCategory === cat.id && styles.catLabelActive,
                      ]}
                  >
                    {cat.id}
                  </Text>
                </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Featured Hero Card */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Featured this weekend</Text>
            <Text style={styles.seeAllText}>See all →</Text>
          </View>

          <TouchableOpacity style={styles.heroCard}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>FEATURED</Text>
              <Text style={styles.heroTitle}>Almaty Indie Night</Text>
              <Text style={styles.heroSubtitle}>Sat 18 Apr · Palace of Republic</Text>
            </View>
            <View style={styles.heroPriceBadge}>
              <Text style={styles.heroPriceText}>from 8 500 ₸</Text>
            </View>
          </TouchableOpacity>

          {/* Seat Map */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Select Seats</Text>
          </View>

          <View style={styles.seatArea}>
            <View style={styles.stage}>
              <Text style={styles.stageText}>STAGE</Text>
            </View>

            {[1, 2, 3, 4].map((rowNum) => (
                <View key={rowNum} style={styles.seatRow}>
                  <Text style={styles.rowNo}>{rowNum}</Text>
                  <View style={styles.seatLine}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((seatNum) => {
                      const seatId = `${rowNum}-${seatNum}`;
                      const isSelected = selectedSeats.includes(seatId);
                      const isSold = rowNum === 2 && (seatNum === 5 || seatNum === 6);

                      return (
                          <TouchableOpacity
                              key={seatId}
                              disabled={isSold}
                              onPress={() => toggleSeat(seatId)}
                              style={[
                                styles.seat,
                                isSelected && styles.seatSelected,
                                isSold && styles.seatSold,
                              ]}
                          >
                            <Text style={[styles.seatText, isSelected && { color: '#FFF' }]}>
                              {isSold ? '×' : isSelected ? '✓' : ''}
                            </Text>
                          </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
            ))}

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: COLORS.accent }]} />
                <Text style={styles.legendText}>Selected</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { borderColor: COLORS.accent }]} />
                <Text style={styles.legendText}>Standard</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: COLORS.sold }]} />
                <Text style={styles.legendText}>Sold</Text>
              </View>
            </View>
          </View>

          {/* Summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Order Summary</Text>
            {selectedSeats.map((seatId) => (
                <View key={seatId} style={styles.sumRow}>
                  <View>
                    <Text style={styles.sumSeatTitle}>Row {seatId.replace('-', ' · Seat ')}</Text>
                    <Text style={styles.sumSeatType}>Standard</Text>
                  </View>
                  <Text style={styles.sumPrice}>8 500 ₸</Text>
                </View>
            ))}
            <View style={styles.totalDivider} />
            <View style={styles.sumRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{calculateTotal().toLocaleString()} ₸</Text>
            </View>
          </View>

          {/* Payment */}
          <View style={styles.paymentCard}>
            <Text style={styles.summaryTitle}>Payment Method</Text>
            <TouchableOpacity
                style={styles.payOption}
                onPress={() => setSelectedPayment('card')}
            >
              <View style={[styles.radio, selectedPayment === 'card' && styles.radioOn]} />
              <Text style={styles.payText}>Credit / Debit Card</Text>
              <Text style={styles.payLogos}>VISA · MC</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.payOption}
                onPress={() => setSelectedPayment('kaspi')}
            >
              <View style={[styles.radio, selectedPayment === 'kaspi' && styles.radioOn]} />
              <Text style={styles.payText}>Kaspi / e-Wallet</Text>
              <Text style={styles.payLogos}>KASPI</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Sticky Bottom CTA */}
        <View style={styles.stickyCta}>
          <View style={styles.ctaRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.muted, fontSize: 11 }}>Total Price</Text>
              <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800' }}>
                {calculateTotal().toLocaleString()} ₸
              </Text>
            </View>
            <TouchableOpacity style={styles.ctaButton}>
              <Text style={styles.ctaButtonText}>Pay Now</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Navigation */}
        <View style={styles.bottomNav}>
          {[
            { id: 'Home', icon: '⌂', label: 'Home' },
            { id: 'Tickets', icon: '▣', label: 'My Tickets' },
            { id: 'Discover', icon: '⌕', label: 'Discover' },
            { id: 'Profile', icon: '○', label: 'Profile' },
          ].map((nav) => (
              <TouchableOpacity
                  key={nav.id}
                  onPress={() => setActiveTab(nav.id)}
                  style={styles.navItem}
              >
                <Text style={[styles.navIcon, activeTab === nav.id && { color: COLORS.accent }]}>
                  {nav.icon}
                </Text>
                <Text style={[styles.navLabel, activeTab === nav.id && { color: COLORS.accent, fontWeight: '700' }]}>
                  {nav.label}
                </Text>
              </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoMark: { width: 18, height: 22, backgroundColor: COLORS.accent, marginRight: 8, borderRadius: 4 },
  brandText: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { color: COLORS.text, fontSize: 14 },
  scrollContainer: { flex: 1 },
  homeTop: { padding: 16, backgroundColor: COLORS.surface },
  cityText: { color: COLORS.muted, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  searchBar: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.bg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 13 },
  categoriesContainer: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  catItem: { alignItems: 'center', marginRight: 16, width: 60 },
  catCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  catCircleActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  catIcon: { fontSize: 16, color: COLORS.muted },
  catLabel: { fontSize: 10, color: COLORS.muted },
  catLabelActive: { color: COLORS.text, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 18, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  seeAllText: { fontSize: 11, color: COLORS.accent, fontWeight: '800' },
  heroCard: {
    marginHorizontal: 16,
    height: 160,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 16,
    justifyContent: 'space-between',
  },
  heroCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '800', color: COLORS.accent, letterSpacing: 1 },
  heroTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  heroSubtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  heroPriceBadge: { alignSelf: 'flex-end', backgroundColor: COLORS.accent, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  heroPriceText: { color: COLORS.accentInk, fontWeight: '800', fontSize: 11 },
  seatArea: { marginHorizontal: 16, padding: 12, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line },
  stage: { height: 30, backgroundColor: COLORS.text, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  stageText: { color: COLORS.bg, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  seatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  rowNo: { width: 16, color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  seatLine: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  seat: { width: 24, height: 24, borderRadius: 4, borderWidth: 1.5, borderColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  seatSelected: { backgroundColor: COLORS.accent },
  seatSold: { backgroundColor: COLORS.sold, borderColor: COLORS.sold },
  seatText: { fontSize: 10, fontWeight: '700', color: COLORS.muted },
  legend: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.line },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 10, height: 10, borderRadius: 2, borderWidth: 1, marginRight: 4 },
  legendText: { fontSize: 10, color: COLORS.muted },
  summaryCard: { marginHorizontal: 16, marginTop: 16, padding: 14, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line },
  summaryTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  sumSeatTitle: { fontSize: 12, fontWeight: '600', color: COLORS.text },
  sumSeatType: { fontSize: 10, color: COLORS.muted },
  sumPrice: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  totalDivider: { height: 1, backgroundColor: COLORS.line, marginVertical: 8 },
  totalLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  totalValue: { fontSize: 15, fontWeight: '800', color: COLORS.accent },
  paymentCard: { marginHorizontal: 16, marginVertical: 16, padding: 14, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line },
  payOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: COLORS.muted, marginRight: 10 },
  radioOn: { borderColor: COLORS.accent, backgroundColor: COLORS.accent },
  payText: { fontSize: 12, color: COLORS.text, flex: 1 },
  payLogos: { fontSize: 10, fontWeight: '700', color: COLORS.muted },
  stickyCta: { padding: 14, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.line },
  ctaRow: { flexDirection: 'row', alignItems: 'center' },
  ctaButton: { backgroundColor: COLORS.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  ctaButtonText: { color: COLORS.accentInk, fontWeight: '800', fontSize: 14 },
  bottomNav: { height: 60, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.line, flexDirection: 'row' },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navIcon: { fontSize: 16, color: COLORS.muted },
  navLabel: { fontSize: 9, color: COLORS.muted, marginTop: 2 },
});