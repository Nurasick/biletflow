export const formatPrice = (price: number, locale = "kk-KZ") => {
  return `${new Intl.NumberFormat(locale).format(price)} ₸`;
};

// The API speaks integer minor units (tiyn): 150000 means 1 500 ₸.
export const formatMinor = (minor: number, locale = "kk-KZ") => formatPrice(minor / 100, locale);
