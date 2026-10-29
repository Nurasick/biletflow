import { useMemo } from 'react';
import { toQR } from 'toqr';
import { View } from 'react-native';

/** Render the server-signed admission payload locally; it is never sent to a QR service. */
export function TicketQr({ payload, size = 224 }: { payload: string; size?: number }) {
  const matrix = useMemo(() => {
    try {
      const bits = toQR(payload);
      const side = Math.sqrt(bits.length);
      if (!Number.isInteger(side)) return null;
      return { bits, side };
    } catch {
      return null;
    }
  }, [payload]);

  if (!matrix) return null;

  return (
    <View accessibilityLabel="Ticket admission QR code" accessible style={{ width: size, height: size, padding: 8, backgroundColor: '#FFFFFF' }}>
      <View style={{ flex: 1 }}>
        {Array.from({ length: matrix.side }, (_, row) => (
          <View key={row} style={{ flex: 1, flexDirection: 'row' }}>
            {Array.from({ length: matrix.side }, (_, column) => (
              <View key={column} style={{ flex: 1, backgroundColor: matrix.bits[row * matrix.side + column] ? '#111111' : '#FFFFFF' }} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
