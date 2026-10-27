export const formatPrice = (price: number, locale = "kk-KZ") => {
  return `${new Intl.NumberFormat(locale).format(price)} ₸`;
};
