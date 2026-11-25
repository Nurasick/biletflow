import { Redirect } from 'expo-router';

/**
 * Where Halyk ePay sends the buyer back (the return_url the Tickets screen
 * passes). Usually the in-app browser catches this link and closes itself
 * before the app routes to it; on Android it can open the app instead, and
 * then this screen just hands over to My tickets, which re-checks the order.
 */
export default function PaymentReturn() {
  return <Redirect href="/tickets" />;
}
